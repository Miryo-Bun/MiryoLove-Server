import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "passwordHash",
      "password_hash",
      "token",
      "access_token",
      "refresh_token",
      "sessionId",
      "session_id",
      "cookie",
      "headers.cookie",
      "headers.authorization",
      "client_secret",
    ],
    censor: "[REDACTED]",
  },
});
