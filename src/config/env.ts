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
  AI_RUNTIME_PYTHON: z
    .string()
    .default("/mnt/Manchild/Project/MiryoLove/MiryoLove AI/.venv/bin/python"),
  AI_RUNTIME_SCRIPT: z
    .string()
    .default("/mnt/Manchild/Project/MiryoLove/MiryoLove AI/miryolove_ai.py"),
  MIRYO_MODEL_PATH: z.string().default("/mnt/Tears/MiryoLove AI/Qwen/miryo_merged_7b"),
  MIRYOWIKI_API: z.string().url().default("https://wiki.miryolove.org/api.php"),
  MIRYOWIKI_URL: z.string().url().default("https://wiki.miryolove.org"),
  AI_RUNTIME_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(3_600_000).default(1_200_000),
  AI_MAX_NEW_TOKENS: z.coerce.number().int().min(64).max(8192).default(1700),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(1000).max(100_000).default(12_000),
  AI_MAX_HISTORY_MESSAGES: z.coerce.number().int().min(2).max(100).default(32),
  AI_MAX_SOURCE_CHARS: z.coerce.number().int().min(256).max(20_000).default(2400),
  AI_CONTEXT_TOKENS: z.coerce.number().int().min(0).max(131_072).default(0),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  AI_TOP_P: z.coerce.number().min(0.01).max(1).default(0.8),
  AI_DO_SAMPLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AI_REPETITION_PENALTY: z.coerce.number().min(0.1).max(2).default(1.05),
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
