import { createServer } from "node:http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { disconnectDatabase, prisma } from "./config/prisma.js";
import { createApp } from "./app.js";
import { AuthService } from "./services/auth.service.js";
import { ChatService } from "./services/chat.service.js";
import { OAuthService } from "./services/oauth.service.js";
import { ProfileService } from "./services/profile.service.js";
import { MiryoLoveAIService } from "./services/ai.service.js";
import { aiRuntime } from "./services/ai-runtime.service.js";
import { AppError } from "./utils/errors.js";

const authService = new AuthService();
const app = createApp({
  authService,
  oauthService: new OAuthService(authService),
  profileService: new ProfileService(),
  chatService: new ChatService(),
  aiService: new MiryoLoveAIService(new ChatService()),
  async checkDatabase() {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Database health check failed",
      );
      throw new AppError(503, "DATABASE_UNAVAILABLE", "Database is unavailable.");
    }
  },
});

const server = createServer(app);
server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, "MiryoLove Server started");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "MiryoLove Server shutting down");
  server.close(async (error) => {
    if (error) {
      logger.error({ errorName: error.name }, "HTTP server shutdown failed");
      process.exitCode = 1;
    }
    try {
      await aiRuntime.close();
    } catch (runtimeError) {
      logger.error(
        { errorName: runtimeError instanceof Error ? runtimeError.name : "UnknownError" },
        "AI runtime shutdown failed",
      );
      process.exitCode = 1;
    }
    try {
      await disconnectDatabase();
    } catch (disconnectError) {
      logger.error(
        { errorName: disconnectError instanceof Error ? disconnectError.name : "UnknownError" },
        "Database shutdown failed",
      );
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
