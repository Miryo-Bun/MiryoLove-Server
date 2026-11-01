export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "MiryoLove Server API",
    version: "1.0.0",
    description: "REST API foundation for the future MiryoLove ecosystem.",
  },
  servers: [{ url: "http://localhost:3001" }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "miryolove_session" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
            required: ["code", "message"],
          },
        },
        required: ["error"],
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Service health",
        responses: { "200": { description: "Service is available." } },
      },
    },
    "/health/db": {
      get: {
        summary: "Database health",
        responses: { "200": { description: "Database is available." } },
      },
    },
    "/api/auth/register": {
      post: {
        summary: "Register with email and password",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "201": { description: "Registered and signed in." },
          "400": { description: "Invalid registration input." },
          "409": { description: "Email already registered." },
        },
      },
    },
    "/api/auth/login": {
      post: {
        summary: "Sign in with email and password",
        responses: {
          "200": { description: "Signed in." },
          "400": { description: "Invalid login input." },
          "401": { description: "Email or password is incorrect." },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        summary: "Invalidate the current session",
        security: [{ sessionCookie: [] }],
        responses: {
          "204": { description: "Signed out." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/api/auth/me": {
      get: {
        summary: "Get the current user",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Current user." },
          "401": { description: "Authentication is required." },
        },
      },
      "/api/auth/providers": {
        get: {
          summary: "List available OAuth providers",
          responses: {
            "200": {
              description:
                "Whether each OAuth provider is configured; no credentials are returned.",
            },
          },
        },
      },
    },
    "/api/auth/google": {
      get: {
        summary: "Begin Google OAuth",
        responses: { "302": { description: "Redirect to Google." } },
      },
    },
    "/api/auth/google/callback": {
      get: {
        summary: "Complete Google OAuth",
        responses: {
          "302": {
            description: "Redirect to the configured frontend after success or cancellation.",
          },
          "400": { description: "OAuth state validation failed." },
        },
      },
    },
    "/api/auth/yandex": {
      get: {
        summary: "Begin Yandex ID OAuth",
        responses: { "302": { description: "Redirect to Yandex." } },
      },
    },
    "/api/auth/yandex/callback": {
      get: {
        summary: "Complete Yandex ID OAuth",
        responses: {
          "302": {
            description: "Redirect to the configured frontend after success or cancellation.",
          },
          "400": { description: "OAuth state validation failed." },
        },
      },
    },
    "/api/users/me": {
      get: {
        summary: "Get profile",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Profile." },
          "401": { description: "Authentication is required." },
        },
      },
      patch: {
        summary: "Update display name or avatar URL",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Updated profile." },
          "400": { description: "Invalid profile input." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/api/chats": {
      get: {
        summary: "List own chats",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Chats." },
          "400": { description: "Invalid query parameters." },
          "401": { description: "Authentication is required." },
        },
      },
      post: {
        summary: "Create a chat",
        security: [{ sessionCookie: [] }],
        responses: {
          "201": { description: "Created chat." },
          "400": { description: "Invalid chat input." },
          "401": { description: "Authentication is required." },
        },
      },
    },
    "/api/chats/{chatId}": {
      get: {
        summary: "Get an owned chat",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Chat." },
          "400": { description: "Invalid chat ID." },
          "401": { description: "Authentication is required." },
          "404": { description: "Chat not found." },
        },
      },
      patch: {
        summary: "Rename an owned chat",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Updated chat." },
          "400": { description: "Invalid chat ID or input." },
          "401": { description: "Authentication is required." },
          "404": { description: "Chat not found." },
        },
      },
      delete: {
        summary: "Delete an owned chat",
        security: [{ sessionCookie: [] }],
        responses: {
          "204": { description: "Deleted chat." },
          "400": { description: "Invalid chat ID." },
          "401": { description: "Authentication is required." },
          "404": { description: "Chat not found." },
        },
      },
    },
    "/api/chats/{chatId}/messages": {
      get: {
        summary: "List messages in an owned chat",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": { description: "Messages." },
          "400": { description: "Invalid chat ID or query parameters." },
          "401": { description: "Authentication is required." },
          "404": { description: "Chat not found." },
        },
      },
      post: {
        summary: "Create a user message (no AI invocation)",
        description:
          "Assistant and system messages are server-managed and cannot be submitted here.",
        security: [{ sessionCookie: [] }],
        responses: {
          "201": { description: "Created user message." },
          "400": { description: "Invalid input or non-user message role." },
          "401": { description: "Authentication is required." },
          "404": { description: "Chat not found." },
        },
      },
    },
    "/api/ai/chat": {
      post: {
        summary: "Generate an authenticated AI chat response",
        description:
          "Calls the persistent local MiryoLove AI Python runtime. Conversation messages and returned source references are saved in the selected owned chat.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["chatId", "message"],
                properties: {
                  chatId: { type: "string", format: "uuid" },
                  message: { type: "string", minLength: 1, maxLength: 12000 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Generated response and sources used in its model context.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["content", "sources"],
                  properties: {
                    content: { type: "string" },
                    sources: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["source", "title", "url"],
                        properties: {
                          source: { type: "string" },
                          title: { type: "string" },
                          url: { type: "string", format: "uri" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid request input." },
          "401": { description: "Authentication is required." },
          "404": { description: "Chat not found." },
          "503": { description: "Model runtime unavailable or generation failed." },
          "504": { description: "Model response timed out." },
        },
      },
    },
  },
} as const;
