import { Router } from "express";
import type { AuthServiceContract, OAuthServiceContract } from "../types/contracts.js";
import { createAuthController } from "../controllers/auth.controller.js";
import { createRateLimiter } from "../middleware/rate-limit.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export function createAuthRoutes(
  authService: AuthServiceContract,
  oauthService: OAuthServiceContract,
): Router {
  const router = Router();
  const controller = createAuthController(authService, oauthService);
  router.post("/register", createRateLimiter(5, 15 * 60 * 1000), controller.register);
  router.post("/login", createRateLimiter(10, 15 * 60 * 1000), controller.login);
  router.post("/logout", requireAuth(authService), controller.logout);
  router.get("/me", requireAuth(authService), controller.me);
  for (const provider of ["google", "yandex"] as const) {
    const limiter = createRateLimiter(10, 15 * 60 * 1000);
    router.get(`/${provider}`, limiter, controller.oauthStart(provider));
    router.get(`/${provider}/callback`, limiter, controller.oauthCallback(provider));
  }
  return router;
}
