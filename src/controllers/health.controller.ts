import type { RequestHandler } from "express";

export function createHealthController(checkDatabase: () => Promise<void>): {
  health: RequestHandler;
  database: RequestHandler;
} {
  return {
    health: (_request, response) => {
      response.json({ status: "ok", service: "MiryoLove Server" });
    },
    database: async (_request, response) => {
      await checkDatabase();
      response.json({ status: "ok", database: "connected" });
    },
  };
}
