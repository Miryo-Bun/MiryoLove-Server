import type { PublicUser } from "./contracts.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: PublicUser;
    }
  }
}

export {};
