import { Router } from "express";
import type { AuthServiceContract, ProfileServiceContract } from "../types/contracts.js";
import { createUsersController } from "../controllers/users.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export function createUsersRoutes(
  authService: AuthServiceContract,
  profileService: ProfileServiceContract,
): Router {
  const router = Router();
  const controller = createUsersController(profileService);
  router.use(requireAuth(authService));
  router.get("/me", controller.getMe);
  router.patch("/me", controller.updateMe);
  return router;
}
