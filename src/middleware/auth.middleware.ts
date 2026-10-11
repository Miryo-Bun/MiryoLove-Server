import type { Request, RequestHandler } from "express";
import type { AuthServiceContract } from "../types/contracts.js";
import { readSessionCookie } from "../utils/cookies.js";
import { AppError } from "../utils/errors.js";

export function requireAuth(authService: AuthServiceContract): RequestHandler {
  return async (request, _response, next) => {
    try {
      const token = readSessionCookie(request.headers.cookie);
      const user = token ? await authService.authenticate(token) : null;
      if (!user) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
      request.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function optionalAuth(authService: AuthServiceContract): RequestHandler {
  return async (request, _response, next) => {
    try {
      const token = readSessionCookie(request.headers.cookie);
      if (token) {
        const user = await authService.authenticate(token);
        if (user) request.authUser = user;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getAuthenticatedUser(request: Request): NonNullable<Request["authUser"]> {
  if (!request.authUser) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
  return request.authUser;
}
