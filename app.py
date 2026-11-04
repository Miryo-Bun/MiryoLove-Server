#!/usr/bin/env python3
"""
MiryoLove Server: FastAPI backend with automated Wikipedia context retrieval 
and an interactive, friendly AI developer persona.
"""
import torch
import json
import urllib.request
import urllib.parse
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from transformers import AutoModelForCausalLM, AutoTokenizer

# Path to the local merged model
MODEL_PATH = "/mnt/Manchild/Project/MiryoLove/MiryoLove AI/miryo_merged_model"

app = FastAPI(
    title="MiryoLove Server API",
    description="Backend service for MiryoLove AI ecosystem",
    version="1.0.0"
)

model = None
tokenizer = None

SYSTEM_PROMPT = (
    "You are MiryoLove AI, a close friend and expert programming mentor "
    "(specializing in Python, C, C++, Java, and Assembly). Communicate naturally, "
    "warmly, with humor, banter, and developer-friendly jokes, avoiding overly formal or robotic language. "
    "ALWAYS respond strictly in the language used by the user (English, Russian, or Ukrainian). "
    "You help debug code, translate, and explain topics from Wikipedia and technical documentation "
    "in simple terms. Include engaging exercises or mini-assignments when appropriate."
)


class ChatRequest(BaseModel):
    user_id: Optional[str] = "default_user"
    message: str
    lang: Optional[str] = "en"
    use_wiki: Optional[bool] = True


def fetch_wikipedia_summary(query: str, lang: str = "en"):
    """Search and retrieve a summary snippet from Wikipedia."""
    formatted_query = urllib.parse.quote(query)
    search_url = f"https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={formatted_query}&format=json"
    
    headers = {'User-Agent': 'MiryoLoveServer/1.0 (https://github.com/MiryoLove)'}
    req = urllib.request.Request(search_url, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            search_results = data.get('query', {}).get('search', [])
            if not search_results:
                return None, None
            
            title = search_results[0]['title']
            page_title = urllib.parse.quote(title)
            summary_url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{page_title}"
            
            req_summary = urllib.request.Request(summary_url, headers=headers)
            with urllib.request.urlopen(req_summary) as summary_response:
                summary_data = json.loads(summary_response.read().decode('utf-8'))
                return title, summary_data.get('extract', '')
    except Exception:
        print("[ERROR] Wikipedia API request failed")
        return None, None


@app.on_event("startup")
def startup_event():
    """Initialize and load the LLM model on server startup."""
    global model, tokenizer
    print(f"🚀 Loading MiryoLove AI model from: {MODEL_PATH}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )
    print("✨ MiryoLove Server is online and ready for requests!")


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    user_text = request.message
    wiki_context = ""
    
    # Multilingual triggers (EN / RU / UK)
    triggers = [
        # Wiki keywords
        "wiki", "wikipedia", "вики", "википедия", "вікіпедія",
        
        # Who is / Who was
        "who is", "who are", "who was",
        "кто такой", "кто такая", "кто такие",
        "хто такий", "хто така", "хто такі",
        
        # What is / What are
        "what is", "what are", "what was", "what's",
        "что такое", "что это",
        "що таке", "що це",
        
        # Explain / Tell me about
        "tell me about", "explain", "explain about", "tell about",
        "расскажи про", "расскажи о", "поясни за", "поясни про",
        "розкажи про", "поясни за", "поясни про"
    ]
    
    needs_wiki = request.use_wiki and any(trigger in user_text.lower() for trigger in triggers)

    if needs_wiki:
        print("🔍 Triggers detected. Fetching Wikipedia context.")
        title, summary = fetch_wikipedia_summary(user_text, lang=request.lang)
        if title and summary:
            wiki_context = (
                f"\n\n[Wikipedia Context for '{title}']: {summary}\n"
                f"IMPORTANT: Use this information to answer the user STRICTLY in the requested language ({request.lang}), "
                f"explaining it simply and with humor in a friendly mentor persona."
            )

    final_user_prompt = user_text + wiki_context

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": final_user_prompt}
    ]

    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=1024,
        temperature=0.7,
        do_sample=True,
        top_p=0.9
    )

    response = tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)

    return {
        "status": "success",
        "response": response,
        "wiki_used": bool(wiki_context)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
