import { z } from "zod";

export const createChatSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const updateChatSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();

export const createMessageSchema = z
  .object({
    role: z.literal("user"),
    content: z.string().trim().min(1).max(100_000),
  })
  .strict();

export const chatIdParamsSchema = z.object({
  chatId: z.string().uuid(),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
