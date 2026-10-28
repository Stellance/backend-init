# API Template

NestJS 12 (Express) API on Postgres 18 (Drizzle) and Redis. Includes JWT auth with refresh rotation, RBAC + CASL, Redis token-bucket rate limiting, request/trace IDs, structured logging, an append-only audit log, and migrate-on-deploy for Railway.

## Using this template

One command, no git history (`degit` downloads the files only):

```bash
pnpm dlx degit <github-user>/<repo> my-api && cd my-api && pnpm install && pnpm init-project my-api
```

`init-project` names the package, regenerates the migrations from scratch (fresh `init` plus the audit-log trigger), writes `.env` with a random `JWT_ACCESS_SECRET`, then deletes itself. Afterwards set `DATABASE_URL` and `REDIS_URL` in `.env`, then run `git init`.

## Local development

```bash
cp .env.example .env        # fill DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET
pnpm install
pnpm build && pnpm db:migrate
pnpm start:dev
```

Logs are human-readable outside `NODE_ENV=production` and JSON in production.
Set `SWAGGER_ENABLED=true` to serve OpenAPI docs at `/docs`.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / oxlint |
| `pnpm test` | unit tests |
| `pnpm test:e2e` | e2e against real Postgres and Redis (`DATABASE_URL`, `REDIS_URL` must point at disposable instances) |
| `pnpm db:generate` | generate a SQL migration after editing `src/database/schema/` |
| `pnpm db:migrate` | apply migrations from `./drizzle` (needs a prior `pnpm build`) |

## Architecture notes

- **Config**: env is validated at boot (`src/config/env.validation.ts`); the app refuses to start on bad values.
- **Sessions**: the access token carries `sid` (the refresh-token family). Logout, logout-all, refresh-reuse detection and password reset add `sid`s to a Redis denylist (`revoked:sid:*`, TTL = access TTL) that `JwtAuthGuard` checks, so tokens die immediately instead of at expiry. Session-changing writes lock the `users` row first, then `refresh_tokens` rows.
- **Account recovery**: `forgot-password` always answers 202 and mails in the background (no account probing). `reset-password` and `verify-email` take a single-use hashed token from `one_time_tokens` (one pending row per user and purpose; 1 h and 24 h TTL). Tokens travel in request bodies, never URLs.
- **Cleanup**: `TokenCleanupService` sweeps expired `refresh_tokens`, `one_time_tokens` and `used_refresh_tokens` older than the refresh TTL every `TOKEN_CLEANUP_INTERVAL_MINUTES` (0 disables), in batches of 1000.
- **Auth**: own JWT. Short-lived HS256 access token plus opaque refresh token with rotation. Reusing a rotated refresh token revokes the whole token family. Every route is protected unless marked `@Public()`, including `/health`.
- **Authorization**: `@Roles('admin')` (RBAC) and `@CheckPolicies(...)` plus `assertCan(...)` (CASL, instance-level). Each user has one `role` (`user` or `admin`) stored on `users`. It is embedded in the access token, so a role change takes effect at the next token issue (default 15 min).
- **Rate limiting**: token bucket in Redis (atomic Lua script). A global bucket per user, or per IP when anonymous, plus optional route buckets via `@RateLimit()`. Runs after authentication, so requests with an invalid token get 401 before they are counted. If Redis is down the limiter fails open and logs an error.
- **Transactions**: every write function takes a `Tx`, so a write cannot be issued outside `Database.transaction()`. Audit rows are written in the same transaction as the change they describe.
- **Audit log**: `audit_log` is append-only. A trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`. The trigger does not stop a database superuser from dropping the trigger; for stronger guarantees give the app a role with `INSERT`/`SELECT` only.
- **Tracing**: each request gets `x-request-id` and a W3C `traceparent` (an incoming valid one is honoured). Both appear in every log line, error body, response header and audit row.
- **Errors**: one envelope (`ErrorResponseDto`) `{ statusCode, code, message, details?, requestId, traceId, timestamp, path }`. 4xx log at `warn`, 5xx at `error` with stack.
- **Responses**: every route (except `/health`, marked `@RawResponse()`) returns `{ statusCode, message, data }` via `ResponseInterceptor`. Declare each route with `@ApiEndpoint({ summary, description, message, type, status?, paginated?, errors? })`: it sets OpenAPI docs, status code and the envelope `message` together.
- **Pagination**: `?page=` (1-based) and `?limit=` (1-100, default 20). Handlers return `toPage(results, totalCount, query)`; `data` becomes `{ results, paginationMeta: { pageCount, totalPages, totalCount, previousPage, nextPage } }`. `pageCount` is the item count of the current page.

## Deploying to Railway

The `Dockerfile` is picked up automatically. Add Postgres and Redis plugins and set:

`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `TRUST_PROXY_HOPS=1`, and optionally `CORS_ORIGINS`.

On every deploy the container runs `node dist/database/migrate.js` before starting the server. A failing migration exits non-zero and the deploy fails. Concurrent replicas serialise on a Postgres advisory lock. No Railway healthcheck is configured because `/health` requires a JWT.

## Known gaps

- Email delivery is a stub: `Mailer` is bound to `LoggingMailer`, which prints messages outside production and drops them in production (bodies carry tokens). Bind a real transport to the `Mailer` token in `MailModule` before relying on verify/reset.
- Verification is recorded (`verified_emails`, `emailVerified` on `/auth/me`) but no route requires it yet.
- Access-token revocation is a Redis denylist keyed by session id. If Redis is down the check fails open (logged), like the rate limiter. Access tokens issued before this feature carry no session id and are rejected.
