import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import {
  createRuntimeEnvironment,
  hasAIQueueCapacity,
} from "../src/services/ai-runtime.service.js";
import type { Prisma } from "../src/generated/prisma/client.js";
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
  sessionExpiry = new Map<string, Date>();

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

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    const currentPassword = this.credentials.get(userId);
    if (!currentPassword) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    if (currentPassword !== input.currentPassword) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    this.credentials.set(userId, input.newPassword);
    for (const [token, sessionUserId] of this.sessions) {
      if (sessionUserId === userId) {
        this.sessions.delete(token);
        this.sessionExpiry.delete(token);
      }
    }
  }

  async authenticate(token: string): Promise<PublicUser | null> {
    const userId = this.sessions.get(token);
    if (!userId) return null;
    const expiresAt = this.sessionExpiry.get(token);
    if (!expiresAt || expiresAt <= new Date()) {
      this.sessions.delete(token);
      this.sessionExpiry.delete(token);
      return null;
    }
    return this.users.get(userId) ?? null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) {
      this.sessions.delete(token);
      this.sessionExpiry.delete(token);
    }
  }

  async createSession(userId: string): Promise<SessionResult> {
    const currentUser = this.users.get(userId);
    if (!currentUser) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    const user = { ...currentUser, lastLoginAt: new Date() };
    this.users.set(userId, user);
    this.sessions.set(token, userId);
    this.sessionExpiry.set(token, expiresAt);
    return { user, token, expiresAt };
  }
}

class MemoryProfiles implements ProfileServiceContract {
  oauthProviders = new Map<string, Set<"google" | "yandex">>();

  constructor(
    private readonly auth: MemoryAuth,
    private readonly chats: MemoryChats,
  ) {}

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

  async delete(userId: string): Promise<void> {
    this.auth.users.delete(userId);
    this.auth.credentials.delete(userId);
    this.oauthProviders.delete(userId);
    for (const [token, sessionUserId] of this.auth.sessions) {
      if (sessionUserId === userId) {
        this.auth.sessions.delete(token);
        this.auth.sessionExpiry.delete(token);
      }
    }
    for (const [chatId, chat] of this.chats.chats) {
      if (chat.userId === userId) {
        this.chats.chats.delete(chatId);
        this.chats.messages.delete(chatId);
      }
    }
  }

  async listOAuthProviders(userId: string): Promise<Array<"google" | "yandex">> {
    if (!this.auth.users.has(userId))
      throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    return [...(this.oauthProviders.get(userId) ?? new Set())];
  }

  async unlinkOAuthProvider(userId: string, provider: "google" | "yandex"): Promise<void> {
    const linked = this.oauthProviders.get(userId) ?? new Set();
    if (!linked.has(provider)) {
      throw new AppError(404, "OAUTH_ACCOUNT_NOT_FOUND", "This OAuth connection was not found.");
    }

    const hasPasswordLogin = this.auth.credentials.has(userId);
    if (!hasPasswordLogin && linked.size === 1) {
      throw new AppError(
        409,
        "LAST_SIGN_IN_METHOD",
        "This is the last sign-in method. Add a password before disconnecting it.",
      );
    }

    linked.delete(provider);
    if (linked.size === 0) {
      this.oauthProviders.delete(userId);
      return;
    }
    this.oauthProviders.set(userId, linked);
  }

  linkOAuthProvider(userId: string, provider: "google" | "yandex"): void {
    const providers = this.oauthProviders.get(userId) ?? new Set();
    providers.add(provider);
    this.oauthProviders.set(userId, providers);
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
    input: {
      role: "user" | "assistant" | "system";
      content: string;
      sources?: Prisma.InputJsonValue;
    },
  ): Promise<MessageRecord> {
    await this.get(userId, chatId);
    const now = new Date();
    const message = {
      id: randomUUID(),
      chatId,
      role: input.role,
      content: input.content,
      sources: input.sources ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.messages.get(chatId)!.push(message);
    return message;
  }

  async createExchange(
    userId: string,
    chatId: string,
    input: { userMessage: string; assistantMessage: string; sources?: Prisma.InputJsonValue },
  ): Promise<[MessageRecord, MessageRecord]> {
    const userMessage = await this.createMessage(userId, chatId, {
      role: "user",
      content: input.userMessage,
    });
    const assistantMessage = await this.createMessage(userId, chatId, {
      role: "assistant",
      content: input.assistantMessage,
      ...(input.sources === undefined ? {} : { sources: input.sources }),
    });
    return [userMessage, assistantMessage];
  }

  async listMessages(userId: string, chatId: string, limit: number): Promise<MessageRecord[]> {
    await this.get(userId, chatId);
    return (this.messages.get(chatId) ?? []).slice(0, limit);
  }
}

class MemoryOAuth implements OAuthServiceContract {
  constructor(private readonly auth: MemoryAuth) {}

  isConfigured(): boolean {
    return true;
  }

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
  let profileService: MemoryProfiles;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    auth = new MemoryAuth();
    chats = new MemoryChats();
    profileService = new MemoryProfiles(auth, chats);
    app = createApp({
      authService: auth,
      oauthService: new MemoryOAuth(auth),
      profileService,
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
    expect(cookie).toContain("Path=/api");
    expect(cookie).toContain("Expires=");
    expect(cookie.toLowerCase().includes("; secure")).toBe(env.NODE_ENV === "production");
    expect(response.body).not.toHaveProperty("token");
    expect(response.body).not.toHaveProperty("expiresAt");
    return cookie.split(";")[0] as string;
  }

  it("reports OAuth provider availability without exposing credentials", async () => {
    await request(app)
      .get("/api/auth/providers")
      .expect(200, { providers: { google: true, yandex: true } });
  });

  it("reports the actual application cookie policy without exposing secret values", async () => {
    const response = await request(app).get("/api/auth/cookie-policy").expect(200);
    expect(response.body.cookies.session).toMatchObject({
      name: "miryolove_session",
      contents: "opaque_session_token",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/api",
      domain: null,
      maxAgeDays: env.SESSION_TTL_DAYS,
    });
    expect(response.body.cookies.oauthState).toMatchObject({
      names: ["miryolove_oauth_google", "miryolove_oauth_yandex"],
      contents: "oauth_state_value",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/api/auth/{provider}",
      domain: null,
      maxAgeSeconds: 600,
    });
    expect(response.body.cookies).toMatchObject({ analytics: false, advertising: false });
  });

  it("returns service and database health without disclosing database details", async () => {
    await request(app).get("/health").expect(200, { status: "ok", service: "MiryoLove Server" });
    await request(app).get("/health/db").expect(200, { status: "ok", database: "connected" });
    const unavailable = createApp({
      authService: auth,
      oauthService: new MemoryOAuth(auth),
      profileService: new MemoryProfiles(auth, chats),
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
    await request(app)
      .post("/api/auth/password")
      .send({ currentPassword: "a-long-test-password", newPassword: "new-long-test-password" })
      .expect(401);
    const expiredLogout = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", "miryolove_session=invalid-token")
      .expect(204);
    expect(expiredLogout.headers["set-cookie"][0]).toContain("Max-Age=0");
    expect(expiredLogout.headers["set-cookie"][0]).toContain("Path=/api");
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

  it("rejects expired sessions and allows several valid sessions for the same user", async () => {
    const firstCookie = await register();
    const secondLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "person@example.com", password: "a-long-test-password" })
      .expect(200);
    const firstToken = firstCookie.split("=")[1]!.split(";")[0];
    const secondToken = secondLogin.headers["set-cookie"][0].split(";")[0].split("=")[1];
    expect(
      [...auth.sessions.values()].filter((userId) => userId === auth.users.keys().next().value),
    ).toHaveLength(2);
    expect(auth.sessions.has(firstToken)).toBe(true);
    expect(auth.sessions.has(secondToken)).toBe(true);

    const expiredToken = randomUUID();
    const userId = [...auth.users.keys()][0]!;
    auth.sessions.set(expiredToken, userId);
    auth.sessionExpiry.set(expiredToken, new Date(Date.now() - 5000));

    await request(app)
      .get("/api/auth/me")
      .set("Cookie", `miryolove_session=${expiredToken}`)
      .expect(401);
    expect(auth.sessions.has(expiredToken)).toBe(false);
  });

  it("lists and deletes linked OAuth providers without leaving a user sign-in-less", async () => {
    const cookie = await register();
    const userId = [...auth.users.keys()][0]!;
    profileService.linkOAuthProvider(userId, "google");
    await request(app)
      .get("/api/users/me/oauth")
      .set("Cookie", cookie)
      .expect(200, {
        providers: ["google"],
      });
    await request(app).delete("/api/users/me/oauth/google").set("Cookie", cookie).expect(204);
    await request(app).get("/api/users/me/oauth").set("Cookie", cookie).expect(200, {
      providers: [],
    });

    profileService.linkOAuthProvider(userId, "google");
    await request(app).delete("/api/users/me/oauth/google").set("Cookie", cookie).expect(204);
    profileService.linkOAuthProvider(userId, "google");
    const otherCookie = await register("other@example.com");
    await request(app).delete("/api/users/me/oauth/google").set("Cookie", otherCookie).expect(404);
    await request(app).delete("/api/users/me/oauth/unknown").set("Cookie", cookie).expect(404);

    auth.credentials.delete(userId);
    profileService.linkOAuthProvider(userId, "google");
    await request(app)
      .delete("/api/users/me/oauth/google")
      .set("Cookie", cookie)
      .expect(409, {
        error: {
          code: "LAST_SIGN_IN_METHOD",
          message: "This is the last sign-in method. Add a password before disconnecting it.",
        },
      });

    auth.credentials.set(userId, "a-long-test-password");
    profileService.linkOAuthProvider(userId, "yandex");
    await request(app).delete("/api/users/me/oauth/yandex").set("Cookie", cookie).expect(204);
    await request(app).delete("/api/users/me/oauth/google").set("Cookie", cookie).expect(204);
  });

  it("requires the current password before updating credentials and invalidates active sessions", async () => {
    const cookie = await register();
    await request(app)
      .post("/api/auth/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "wrong-password", newPassword: "new-long-test-password" })
      .expect(401, {
        error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." },
      });

    const response = await request(app)
      .post("/api/auth/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "a-long-test-password", newPassword: "new-long-test-password" })
      .expect(204);
    expect(response.headers["set-cookie"][0]).toContain("miryolove_session=");
    expect(response.headers["set-cookie"][0]).toContain("Max-Age=0");

    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "person@example.com", password: "new-long-test-password" })
      .expect(200);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "person@example.com", password: "a-long-test-password" })
      .expect(401);
  });

  it("rejects malformed registration and login payloads before they reach the auth service", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "a-long-test-password", displayName: "Person" })
      .expect(400);
    await request(app)
      .post("/api/auth/register")
      .send({ email: "person@example.com", password: "", displayName: "Person" })
      .expect(400);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "person@example.com", password: "" })
      .expect(400);
    await request(app)
      .post("/api/auth/password")
      .set("Cookie", await register())
      .send({ currentPassword: "", newPassword: "new-long-test-password" })
      .expect(400);
  });

  it("rejects state-changing requests from origins outside the configured allowlist", async () => {
    await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://attacker.example")
      .send({ email: "person@example.com", password: "a-long-test-password" })
      .expect(403, {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "This request origin is not allowed.",
        },
      });
  });

  describe("AI runtime environment", () => {
    it("bounds the serialized AI request queue", () => {
      expect(hasAIQueueCapacity(0, 5)).toBe(true);
      expect(hasAIQueueCapacity(4, 5)).toBe(true);
      expect(hasAIQueueCapacity(5, 5)).toBe(false);
    });

    it("passes only runtime configuration and a small set of non-secret system variables", () => {
      const childEnv = createRuntimeEnvironment({
        PATH: "/usr/bin",
        HOME: "/home/test",
        DATABASE_URL: "must-not-be-passed",
        SESSION_SECRET: "must-not-be-passed",
        GOOGLE_CLIENT_SECRET: "must-not-be-passed",
        HTTPS_PROXY: "must-not-be-passed",
      });

      expect(childEnv.PATH).toBe("/usr/bin");
      expect(childEnv.HOME).toBe("/home/test");
      expect(childEnv.MIRYO_MODEL).toBeTruthy();
      expect(childEnv.DATABASE_URL).toBeUndefined();
      expect(childEnv.SESSION_SECRET).toBeUndefined();
      expect(childEnv.GOOGLE_CLIENT_SECRET).toBeUndefined();
      expect(childEnv.HTTPS_PROXY).toBeUndefined();
    });
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

  it("deletes the authenticated account and invalidates its sessions", async () => {
    await request(app).delete("/api/users/me").expect(401);
    const cookie = await register();
    const user = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    const chat = await request(app)
      .post("/api/chats")
      .set("Cookie", cookie)
      .send({ title: "Deleted with account" })
      .expect(201);
    const otherCookie = await register("other@example.com");
    await request(app)
      .delete(`/api/users/${user.body.user.id as string}`)
      .set("Cookie", otherCookie)
      .expect(404);
    await request(app)
      .get(`/api/chats/${chat.body.chat.id as string}`)
      .set("Cookie", cookie)
      .expect(200);
    const deleted = await request(app).delete("/api/users/me").set("Cookie", cookie).expect(204);
    expect(deleted.headers["set-cookie"][0]).toContain("Max-Age=0");
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    await request(app).get("/api/users/me").set("Cookie", cookie).expect(401);
    expect(chats.chats.has(chat.body.chat.id as string)).toBe(false);
    const otherProfile = await request(app)
      .get("/api/auth/me")
      .set("Cookie", otherCookie)
      .expect(200);
    expect(otherProfile.body.user.email).toBe("other@example.com");
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
    const start = await request(app).get("/api/auth/yandex").expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state");
    const cookie = start.headers["set-cookie"][0].split(";")[0] as string;
    expect(state).toBeTruthy();
    expect(cookie).toContain("miryolove_oauth_yandex=");
    const callback = await request(app)
      .get("/api/auth/yandex/callback")
      .set("Cookie", cookie)
      .query({ error: "access_denied", state })
      .expect(302);
    const destination = new URL(callback.headers.location as string);
    expect(destination.origin).toBe(new URL(env.FRONTEND_URL).origin);
    expect(destination.searchParams.get("oauthError")).toBe("OAUTH_REJECTED");
  });

  it("returns a generated answer and its sources from the authenticated AI endpoint", async () => {
    const cookie = await register();
    const chat = await request(app).post("/api/chats").set("Cookie", cookie).send({}).expect(201);
    const aiApp = createApp({
      authService: auth,
      oauthService: new MemoryOAuth(auth),
      profileService: new MemoryProfiles(auth, chats),
      chatService: chats,
      aiService: {
        async generateResponse(input) {
          expect(input.userId).toBeTruthy();
          expect(input.chatId).toBe(chat.body.chat.id);
          expect(input.message).toBe("Hello");
          return {
            content: "Generated by the model.",
            sources: [
              { source: "Wikipedia", title: "Test", url: "https://en.wikipedia.org/wiki/Test" },
            ],
          };
        },
      },
      async checkDatabase() {},
    });
    const response = await request(aiApp)
      .post("/api/ai/chat")
      .set("Cookie", cookie)
      .send({ chatId: chat.body.chat.id, message: "Hello" })
      .expect(200);
    expect(response.body).toEqual({
      content: "Generated by the model.",
      sources: [{ source: "Wikipedia", title: "Test", url: "https://en.wikipedia.org/wiki/Test" }],
    });
  });

  it("authenticates and validates AI requests before invoking the runtime", async () => {
    await request(app)
      .post("/api/ai/chat")
      .send({ chatId: randomUUID(), message: "Hello" })
      .expect(401);

    const cookie = await register();
    const chatId = randomUUID();
    await request(app)
      .post("/api/ai/chat")
      .set("Cookie", cookie)
      .send({ chatId: "not-a-uuid", message: "Hello" })
      .expect(400);
    await request(app)
      .post("/api/ai/chat")
      .set("Cookie", cookie)
      .send({ chatId, message: "   " })
      .expect(400);
    await request(app)
      .post("/api/ai/chat")
      .set("Cookie", cookie)
      .send({ chatId, message: "x".repeat(env.AI_MAX_INPUT_CHARS + 1) })
      .expect(400);
  });
});
