import { z } from "zod";

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    avatarUrl: z
      .string()
      .url()
      .max(2048)
      .refine((value) => new URL(value).protocol === "https:", "Avatar URL must use HTTPS.")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");
