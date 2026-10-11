import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .default("postgresql://miryo_user:miryo_password@localhost:5432/miryolove?schema=public"),
  SESSION_SECRET: z.string().min(32).default("local-development-secret-change-before-production"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5173"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_CALLBACK_URL: z.string().url().default("http://localhost:3001/api/auth/google/callback"),
  YANDEX_CLIENT_ID: z.string().default(""),
  YANDEX_CLIENT_SECRET: z.string().default(""),
  YANDEX_CALLBACK_URL: z.string().url().default("http://localhost:3001/api/auth/yandex/callback"),
  JSON_BODY_LIMIT: z.string().default("1mb"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
  );
}

if (
  parsed.data.NODE_ENV === "production" &&
  (parsed.data.SESSION_SECRET === "local-development-secret-change-before-production" ||
    parsed.data.SESSION_SECRET === "replace-with-at-least-32-random-characters")
) {
  throw new Error("SESSION_SECRET must be a unique random value in production.");
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
