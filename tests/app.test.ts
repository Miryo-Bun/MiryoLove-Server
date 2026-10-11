import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import type {
  AIServiceContract,
  AuthServiceContract,
  ChatRecord,
  ChatServiceContract,
  MessageRecord,
  OAuthServiceContract,
  ProfileServiceContract,
  PublicUser,
  SessionResult,
} from "../src/types/contracts.js";
import { AppError } from "../src/utils/errors.js";

class MemoryAuth implements AuthServiceContract {
  users = new Map<string, PublicUser>();
  credentials = new Map<string, string>();
  sessions = new Map<string, string>();

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<SessionResult> {
    const email = input.email.toLowerCase();
    if ([...this.users.values()].some((user) => user.email === email)) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists.",
      );
    }
    const now = new Date();
    const user: PublicUser = {
      id: randomUUID(),
      email,
      displayName: input.displayName,
      avatarUrl: null,
      createdAt: now,
      lastLoginAt: null,
    };
    this.users.set(user.id, user);
    this.credentials.set(user.id, input.password);
    return this.createSession(user.id);
  }

  async login(input: { email: string; password: string }): Promise<SessionResult> {
    const user = [...this.users.values()].find((item) => item.email === input.email.toLowerCase());
    if (!user || this.credentials.get(user.id) !== input.password) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    return this.createSession(user.id);
  }

  async authenticate(token: string): Promise<PublicUser | null> {
    const userId = this.sessions.get(token);
    return userId ? (this.users.get(userId) ?? null) : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) this.sessions.delete(token);
  }

  async createSession(userId: string): Promise<SessionResult> {
    const currentUser = this.users.get(userId);
    if (!currentUser) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    const token = randomUUID();
    const user = { ...currentUser, lastLoginAt: new Date() };
    this.users.set(userId, user);
    this.sessions.set(token, userId);
    return { user, token, expiresAt: new Date(Date.now() + 60_000) };
  }
}

class MemoryProfiles implements ProfileServiceContract {
  constructor(private readonly auth: MemoryAuth) {}

  async get(userId: string): Promise<PublicUser> {
    const user = this.auth.users.get(userId);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    return user;
  }

  async update(
    userId: string,
    input: { displayName?: string; avatarUrl?: string | null },
  ): Promise<PublicUser> {
    const user = await this.get(userId);
    const updated = { ...user, ...input };
    this.auth.users.set(userId, updated);
    return updated;
  }
}

class MemoryChats implements ChatServiceContract {
  chats = new Map<string, ChatRecord>();
  messages = new Map<string, MessageRecord[]>();

  async create(userId: string, title = "New chat"): Promise<ChatRecord> {
    const now = new Date();
    const chat = { id: randomUUID(), userId, title, createdAt: now, updatedAt: now };
    this.chats.set(chat.id, chat);
    this.messages.set(chat.id, []);
    return chat;
  }

  async list(userId: string, limit: number): Promise<ChatRecord[]> {
    return [...this.chats.values()].filter((chat) => chat.userId === userId).slice(0, limit);
  }

  async get(userId: string, chatId: string): Promise<ChatRecord> {
    const chat = this.chats.get(chatId);
    if (!chat || chat.userId !== userId) {
      throw new AppError(404, "CHAT_NOT_FOUND", "Chat was not found.");
    }
    return chat;
  }

  async update(userId: string, chatId: string, title: string): Promise<ChatRecord> {
    const chat = await this.get(userId, chatId);
    const updated = { ...chat, title, updatedAt: new Date() };
    this.chats.set(chatId, updated);
    return updated;
  }

  async delete(userId: string, chatId: string): Promise<void> {
    await this.get(userId, chatId);
    this.chats.delete(chatId);
    this.messages.delete(chatId);
  }

  async createMessage(
    userId: string,
    chatId: string,
    input: { role: "user" | "assistant" | "system"; content: string },
  ): Promise<MessageRecord> {
    await this.get(userId, chatId);
    const now = new Date();
    const message = { id: randomUUID(), chatId, ...input, createdAt: now, updatedAt: now };
    this.messages.get(chatId)!.push(message);
    return message;
  }

  async listMessages(userId: string, chatId: string, limit: number): Promise<MessageRecord[]> {
    await this.get(userId, chatId);
    return (this.messages.get(chatId) ?? []).slice(0, limit);
  }
}

class MemoryOAuth implements OAuthServiceContract {
  constructor(private readonly auth: MemoryAuth) {}

  getAuthorizationUrl(provider: "google" | "yandex", state: string): string {
    return `https://identity.example/${provider}?state=${encodeURIComponent(state)}`;
  }

  async authenticate(_provider: "google" | "yandex", _code: string): Promise<SessionResult> {
    const user = [...this.auth.users.values()][0];
    if (!user) throw new AppError(400, "NO_TEST_USER", "No test user.");
    return this.auth.createSession(user.id);
  }
}

describe("MiryoLove Server API", () => {
  let auth: MemoryAuth;
  let chats: MemoryChats;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    auth = new MemoryAuth();
    chats = new MemoryChats();
    app = createApp({
      authService: auth,
      oauthService: new MemoryOAuth(auth),
      profileService: new MemoryProfiles(auth),
      chatService: chats,
      aiService: {
        async generateResponse() {
          throw new AppError(503, "AI_NOT_CONFIGURED", "AI is not configured.");
        },
      } satisfies AIServiceContract,
      async checkDatabase() {},
    });
  });

  async function register(email = "person@example.com"): Promise<string> {
    const response = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "a-long-test-password", displayName: "Person" })
      .expect(201);
    expect(response.body.user.passwordHash).toBeUndefined();
    const cookie = response.headers["set-cookie"][0] as string;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie.toLowerCase().includes("; secure")).toBe(env.NODE_ENV === "production");
    return cookie.split(";")[0] as string;
  }

  it("returns service and database health without disclosing database details", async () => {
    await request(app).get("/health").expect(200, { status: "ok", service: "MiryoLove Server" });
    await request(app).get("/health/db").expect(200, { status: "ok", database: "connected" });
    const unavailable = createApp({
      authService: auth,
      oauthService: new MemoryOAuth(auth),
      profileService: new MemoryProfiles(auth),
      chatService: chats,
      aiService: {
        async generateResponse() {
          throw new Error("unused");
        },
      },
      async checkDatabase() {
        throw new AppError(503, "DATABASE_UNAVAILABLE", "Database is unavailable.");
      },
    });
    const response = await request(unavailable).get("/health/db").expect(503);
    expect(JSON.stringify(response.body)).not.toContain("DATABASE_URL");
  });

  it("registers, rejects duplicate email, logs in, and rejects an incorrect password", async () => {
    const cookie = await register();
    await request(app)
      .post("/api/auth/register")
      .send({ email: "PERSON@example.com", password: "a-long-test-password", displayName: "Again" })
      .expect(409);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "person@example.com", password: "incorrect-password" })
      .expect(401, {
        error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." },
      });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "PERSON@example.com", password: "a-long-test-password" })
      .expect(200);
    expect(login.body.user.email).toBe("person@example.com");
    expect(cookie).toContain("miryolove_session=");
  });

  it("requires auth for current-user endpoints and invalidates the session on logout", async () => {
    await request(app).get("/api/auth/me").expect(401);
    await request(app).post("/api/auth/logout").expect(401);
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", "miryolove_session=invalid-token")
      .expect(401);
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", "miryolove_session=invalid-token")
      .expect(401);
    const cookie = await register();
    const current = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    expect(current.body.user).toMatchObject({
      email: "person@example.com",
      displayName: "Person",
      avatarUrl: null,
    });
    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie).expect(204);
    expect(logout.headers["set-cookie"][0]).toContain("miryolove_session=");
    expect(logout.headers["set-cookie"][0]).toContain("Max-Age=0");
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    await request(app).get("/api/users/me").set("Cookie", cookie).expect(401);
  });

  it("reads and updates only allowed profile fields", async () => {
    const cookie = await register();
    const profile = await request(app).get("/api/users/me").set("Cookie", cookie).expect(200);
    expect(profile.body.user.displayName).toBe("Person");
    await request(app)
      .patch("/api/users/me")
      .set("Cookie", cookie)
      .send({ displayName: "Updated", avatarUrl: "https://example.com/avatar.png" })
      .expect(200)
      .expect(({ body }) => expect(body.user.displayName).toBe("Updated"));
    await request(app)
      .patch("/api/users/me")
      .set("Cookie", cookie)
      .send({ id: randomUUID() })
      .expect(400);
  });

  it("creates, lists, reads, updates, and deletes an owned chat", async () => {
    const cookie = await register();
    const created = await request(app)
      .post("/api/chats")
      .set("Cookie", cookie)
      .send({ title: "First chat" })
      .expect(201);
    const chatId = created.body.chat.id as string;
    await request(app).get("/api/chats").set("Cookie", cookie).expect(200);
    await request(app).get(`/api/chats/${chatId}`).set("Cookie", cookie).expect(200);
    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set("Cookie", cookie)
      .send({ title: "Renamed" })
      .expect(200)
      .expect(({ body }) => expect(body.chat.title).toBe("Renamed"));
    await request(app).delete(`/api/chats/${chatId}`).set("Cookie", cookie).expect(204);
    await request(app).get(`/api/chats/${chatId}`).set("Cookie", cookie).expect(404);
  });

  it("blocks access to another user's chat", async () => {
    const ownerCookie = await register();
    const created = await request(app)
      .post("/api/chats")
      .set("Cookie", ownerCookie)
      .send({ title: "Private chat" })
      .expect(201);
    const chatId = created.body.chat.id as string;
    const otherCookie = await register("other@example.com");
    await request(app).get(`/api/chats/${chatId}`).set("Cookie", otherCookie).expect(404);
    await request(app)
      .patch(`/api/chats/${chatId}`)
      .set("Cookie", otherCookie)
      .send({ title: "Stolen" })
      .expect(404);
    await request(app).delete(`/api/chats/${chatId}`).set("Cookie", otherCookie).expect(404);
    await request(app).get(`/api/chats/${chatId}/messages`).set("Cookie", otherCookie).expect(404);
    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", otherCookie)
      .send({ role: "user", content: "Unauthorized message" })
      .expect(404);
  });

  it("creates and lists messages only for chats owned by the caller", async () => {
    const cookie = await register();
    const chat = await request(app).post("/api/chats").set("Cookie", cookie).send({}).expect(201);
    const chatId = chat.body.chat.id as string;
    await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ role: "user", content: "This is a test message from the user." })
      .expect(201);
    for (const role of ["assistant", "system"]) {
      await request(app)
        .post(`/api/chats/${chatId}/messages`)
        .set("Cookie", cookie)
        .send({ role, content: "Forged trusted message." })
        .expect(400);
    }
    const messages = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .expect(200);
    expect(messages.body.messages).toHaveLength(1);
    expect(messages.body.messages[0].role).toBe("user");
  });

  it.each(["google", "yandex"] as const)(
    "generates %s OAuth state and validates callback",
    async (provider) => {
      const registeredCookie = await register();
      const start = await request(app).get(`/api/auth/${provider}`).expect(302);
      const state = new URL(start.headers.location as string).searchParams.get("state");
      const stateCookie = start.headers["set-cookie"][0].split(";")[0] as string;
      expect(state).toBeTruthy();
      const callback = await request(app)
        .get(`/api/auth/${provider}/callback`)
        .set("Cookie", stateCookie)
        .query({ code: "test-code", state })
        .expect(302);
      expect(callback.headers.location).toBeTruthy();
      expect(callback.headers["set-cookie"]).toBeDefined();
      expect(registeredCookie).toContain("miryolove_session=");
    },
  );

  it("rejects invalid OAuth state and provider callback errors", async () => {
    await request(app)
      .get("/api/auth/google/callback")
      .query({ code: "test-code", state: "a-state-value-long-enough" })
      .expect(400, {
        error: { code: "OAUTH_STATE_INVALID", message: "OAuth state validation failed." },
      });
    await request(app)
      .get("/api/auth/yandex/callback")
      .query({ error: "access_denied", state: "a-state-value-long-enough" })
      .expect(401);
  });

  it("returns AI_NOT_CONFIGURED without invoking a model", async () => {
    const cookie = await register();
    const chat = await request(app).post("/api/chats").set("Cookie", cookie).send({}).expect(201);
    await request(app)
      .post("/api/ai/chat")
      .set("Cookie", cookie)
      .send({ chatId: chat.body.chat.id, message: "Hello" })
      .expect(503, {
        error: { code: "AI_NOT_CONFIGURED", message: "AI is not configured." },
      });
  });
});
