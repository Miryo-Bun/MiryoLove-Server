import type { Prisma } from "../generated/prisma/client.js";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface SessionResult {
  user: PublicUser;
  token: string;
  expiresAt: Date;
}

export interface AuthServiceContract {
  register(input: { email: string; password: string; displayName: string }): Promise<SessionResult>;
  login(input: { email: string; password: string }): Promise<SessionResult>;
  changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void>;
  authenticate(token: string): Promise<PublicUser | null>;
  logout(token: string | undefined): Promise<void>;
  createSession(userId: string): Promise<SessionResult>;
}

export interface ProfileServiceContract {
  get(userId: string): Promise<PublicUser>;
  update(
    userId: string,
    input: { displayName?: string; avatarUrl?: string | null },
  ): Promise<PublicUser>;
  delete(userId: string): Promise<void>;
  listOAuthProviders(userId: string): Promise<Array<"google" | "yandex">>;
  unlinkOAuthProvider(userId: string, provider: "google" | "yandex"): Promise<void>;
}

export interface ChatRecord {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatServiceContract {
  create(userId: string, title?: string): Promise<ChatRecord>;
  list(userId: string, limit: number): Promise<ChatRecord[]>;
  get(userId: string, chatId: string): Promise<ChatRecord>;
  update(userId: string, chatId: string, title: string): Promise<ChatRecord>;
  delete(userId: string, chatId: string): Promise<void>;
  createMessage(
    userId: string,
    chatId: string,
    input: {
      role: "user" | "assistant" | "system";
      content: string;
      sources?: Prisma.InputJsonValue;
    },
  ): Promise<MessageRecord>;
  createExchange(
    userId: string,
    chatId: string,
    input: {
      userMessage: string;
      assistantMessage: string;
      sources?: Prisma.InputJsonValue;
    },
  ): Promise<[MessageRecord, MessageRecord]>;
  listMessages(userId: string, chatId: string, limit: number): Promise<MessageRecord[]>;
}

export interface OAuthServiceContract {
  isConfigured(provider: "google" | "yandex"): boolean;
  getAuthorizationUrl(provider: "google" | "yandex", state: string): string;
  authenticate(provider: "google" | "yandex", code: string): Promise<SessionResult>;
}

export interface AIServiceContract {
  generateResponse(input: { userId: string; chatId: string; message: string }): Promise<{
    content: string;
    sources: Array<{ source: string; title: string; url: string }>;
  }>;
}
