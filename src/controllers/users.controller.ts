import type { RequestHandler } from "express";
import type { ProfileServiceContract } from "../types/contracts.js";
import { updateProfileSchema } from "../schemas/user.schema.js";
import { getAuthenticatedUser } from "../middleware/auth.middleware.js";
import { validate } from "../utils/validation.js";
import { env } from "../config/env.js";
import { clearSessionCookie } from "../utils/cookies.js";

export function createUsersController(profileService: ProfileServiceContract): {
  getMe: RequestHandler;
  listOAuthProviders: RequestHandler;
  updateMe: RequestHandler;
  deleteMe: RequestHandler;
  deleteOAuthProvider: RequestHandler;
} {
  return {
    getMe: async (request, response) => {
      response.json({ user: await profileService.get(getAuthenticatedUser(request).id) });
    },
    listOAuthProviders: async (request, response) => {
      const userId = getAuthenticatedUser(request).id;
      response.json({ providers: await profileService.listOAuthProviders(userId) });
    },
    updateMe: async (request, response) => {
      const input = validate(updateProfileSchema, request.body);
      const update = {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      };
      response.json({
        user: await profileService.update(getAuthenticatedUser(request).id, update),
      });
    },
    deleteMe: async (request, response) => {
      await profileService.delete(getAuthenticatedUser(request).id);
      clearSessionCookie(response, env.NODE_ENV === "production");
      response.status(204).end();
    },
    deleteOAuthProvider: async (request, response) => {
      const provider = request.params.provider;
      if (provider !== "google" && provider !== "yandex") {
        response.status(404).json({
          error: {
            code: "OAUTH_ACCOUNT_NOT_FOUND",
            message: "This OAuth connection was not found.",
          },
        });
        return;
      }
      await profileService.unlinkOAuthProvider(getAuthenticatedUser(request).id, provider);
      response.status(204).end();
    },
  };
}
