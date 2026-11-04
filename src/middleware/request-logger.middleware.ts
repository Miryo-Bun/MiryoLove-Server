import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { logger } from "../config/logger.js";

type RequestLogWriter = (fields: Record<string, unknown>, message: string) => void;

export function getSafeRouteLabel(request: Pick<Request, "baseUrl" | "route">): string {
  if (!request.route) return "unmatched";
  return typeof request.route.path === "string"
    ? `${request.baseUrl}${request.route.path}`
    : "registered-route";
}

export function createRequestLogger(
  writeLog: RequestLogWriter = (fields, message) => logger.info(fields, message),
): RequestHandler {
  return (request, response, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    response.setHeader("X-Request-Id", requestId);
    response.on("finish", () => {
      writeLog(
        {
          requestId,
          method: request.method,
          route: getSafeRouteLabel(request),
          statusCode: response.statusCode,
          responseTimeMs: Math.round(performance.now() - startedAt),
        },
        "HTTP request",
      );
    });
    next();
  };
}

export const requestLogger = createRequestLogger();
