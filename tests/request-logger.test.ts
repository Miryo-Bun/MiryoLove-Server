import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRequestLogger } from "../src/middleware/request-logger.middleware.js";

describe("request logger privacy", () => {
  it("logs a route template and request metadata without resource IDs or query values", async () => {
    const entries: Record<string, unknown>[] = [];
    const app = express();
    app.use(createRequestLogger((fields) => entries.push(fields)));
    app.get("/api/chats/:chatId/messages", (_request, response) => {
      response.json({ content: "private user message" });
    });

    const chatId = randomUUID();
    const response = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .query({ access_token: "private-token" })
      .expect(200);

    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      method: "GET",
      route: "/api/chats/:chatId/messages",
      statusCode: 200,
    });
    const serialized = JSON.stringify(entries[0]);
    expect(serialized).not.toContain(chatId);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("private user message");
    expect(entries[0]).not.toHaveProperty("path");
  });

  it("does not log the requested path for unmatched routes", async () => {
    const entries: Record<string, unknown>[] = [];
    const app = express();
    app.use(createRequestLogger((fields) => entries.push(fields)));
    app.use((_request, response) => response.status(404).end());
    const privateSegment = randomUUID();

    await request(app).get(`/unmatched/${privateSegment}`).expect(404);

    expect(entries[0]).toMatchObject({ route: "unmatched", statusCode: 404 });
    expect(JSON.stringify(entries[0])).not.toContain(privateSegment);
  });
});
