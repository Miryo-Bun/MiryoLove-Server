import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { ChatRecord, MessageRecord } from "../types/contracts.js";
import { AppError } from "../utils/errors.js";

export class ChatService {
  async create(userId: string, title = "New chat"): Promise<ChatRecord> {
    return prisma.chat.create({ data: { userId, title } });
  }

  async list(userId: string, limit: number): Promise<ChatRecord[]> {
    return prisma.chat.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  }

  async get(userId: string, chatId: string): Promise<ChatRecord> {
    const chat = await prisma.chat.findFirst({ where: { id: chatId, userId } });
    if (!chat) throw new AppError(404, "CHAT_NOT_FOUND", "Chat was not found.");
    return chat;
  }

  async update(userId: string, chatId: string, title: string): Promise<ChatRecord> {
    const result = await prisma.chat.updateMany({
      where: { id: chatId, userId },
      data: { title },
    });
    if (result.count !== 1) throw new AppError(404, "CHAT_NOT_FOUND", "Chat was not found.");
    return this.get(userId, chatId);
  }

  async delete(userId: string, chatId: string): Promise<void> {
    const result = await prisma.chat.deleteMany({ where: { id: chatId, userId } });
    if (result.count !== 1) throw new AppError(404, "CHAT_NOT_FOUND", "Chat was not found.");
  }

  async createMessage(
    userId: string,
    chatId: string,
    input: {
      role: "user" | "assistant" | "system";
      content: string;
      sources?: Prisma.InputJsonValue;
    },
  ): Promise<MessageRecord> {
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId },
      select: { id: true },
    });
    if (!chat) throw new AppError(404, "CHAT_NOT_FOUND", "Chat was not found.");
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          chatId,
          role: input.role,
          content: input.content,
          ...(input.sources === undefined ? {} : { sources: input.sources }),
        },
      }),
      prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }),
    ]);
    return message;
  }

  async createExchange(
    userId: string,
    chatId: string,
    input: {
      userMessage: string;
      assistantMessage: string;
      sources?: Prisma.InputJsonValue;
    },
  ): Promise<[MessageRecord, MessageRecord]> {
    return prisma.$transaction(async (transaction) => {
      const chat = await transaction.chat.findFirst({
        where: { id: chatId, userId },
        select: { id: true, title: true },
      });
      if (!chat) throw new AppError(404, "CHAT_NOT_FOUND", "Chat was not found.");

      const createdAt = new Date();
      const assistantCreatedAt = new Date(createdAt.getTime() + 1);
      const userMessage = await transaction.message.create({
        data: { chatId, role: "user", content: input.userMessage, createdAt },
      });
      const assistantMessage = await transaction.message.create({
        data: {
          chatId,
          role: "assistant",
          content: input.assistantMessage,
          createdAt: assistantCreatedAt,
          ...(input.sources === undefined ? {} : { sources: input.sources }),
        },
      });
      await transaction.chat.update({
        where: { id: chatId },
        data: {
          updatedAt: assistantCreatedAt,
          ...(chat.title === "New chat" ? { title: input.userMessage.slice(0, 80) } : {}),
        },
      });
      return [userMessage, assistantMessage];
    });
  }

  async listMessages(userId: string, chatId: string, limit: number): Promise<MessageRecord[]> {
    await this.get(userId, chatId);
    const messages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return messages.reverse();
  }
}
