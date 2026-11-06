import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(1).max(80),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
});

export const oauthCallbackSchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(16).max(256).optional(),
  error: z.string().max(128).optional(),
  error_description: z.string().max(1024).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
