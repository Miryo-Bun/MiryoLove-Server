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
}
