import type { AIServiceContract } from "../types/contracts.js";
import { AppError } from "../utils/errors.js";

export class UnconfiguredAIService implements AIServiceContract {
  async generateResponse(): Promise<never> {
    throw new AppError(503, "AI_NOT_CONFIGURED", "MiryoLove AI is not configured yet.");
  }
}
