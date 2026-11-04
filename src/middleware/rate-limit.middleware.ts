import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

export function createRateLimiter(
  limit: number,
  windowMs: number,
  testLimit?: number,
): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs,
    limit: env.NODE_ENV === "test" ? (testLimit ?? 10_000) : limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
      });
    },
  });
}
