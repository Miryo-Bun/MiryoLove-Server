import { randomBytes, createHmac } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import type { PublicUser, SessionResult } from "../types/contracts.js";
import { AppError } from "../utils/errors.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

type DatabaseUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
};

function publicUser(user: DatabaseUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function hashToken(token: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(token).digest("hex");
}

export class AuthService {
  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<SessionResult> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);

    try {
      const user = await prisma.user.create({
        data: { email, passwordHash, displayName: input.displayName.trim() },
      });
      return this.createSession(user.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(
          409,
          "EMAIL_ALREADY_REGISTERED",
          "An account with this email already exists.",
        );
      }
      throw error;
    }
  }

  async login(input: { email: string; password: string }): Promise<SessionResult> {
    const user = await prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    const valid = await verifyPassword(user?.passwordHash ?? null, input.password);

    if (!user || !user.passwordHash || !valid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    return this.createSession(user.id);
  }

  async authenticate(token: string): Promise<PublicUser | null> {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    return publicUser(session.user);
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    }
  }

  async createSession(userId: string): Promise<SessionResult> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [, session] = await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }),
      prisma.session.create({
        data: { userId, tokenHash: hashToken(token), expiresAt },
        include: { user: true },
      }),
    ]);
    return { user: publicUser(session.user), token, expiresAt };
  }
}
