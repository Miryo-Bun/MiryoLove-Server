import type { Request } from "express";
import type { ZodType } from "zod";
import { AppError } from "./errors.js";

export function validate<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed.");
  }
  return result.data;
}

export type ValidatedRequest<B, P = object, Q = object> = Request<P, unknown, B, Q>;
