import { Router } from "express";
import type { AuthServiceContract, ChatServiceContract } from "../types/contracts.js";
import { createChatsController } from "../controllers/chats.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { createRateLimiter } from "../middleware/rate-limit.middleware.js";

export function createChatsRoutes(
  authService: AuthServiceContract,
  chatService: ChatServiceContract,
): Router {
  const router = Router();
  const controller = createChatsController(chatService);
  router.use(requireAuth(authService));
  router.post("/", controller.create);
  router.get("/", controller.list);
  router.get("/:chatId", controller.get);
  router.patch("/:chatId", controller.update);
  router.delete("/:chatId", controller.delete);
  router.post("/:chatId/messages", createRateLimiter(30, 60 * 1000), controller.createMessage);
  router.get("/:chatId/messages", controller.listMessages);
  return router;
}
