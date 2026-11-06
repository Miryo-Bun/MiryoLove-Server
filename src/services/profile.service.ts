import { prisma } from "../config/prisma.js";
import type { PublicUser } from "../types/contracts.js";
import { AppError } from "../utils/errors.js";

function toPublicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export class ProfileService {
  async get(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    return toPublicUser(user);
  }

  async update(
    userId: string,
    input: { displayName?: string; avatarUrl?: string | null },
  ): Promise<PublicUser> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: input,
    });
    return toPublicUser(user);
  }

  async delete(userId: string): Promise<void> {
    const result = await prisma.user.deleteMany({ where: { id: userId } });
    if (result.count !== 1) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
  }

  async listOAuthProviders(userId: string): Promise<Array<"google" | "yandex">> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { oauthAccounts: { select: { provider: true } } },
    });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    return user.oauthAccounts.map((account) => account.provider);
  }

  async unlinkOAuthProvider(userId: string, provider: "google" | "yandex"): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true,
        oauthAccounts: { select: { provider: true } },
      },
    });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User was not found.");

    if (!user.oauthAccounts.some((account) => account.provider === provider)) {
      throw new AppError(404, "OAUTH_ACCOUNT_NOT_FOUND", "This OAuth connection was not found.");
    }

    const remainingProviders = user.oauthAccounts.filter(
      (account) => account.provider !== provider,
    );
    const hasPasswordLogin = typeof user.passwordHash === "string" && user.passwordHash.length > 0;
    if (!hasPasswordLogin && remainingProviders.length === 0) {
      throw new AppError(
        409,
        "LAST_SIGN_IN_METHOD",
        "This is the last sign-in method. Add a password before disconnecting it.",
      );
    }

    const result = await prisma.oAuthAccount.deleteMany({
      where: { userId, provider },
    });
    if (result.count !== 1) {
      throw new AppError(404, "OAUTH_ACCOUNT_NOT_FOUND", "This OAuth connection was not found.");
    }
  }
}
