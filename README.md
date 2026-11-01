# MiryoLove Server

MiryoLove Server is the backend and REST API foundation for the MiryoLove ecosystem. It provides account registration and sign-in, server-side sessions, profiles, chats, messages, PostgreSQL persistence, optional Google and Yandex OAuth, and the authenticated MiryoLove AI endpoint.

The website is a separate project in `../MiryoLove AI Web`. English is the default interface language; Russian is also supported. The server starts the existing Python model script as one persistent local runtime when the first authenticated AI request arrives.

## Products and language policy

These are distinct products:

- **MiryoLove Server** — this backend and REST API.
- **MiryoLove AI Web** — the separate EN/RU browser app.
- **MiryoLove AI** — the existing Python logic and ready model weights in their separate directories.
- **MiryoLove Training** — a future model-training system, outside this project.

English is the primary language of the project and interface. Russian is the only additional interface language. The current API does not store a preferred locale or localize its response messages.

## Architecture

```text
MiryoLove AI Web
        | HTTPS / session-cookie REST API
        v
MiryoLove Server
        +---- Express routes and controllers
        +---- Auth, profile, chat, OAuth and AI service contracts
        +---- PostgreSQL through Prisma
        +---- Google OAuth 2.0 / Yandex ID (optional)
        +---- Persistent Python AI Runtime (existing MiryoLove AI script/model)
        +---- MiryoWiki MediaWiki API and Russian/English Wikipedia retrieval
```

The HTTP layer is organized into routes, controllers, Zod schemas, middleware, services, and service contracts. Prisma connects to PostgreSQL. The AI runtime starts lazily and loads the model once per process; generation requests are serialized. The existing Python script searches MiryoWiki and the question-language Wikipedia only for explicit encyclopedic/current-information prompts. Source references are stored on assistant messages.

## Implemented capabilities

- Email/password registration and login; passwords are hashed with Argon2id.
- Opaque server-side sessions in PostgreSQL, represented only by an HTTP-only `SameSite=Lax` cookie scoped to `/api` and marked `Secure` in production. The browser never receives the session token in JSON or stores it in Web Storage.
- Current-user and profile read/update operations.
- Create, list, read, rename, and delete a caller's own chats.
- Create and list messages within an owned chat.
- Optional Google and Yandex authorization-code OAuth.
- Authenticated AI chat using the existing Python model and stored conversation history.
- MiryoWiki/Wikipedia retrieval with persisted article links when source text was included in the model prompt.
- Message source references in nullable PostgreSQL JSONB.
- Health endpoints, request validation, JSON error responses, request logging, rate limits, and development OpenAPI/Swagger.

The public message-creation endpoint accepts only the `user` role. `assistant` and `system` messages must only be created by trusted server-side code. The AI endpoint stores user and assistant messages only after model generation succeeds. Logout clears the cookie even when the server-side session has expired.

## Technology

- Node.js 20.19 or later; Node.js 22 or later LTS is recommended.
- TypeScript strict mode and Express 5.
- PostgreSQL 17 and Prisma ORM 7.
- Zod, Argon2id, `cookie`, and opaque HMAC-hashed server-side sessions.
- Optional Google OAuth 2.0 and Yandex ID OAuth.
- Pino, Helmet, exact-origin CORS and backend Origin checks for allowed browser origins, plus per-route rate limits. CSRF protection combines `SameSite=Lax` cookies with the backend origin allowlist; state-changing application operations do not use GET routes.
- Vitest and Supertest; ESLint and Prettier.
- Swagger UI at `/docs` and OpenAPI JSON at `/openapi.json` in development only.

## Requirements

- Node.js 20.19+ and npm.
- PostgreSQL 17, either installed locally or run with Docker Compose.
- Docker Compose is optional when a PostgreSQL server is already available.

## Installation and environment

From the project root:

```sh
npm install
```

For a new checkout, copy the example environment file only if a local `.env` does not already exist:

```sh
cp -n .env.example .env
```

If `.env` already exists, preserve its values and update it manually as needed. Never replace a working local environment file blindly. `.env` is ignored by Git; `.env.example` is a template and must not contain real credentials.

Configure a unique, high-entropy `SESSION_SECRET` before deploying. The development fallback is not suitable for production. Never commit passwords, database URLs containing credentials, OAuth secrets, session values, or generated dumps.

| Variable                                                              | Purpose                                                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV`                                                            | `development`, `test`, or `production`; defaults to `development`.                  |
| `PORT`                                                                | HTTP listen port; defaults to `3001`.                                               |
| `DATABASE_URL`                                                        | PostgreSQL connection URL.                                                          |
| `SESSION_SECRET`                                                      | HMAC key used to hash session tokens in the database.                               |
| `SESSION_TTL_DAYS`                                                    | Server-side session lifetime in days.                                               |
| `CORS_ORIGINS`                                                        | Comma-separated list of exact allowed browser origins.                              |
| `FRONTEND_URL`                                                        | Fixed redirect target after successful OAuth.                                       |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`     | Optional Google OAuth configuration.                                                |
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, `YANDEX_CALLBACK_URL`     | Optional Yandex ID configuration.                                                   |
| `JSON_BODY_LIMIT`                                                     | Maximum JSON request body size.                                                     |
| `AI_RUNTIME_PYTHON`                                                   | Existing Python interpreter; defaults to the MiryoLove AI `.venv`.                  |
| `AI_RUNTIME_SCRIPT`                                                   | Existing `miryolove_ai.py` script path.                                             |
| `MIRYO_MODEL_PATH`                                                    | Ready model directory; defaults to `/mnt/Tears/MiryoLove AI/Qwen/miryo_merged_7b`.  |
| `MIRYOWIKI_API`, `MIRYOWIKI_URL`                                      | MiryoWiki API and article base URLs.                                                |
| `AI_RUNTIME_TIMEOUT_MS`                                               | Model startup/generation timeout; defaults to 20 minutes.                           |
| `AI_MAX_NEW_TOKENS`                                                   | Output-token ceiling; defaults to the existing 1,700-token setting.                 |
| `AI_MAX_INPUT_CHARS`                                                  | Maximum current message size; defaults to 12,000 characters.                        |
| `AI_MAX_HISTORY_MESSAGES`                                             | Maximum recent stored turns sent to the runtime; defaults to 32 messages.           |
| `AI_MAX_SOURCE_CHARS`                                                 | Per-source excerpt ceiling; defaults to 2,400 characters.                           |
| `AI_CONTEXT_TOKENS`                                                   | Optional context cap; `0` uses the model's `max_position_embeddings` (32,768 here). |
| `AI_TEMPERATURE`, `AI_TOP_P`, `AI_DO_SAMPLE`, `AI_REPETITION_PENALTY` | Sampling settings; defaults match this model's generation config.                   |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`  | Optional Compose PostgreSQL settings; keep them aligned with `DATABASE_URL`.        |

`DATABASE_URL` must connect to PostgreSQL. SQLite and MongoDB are not supported. Do not print `.env` contents in logs, tickets, or documentation.

## PostgreSQL with Docker Compose

The Compose configuration starts PostgreSQL only. It stores database data in the named `miryolove-postgres-data` volume and publishes its port on `127.0.0.1` by default.

```sh
docker compose up -d
docker compose ps
```

Compose settings may be supplied through the environment. If PostgreSQL settings are changed, ensure `DATABASE_URL` points to the matching host, port, database, and user. Do not expose development database credentials on a public interface.

Stop the service without removing its named data volume:

```sh
docker compose down
```

Do not remove the volume or edit `postgres-data/` as routine cleanup. Destructive database or volume operations require an explicit data-retention decision and a verified backup.

## Prisma and migrations

Generate the Prisma client:

```sh
npm run db:generate
```

For local migration development, the project provides:

```sh
npm run db:migrate
```

For applying reviewed migrations to a target database:

```sh
npm run db:deploy
```

`db:migrate` and `db:deploy` connect to the database selected by `DATABASE_URL` and can change its schema. Verify the target environment before running either command. Never use a production or user database for experiments. Test new migrations against a separate disposable PostgreSQL database first.

Other available Prisma command:

```sh
npm run db:studio
```

The schema defines users, OAuth accounts, sessions, chats, and messages (including nullable JSONB source references). It uses UUID identifiers, unique email and provider-account constraints, foreign keys with cascade behavior, PostgreSQL enums, and indexes for session expiry, user chats, and chat messages. Password hashes and raw session tokens are not returned by API responses; only an HMAC of each random session token is stored.

## Run and build

Run the development server with file watching:

```sh
npm run dev
```

Build (generate Prisma client and compile TypeScript), then start the compiled server:

```sh
npm run build
npm start
```

The application listens on `PORT` (default `3001`). `/health` reports service status. `/health/db` checks PostgreSQL and returns a generic unavailable response if the database cannot be reached. The server does not apply migrations automatically at startup.

## Tests and code quality

```sh
npm test
npm run lint
npm run format:check
```

`npm test` runs the Vitest suite. HTTP tests use in-memory service doubles for authentication, validation, ownership checks, OAuth state, and error behavior; password hashing is tested separately. The project also supports Prisma schema validation:

```sh
npx prisma validate
```

Compose configuration can be checked without starting services:

```sh
docker compose config --quiet
```

For database integration checks, use a separate disposable PostgreSQL instance and a dedicated test `DATABASE_URL`; do not point test commands at a user database.

## OAuth setup (optional)

Email/password authentication works without OAuth credentials. OAuth configuration is optional. Never commit client secrets.

### Google

1. Create an OAuth 2.0 Web client and configure its consent screen.
2. Register `http://localhost:3001/api/auth/google/callback` as a local development redirect URI.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in the local environment.
4. Start the flow with `GET /api/auth/google`.

The server uses the authorization-code flow with `openid email profile`, validates a random state value against a short-lived HTTP-only cookie, and requires a verified Google email. Provider access tokens are not stored.

### Yandex ID

1. Register an OAuth application in Yandex ID.
2. Register `http://localhost:3001/api/auth/yandex/callback` as a local development callback.
3. Set `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, and `YANDEX_CALLBACK_URL` in the local environment.
4. Start the flow with `GET /api/auth/yandex`.

The server exchanges the authorization code, obtains the provider profile, and uses the same state-cookie protection. Provider access tokens are not stored. Provider errors and configuration failures are logged without authorization codes, state values, client secrets, or access tokens.

If a provider email already belongs to an account, the server returns `ACCOUNT_LINKING_REQUIRED`; it does not automatically merge accounts. Authenticated provider linking and unlinking are not implemented.

## REST API

All JSON errors use this shape:

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message." } }
```

Authenticated routes use the `miryolove_session` HTTP-only cookie. The server does not issue a bearer token to the frontend. For browser requests, use credentialed requests and an allowed origin.

| Method   | Path                          | Authentication | Behavior                                                             |
| -------- | ----------------------------- | -------------- | -------------------------------------------------------------------- |
| `GET`    | `/health`                     | No             | Service status.                                                      |
| `GET`    | `/health/db`                  | No             | PostgreSQL connectivity check.                                       |
| `POST`   | `/api/auth/register`          | No             | Register with email, password, and display name; starts a session.   |
| `POST`   | `/api/auth/login`             | No             | Sign in with email and password.                                     |
| `POST`   | `/api/auth/logout`            | Yes            | Revoke the current session and clear the cookie.                     |
| `GET`    | `/api/auth/me`                | Yes            | Return the current public user.                                      |
| `GET`    | `/api/auth/providers`         | No             | Report which OAuth providers are configured; no secrets are exposed. |
| `GET`    | `/api/auth/google`            | No             | Start Google OAuth.                                                  |
| `GET`    | `/api/auth/google/callback`   | OAuth state    | Complete Google OAuth.                                               |
| `GET`    | `/api/auth/yandex`            | No             | Start Yandex ID OAuth.                                               |
| `GET`    | `/api/auth/yandex/callback`   | OAuth state    | Complete Yandex ID OAuth.                                            |
| `GET`    | `/api/users/me`               | Yes            | Read the current profile.                                            |
| `PATCH`  | `/api/users/me`               | Yes            | Update display name and/or HTTPS avatar URL.                         |
| `POST`   | `/api/chats`                  | Yes            | Create a chat; title is optional.                                    |
| `GET`    | `/api/chats`                  | Yes            | List the caller's chats; `limit` is 1–100 (default 50).              |
| `GET`    | `/api/chats/:chatId`          | Yes            | Read an owned chat.                                                  |
| `PATCH`  | `/api/chats/:chatId`          | Yes            | Rename an owned chat.                                                |
| `DELETE` | `/api/chats/:chatId`          | Yes            | Delete an owned chat and its messages.                               |
| `POST`   | `/api/chats/:chatId/messages` | Yes            | Store a user message only.                                           |
| `GET`    | `/api/chats/:chatId/messages` | Yes            | List messages in an owned chat; `limit` is 1–100 (default 50).       |
| `POST`   | `/api/ai/chat`                | Yes            | Generate a local model response and return sources actually used.    |

Request details:

- Registration body: `email`, `password` (12–128 characters), and `displayName` (1–80 characters).
- Login body: `email` and `password`.
- Profile update body: `displayName` and/or `avatarUrl`; avatar URLs must use HTTPS. At least one field is required.
- Chat creation accepts an optional `title` (1–200 characters); rename requires `title`.
- Message creation requires `role: "user"` and non-empty `content` up to 100,000 characters. Client-provided `assistant` and `system` roles are rejected.
- AI request body accepts an owned `chatId` (UUID) and `message` (up to 12,000 characters); the response contains generated `content` and an array of `sources`.
- AI generation stores the user and assistant messages in the chat. Assistant messages retain source metadata in the `sources` JSONB column.

Chat lookups and mutations are scoped to the authenticated owner. Another user's chat is reported as not found. Deleting a chat deletes its messages through the configured database relation.

In development, API documentation is available at `http://localhost:3001/docs`, with the OpenAPI document at `http://localhost:3001/openapi.json`. Both are disabled outside development.

## Authentication and security

- Passwords are hashed using Argon2id. Login does not distinguish an unknown email from an incorrect password.
- Session tokens are random and opaque. PostgreSQL stores only an HMAC hash; session lifetime is checked server-side and logout revokes the session.
- Session cookies are `HttpOnly`, `SameSite=Lax`, scoped to `/api`, and expire with the server-side session; `Secure` is set when `NODE_ENV=production`.
- CORS uses exact configured origins with credentials; requests with an untrusted `Origin` are rejected.
- Helmet adds security headers. JSON request size, endpoint rates, request bodies, path parameters, and query parameters are limited or validated.
- OAuth state is checked against a short-lived HTTP-only cookie.
- Errors do not return stack traces or database connection details. Request logs omit bodies, query strings, cookies, passwords, OAuth codes, and tokens.
- The PostgreSQL Compose port binds to localhost by default.

Before production, use HTTPS, a unique high-entropy secret from a secure configuration system, trusted exact origins, secured PostgreSQL credentials/networking, and reviewed backup/retention procedures. CSRF protection relies on `SameSite=Lax` and backend Origin allowlisting; preserve both when changing the browser deployment topology.

## MiryoLove AI runtime and retrieval

The backend starts the existing `../MiryoLove AI/miryolove_ai.py` in one persistent Python process on the first authenticated AI request. It loads the ready model from `/mnt/Tears/MiryoLove AI/Qwen/miryo_merged_7b` once and serializes generation requests. Configure the interpreter, script, model path, and timeout with the `AI_RUNTIME_*` and `MIRYO_MODEL_PATH` variables. The runtime is not started at backend boot; the first request can take several minutes while the model loads. The existing model script does not implement token streaming.

The AI service checks chat ownership before loading up to 32 prior messages. The runtime tokenizes the full chat-template prompt, uses the model config's 32,768-token context limit (the tokenizer advertises 131,072, which is not the model limit), prunes oldest history first, then reduces or drops source excerpts to reserve configured output tokens. The current question is added once after the history. Generation uses the model's EOS IDs and inference mode; temperature, top-p, sampling, repetition penalty, and token/character ceilings are configurable.

The assistant answers general questions as well as programming, Linux, databases, science, history, translation, learning, and project discussion. It identifies Russian or English from the current message. Knowledge retrieval runs only for explicit reference/current-information questions; search titles must match at least 80% of cleaned query terms, reducing unrelated partial-word matches. Only relevant bounded extracts are included. If no relevant source is found or a source is unavailable, the model can still answer without claiming citations. Sources are returned only if their text remains in the final prompt.

The `/api/auth/cookie-policy` endpoint reports the actual session and short-lived OAuth-state cookies (names, contents, flags, host-only scope, paths, and retention), plus whether analytics or advertising cookies are configured. Cookie questions are answered from that server-provided policy, not from a guessed prompt.

The additive migration `20261101190000_add_message_sources` adds a nullable JSONB column; apply it with `npm run db:deploy` after verifying `DATABASE_URL`. OAuth providers work only after server-side client credentials and registered callback URLs are configured. The separate frontend's run and Caddy instructions are in `../MiryoLove AI Web/README.md`.

The runtime does not expose model tools, arbitrary SQL, or filesystem access. Password reset and token streaming are not implemented because the existing backend/model contract does not provide them.

## Project structure

```text
src/
  config/        Environment, logger, Prisma client
  controllers/   HTTP request handlers
  docs/          OpenAPI document
  middleware/    Authentication, rate limits, errors, request logging
  routes/        Auth, user profile, and chat routes
  schemas/       Zod request schemas
  services/      Auth, OAuth, profile, chat, AI boundary
  types/         Service contracts and Express request augmentation
  utils/         Cookies, errors, validation, password hashing
  app.ts         Express app composition
  server.ts      HTTP lifecycle and PostgreSQL health check
prisma/
  schema.prisma
  migrations/
tests/
```

## Documentation languages

- Russian: [README.ru.md](README.ru.md)
