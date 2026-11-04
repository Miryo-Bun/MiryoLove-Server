import express from "express";
import request from "supertest";
import { describe, it } from "vitest";
import { createRateLimiter } from "../src/middleware/rate-limit.middleware.js";

describe("rate limiting", () => {
  it("rejects requests after the configured window limit", async () => {
    const app = express();
    app.use(createRateLimiter(5, 60_000, 2));
    app.get("/limited", (_request, response) => response.sendStatus(200));

    await request(app).get("/limited").expect(200);
    await request(app).get("/limited").expect(200);
    await request(app)
      .get("/limited")
      .expect(429, {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
        },
      });
  });
});
