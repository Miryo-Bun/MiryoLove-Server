import type { RequestHandler } from "express";
import type { ChatServiceContract } from "../types/contracts.js";
import {
  chatIdParamsSchema,
  createChatSchema,
  createMessageSchema,
  listQuerySchema,
  updateChatSchema,
} from "../schemas/chat.schema.js";
import { getAuthenticatedUser } from "../middleware/auth.middleware.js";
import { validate } from "../utils/validation.js";

export function createChatsController(chatService: ChatServiceContract): {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  delete: RequestHandler;
  createMessage: RequestHandler;
  listMessages: RequestHandler;
} {
  return {
    create: async (request, response) => {
      const input = validate(createChatSchema, request.body);
      const chat = await chatService.create(getAuthenticatedUser(request).id, input.title);
      response.status(201).json({ chat });
    },
    list: async (request, response) => {
      const query = validate(listQuerySchema, request.query);
      response.json({
        chats: await chatService.list(getAuthenticatedUser(request).id, query.limit),
      });
    },
    get: async (request, response) => {
      const { chatId } = validate(chatIdParamsSchema, request.params);
      response.json({ chat: await chatService.get(getAuthenticatedUser(request).id, chatId) });
    },
    update: async (request, response) => {
      const { chatId } = validate(chatIdParamsSchema, request.params);
      const input = validate(updateChatSchema, request.body);
      response.json({
        chat: await chatService.update(getAuthenticatedUser(request).id, chatId, input.title),
      });
    },
    delete: async (request, response) => {
      const { chatId } = validate(chatIdParamsSchema, request.params);
      await chatService.delete(getAuthenticatedUser(request).id, chatId);
      response.status(204).end();
    },
    createMessage: async (request, response) => {
      const { chatId } = validate(chatIdParamsSchema, request.params);
      const input = validate(createMessageSchema, request.body);
      const message = await chatService.createMessage(
        getAuthenticatedUser(request).id,
        chatId,
        input,
      );
      response.status(201).json({ message });
    },
    listMessages: async (request, response) => {
      const { chatId } = validate(chatIdParamsSchema, request.params);
      const query = validate(listQuerySchema, request.query);
      response.json({
        messages: await chatService.listMessages(
          getAuthenticatedUser(request).id,
          chatId,
          query.limit,
        ),
      });
    },
  };
}
