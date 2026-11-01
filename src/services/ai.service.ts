import type { Prisma } from "../generated/prisma/client.js";
import type { AIServiceContract } from "../types/contracts.js";
import type { ChatService } from "./chat.service.js";
import { aiRuntime } from "./ai-runtime.service.js";

export class MiryoLoveAIService implements AIServiceContract {
  constructor(private readonly chats: ChatService) {}

  async generateResponse(input: {
    userId: string;
    chatId: string;
    message: string;
  }): Promise<{ content: string; sources: Array<{ source: string; title: string; url: string }> }> {
    const previousMessages = await this.chats.listMessages(input.userId, input.chatId, 8);
    const result = await aiRuntime.generate(
      input.message,
      previousMessages.flatMap(({ role, content }) =>
        role === "user" || role === "assistant" ? [{ role, content }] : [],
      ),
    );
    const sources: Prisma.InputJsonValue = result.sources.map((source): Prisma.InputJsonObject => ({
      source: source.source,
      title: source.title,
      url: source.url,
    }));

    await this.chats.createExchange(input.userId, input.chatId, {
      userMessage: input.message,
      assistantMessage: result.content,
      ...(result.sources.length > 0 ? { sources } : {}),
    });

    return result;
  }
}
