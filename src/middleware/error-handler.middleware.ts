import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/errors.js";

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Request validation failed." },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    response.status(413).json({
      error: { code: "REQUEST_TOO_LARGE", message: "Request body is too large." },
    });
    return;
  }

  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    response.status(400).json({
      error: { code: "INVALID_JSON", message: "Request body must contain valid JSON." },
    });
    return;
  }

  logger.error(
    { errorName: error instanceof Error ? error.name : "UnknownError" },
    "Unhandled request error",
  );
  response.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
  });
};
