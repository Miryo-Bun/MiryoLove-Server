import type { RequestHandler } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import type { AIServiceContract } from "../types/contracts.js";
import { getAuthenticatedUser } from "../middleware/auth.middleware.js";
import { validate } from "../utils/validation.js";

const aiChatSchema = z
  .object({
    chatId: z.string().uuid(),
    message: z.string().trim().min(1).max(env.AI_MAX_INPUT_CHARS),
  })
  .strict();

export function createAIController(aiService: AIServiceContract): RequestHandler {
  return async (request, response) => {
    const input = validate(aiChatSchema, request.body);
    const result = await aiService.generateResponse({
      ...input,
      userId: getAuthenticatedUser(request).id,
    });
    response.json(result);
  };
}
