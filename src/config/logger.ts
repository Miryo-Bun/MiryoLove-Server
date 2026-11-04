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
      "sessionToken",
      "session_token",
      "access_token",
      "refresh_token",
      "sessionId",
      "session_id",
      "cookie",
      "headers.cookie",
      "headers.authorization",
      "authorization",
      "req.headers.cookie",
      "req.headers.authorization",
      "clientSecret",
      "client_secret",
    ],
    censor: "[REDACTED]",
  },
});
