import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { openApiDocument } from "./docs/openapi.js";
import { errorHandler } from "./middleware/error-handler.middleware.js";
import { requestLogger } from "./middleware/request-logger.middleware.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { createRateLimiter } from "./middleware/rate-limit.middleware.js";
import { createAIController } from "./controllers/ai.controller.js";
import { createHealthController } from "./controllers/health.controller.js";
import { createAuthRoutes } from "./routes/auth.routes.js";
import { createChatsRoutes } from "./routes/chats.routes.js";
import { createUsersRoutes } from "./routes/users.routes.js";
import type {
  AIServiceContract,
  AuthServiceContract,
  ChatServiceContract,
  OAuthServiceContract,
  ProfileServiceContract,
} from "./types/contracts.js";
import { AppError } from "./utils/errors.js";

export interface AppDependencies {
  authService: AuthServiceContract;
  oauthService: OAuthServiceContract;
  profileService: ProfileServiceContract;
  chatService: ChatServiceContract;
  aiService: AIServiceContract;
  checkDatabase: () => Promise<void>;
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  const allowedOrigins = new Set(env.corsOrigins);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(requestLogger);
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin) {
          callback(null, false);
          return;
        }
        callback(null, allowedOrigins.has(origin) ? origin : false);
      },
    }),
  );
  app.use((request, _response, next) => {
    const origin = request.get("origin");
    if (origin && !allowedOrigins.has(origin)) {
      next(new AppError(403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed."));
      return;
    }
    next();
  });
  app.use(express.json({ limit: env.JSON_BODY_LIMIT, strict: true }));

  const health = createHealthController(dependencies.checkDatabase);
  app.get("/health", health.health);
  app.get("/health/db", health.database);
  app.use("/api/auth", createAuthRoutes(dependencies.authService, dependencies.oauthService));
  app.use("/api/users", createUsersRoutes(dependencies.authService, dependencies.profileService));
  app.use("/api/chats", createChatsRoutes(dependencies.authService, dependencies.chatService));
  app.post(
    "/api/ai/chat",
    requireAuth(dependencies.authService),
    createRateLimiter(5, 60 * 1000),
    createAIController(dependencies.aiService),
  );

  if (env.NODE_ENV === "development") {
    app.use("/docs", (_request, response, next) => {
      response.removeHeader("Content-Security-Policy");
      next();
    });
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
    app.get("/openapi.json", (_request, response) => response.json(openApiDocument));
  }

  app.use((_request, _response, next) => {
    next(new AppError(404, "NOT_FOUND", "The requested resource was not found."));
  });
  app.use(errorHandler);
  return app;
}
