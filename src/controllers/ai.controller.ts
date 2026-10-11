import type { RequestHandler } from "express";
import { z } from "zod";
import type { AIServiceContract } from "../types/contracts.js";
import { validate } from "../utils/validation.js";

const aiChatSchema = z
  .object({
    chatId: z.string().uuid(),
    message: z.string().trim().min(1).max(100_000),
  })
  .strict();

export function createAIController(aiService: AIServiceContract): RequestHandler {
  return async (request, _response) => {
    validate(aiChatSchema, request.body);
    await aiService.generateResponse();
  };
}
