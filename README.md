# Secure AI Chat and Subscription Backend

A production-style backend for an AI chat service with monthly free quotas and paid subscription bundles. Built with TypeScript (strict), Express, PostgreSQL and Prisma, following Domain-Driven Design and Clean Architecture, with a security-first request pipeline.

A [CI workflow](.github/workflows/ci.yml) runs ESLint, Prettier, type-checking, unit and integration tests, the PostgreSQL concurrency tests against a Postgres service, and a production build. It is currently set to run on manual trigger, because GitHub Actions is unavailable on this account due to a billing lock; switching it to run on every push is a one-line change in the file. The same checks run locally with `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test` and `pnpm test:db`.

The original assignment is in [`docs/GGI-BACKEND-TEST-POSTURE.pdf`](docs/GGI-BACKEND-TEST-POSTURE.pdf).

## Contents

- [Quick start (Docker)](#quick-start-docker)
- [Local development](#local-development)
- [Authentication setup (Auth0)](#authentication-setup-auth0)
- [Calling the API](#calling-the-api)
- [Frontend integration](#frontend-integration)
- [Architecture decisions](#architecture-decisions)
- [Quota and concurrency design](#quota-and-concurrency-design)
- [Subscriptions and billing](#subscriptions-and-billing)
- [Security model](#security-model)
- [Errors](#errors)
- [Observability](#observability)
- [Testing](#testing)
- [Assumptions](#assumptions)
- [Limitations and production notes](#limitations-and-production-notes)

## Tech stack

| Concern             | Choice                                                       |
| ------------------- | ------------------------------------------------------------ |
| Runtime             | Node.js 24, TypeScript 5.9 (strict), native ES modules       |
| HTTP                | Express 5                                                    |
| Database            | PostgreSQL 16, Prisma 6 (schema and migrations)              |
| Validation          | Zod 4 (strict object schemas)                                |
| Authentication      | Auth0 (OAuth2 / OpenID Connect), tokens verified with `jose` |
| Security middleware | helmet, cors, express-rate-limit, sanitize-html              |
| Logging             | pino, pino-http (structured JSON)                            |
| Scheduling          | node-cron                                                    |
| Tests               | Vitest, Supertest                                            |
| Code quality        | ESLint (typescript-eslint), Prettier                         |
| Package manager     | pnpm 11                                                      |

## Quick start (Docker)

Requires Docker with Compose.

```bash
cp .env.example .env          # then set AUTH_ISSUER and AUTH_AUDIENCE (see Auth0 setup)
docker compose up --build
```

This starts three services in order:

1. `db`: PostgreSQL.
2. `migrate`: applies all Prisma migrations once, then exits.
3. `api`: starts only after migrations succeed, on http://localhost:3000.

Check it is running (the key is `HEALTH_API_KEY` from your `.env`):

```bash
curl -s localhost:3000/health -H "X-Health-Key: <HEALTH_API_KEY>"
# {"status":"ok"}
```

With the placeholder values from `.env.example` the API starts, but no real tokens will be accepted until Auth0 is configured.

## Local development

Requires Node.js 24+ and pnpm 11 (`npm install -g pnpm@11`).

```bash
cp .env.example .env              # set AUTH_ISSUER, AUTH_AUDIENCE, HEALTH_API_KEY
docker compose up -d db           # only the database
pnpm install
pnpm db:deploy                    # apply migrations
pnpm dev                          # http://localhost:3000, reloads on change
```

| Script                                 | Purpose                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `pnpm dev`                             | Run with reload (tsx)                                |
| `pnpm build` / `pnpm start`            | Compile to `dist/` and run it                        |
| `pnpm typecheck`                       | Type-check source and tests                          |
| `pnpm lint` / `pnpm format:check`      | ESLint and Prettier checks                           |
| `pnpm test`                            | Unit and integration tests                           |
| `pnpm test:db`                         | Concurrency and persistence tests against PostgreSQL |
| `pnpm db:migrate`                      | Create and apply a new migration (development)       |
| `pnpm db:deploy`                       | Apply existing migrations                            |
| `pnpm admin:grant <email or auth sub>` | Give a user the ADMIN role                           |
| `pnpm billing:run`                     | Run one billing and cleanup pass now                 |

All configuration comes from environment variables, validated at startup. The app refuses to start, listing the invalid variable names, if anything is missing or malformed. See [`.env.example`](.env.example) for every variable and its default.

## Authentication setup (Auth0)

Authentication is delegated entirely to Auth0. The API never sees passwords and holds no Auth0 secrets: it only verifies tokens with Auth0's public keys.

1. **Create an API** (Applications > APIs): identifier `https://chat-api`, signing algorithm RS256. This identifier is the audience.
2. **Connections** (Authentication): enable `Username-Password-Authentication` (email/password) and the `google-oauth2` social connection (OAuth provider).
3. **Create an application** (for example a Regular Web Application) and enable both connections for it.
4. **Authorize the application for the API** (the API's Application Access tab, user access).
5. Set in `.env`:

```bash
AUTH_ISSUER=https://<your-tenant>.<region>.auth0.com/   # keep the trailing slash
AUTH_AUDIENCE=https://chat-api
```

Getting a token for manual testing: a frontend would use Auth0 Universal Login (Authorization Code with PKCE), which is also how Google sign-in works. For quick testing from a terminal you can enable the Password grant on a test application, set the tenant's Default Directory to `Username-Password-Authentication`, and request a token:

```bash
curl -s https://<your-tenant>.<region>.auth0.com/oauth/token \
  -H 'content-type: application/json' \
  -d '{"grant_type":"password","username":"<email>","password":"<password>",
       "audience":"https://chat-api","client_id":"<client id>","client_secret":"<client secret>",
       "scope":"openid email"}'
```

The client secret is only needed for this manual token request. It is not part of the API's configuration.

## Calling the API

Every request except `/health` needs three headers:

| Header                | Value                             |
| --------------------- | --------------------------------- |
| `Authorization`       | `Bearer <access token>`           |
| `X-Request-Timestamp` | Current time in Unix milliseconds |
| `X-Request-Nonce`     | A new UUID for every request      |

A small shell helper:

```bash
TOKEN="<access token>"
api() {
  curl -s "localhost:3000$1" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Request-Timestamp: $(date +%s%3N)" \
    -H "X-Request-Nonce: $(cat /proc/sys/kernel/random/uuid)" \
    -H "Content-Type: application/json" \
    "${@:2}"
  echo
}

api /auth/me
api /subscriptions -X POST -d '{"tier":"PRO","billingCycle":"MONTHLY"}'
api /chat/messages -X POST -d '{"question":"What is DDD?"}'
api /chat/usage
```

### Endpoints

| Method | Path                        | Access                | Description                                                             |
| ------ | --------------------------- | --------------------- | ----------------------------------------------------------------------- |
| GET    | `/health`                   | `X-Health-Key` header | Liveness check                                                          |
| GET    | `/auth/me`                  | user, admin           | The authenticated user's internal identity and role                     |
| POST   | `/chat/messages`            | user, admin           | Ask a question (`{ "question": string }`), returns the mocked AI answer |
| GET    | `/chat/messages?limit=20`   | user, admin           | Own history (admins: all), newest first                                 |
| GET    | `/chat/messages/:id`        | owner, admin          | One message                                                             |
| GET    | `/chat/usage`               | user, admin           | Free quota usage, reset time and bundle balances                        |
| POST   | `/subscriptions`            | user, admin           | Create a bundle (`{ "tier", "billingCycle", "autoRenew"? }`)            |
| GET    | `/subscriptions`            | user, admin           | Own subscriptions (admins: all)                                         |
| GET    | `/subscriptions/:id`        | owner, admin          | One subscription                                                        |
| PATCH  | `/subscriptions/:id`        | owner, admin          | Toggle auto-renew (`{ "autoRenew": boolean }`)                          |
| POST   | `/subscriptions/:id/cancel` | owner, admin          | Cancel at the end of the current period                                 |
| GET    | `/admin/metrics`            | admin                 | System-wide usage, subscription and payment metrics                     |

To make yourself an admin, call the API once (users are created on first request), then:

```bash
pnpm admin:grant 'auth0|<your user id>'                                   # local
docker compose exec api node dist/scripts/grant-admin.js 'auth0|<id>'      # Docker
```

### Frontend integration

A browser or mobile client integrates in four steps:

1. **Allow its origin:** add it to `CORS_ORIGINS` (comma-separated). Other browser origins are rejected with 403.
2. **Log in through Auth0:** use Auth0's SDK (for example `@auth0/auth0-spa-js` or `@auth0/auth0-react`) with Universal Login (Authorization Code with PKCE), requesting `audience: "https://chat-api"`. Email/password and Google both happen on Auth0's hosted page.
3. **Send the three headers on every call:** a fresh timestamp and nonce per request, never reused, including on retries.
4. **Handle the typed errors:** branch on `error.code`, not on messages.

```ts
const token = await auth0.getTokenSilently({
  authorizationParams: { audience: 'https://chat-api' },
});

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Request-Timestamp': String(Date.now()),
      'X-Request-Nonce': crypto.randomUUID(),
    },
  });
  const body = await res.json();
  if (!res.ok) throw body.error; // { code, message, details?, requestId }
  return body;
}

try {
  await api('/chat/messages', { method: 'POST', body: JSON.stringify({ question }) });
} catch (error) {
  if (error.code === 'QUOTA_EXCEEDED') showUpgradePrompt(error.details); // free quota used, no bundle left
  if (error.code === 'RATE_LIMITED') retryLater(); // Retry-After header is exposed via CORS
}
```

`X-Request-Id`, `RateLimit` and `Retry-After` are exposed to browser code through CORS, so a frontend can show the request ID in error reports and respect rate limits. Client clocks must be roughly correct (within `NONCE_WINDOW_SECONDS`), since timestamps outside the window are rejected.

## Architecture decisions

### Layout

```
src/
  modules/
    chat/                     AI chat and quota (bounded context)
    subscriptions/            bundles, lifecycle and billing (bounded context)
      domain/
        entities/             entities and pure domain rules
        services/             use cases
        policies/             authorization rules
        ports.ts              interfaces the domain needs (repositories, gateways)
        errors.ts             domain errors with stable codes
      repositories/           Prisma implementations of the ports
      infrastructure/         other adapters (simulated payments, mocked OpenAI)
      controllers/            HTTP: validation, calling services, response shape
      routes.ts
  shared/
    kernel/                   Actor, Role, Clock: framework-free, usable by domains
    errors/                   error hierarchy
    auth/                     token verification, replay protection, RBAC
    http/                     security headers, CORS, limits, rate limiting, errors
    metrics/                  admin metrics
    db/, logger.ts
  jobs/                       scheduled billing and cleanup
  composition-root.ts         the only place real implementations are created
  app.ts                      request pipeline
  server.ts                   process start and graceful shutdown
```

### Decisions

- **Dependencies point inward.** Domain code (`domain/`) imports nothing from Express, Prisma or Zod. It talks to the outside world only through interfaces in `ports.ts`, implemented by `repositories/` and `infrastructure/` (ports and adapters). This is what lets the domain be unit-tested with in-memory implementations, and lets storage or providers change without touching business rules.
- **Rich domain model.** Rules live on the entities, not in controllers. For example `Subscription.cancel()`, `renew()`, `setAutoRenew()` and `isUsable()` enforce the lifecycle; the constructor is private so subscriptions can only be created through `create()` (which applies the tier catalog) or `restore()` (from storage).
- **Thin controllers.** Controllers only parse and validate input, call a service, and shape the response.
- **Composition root.** `composition-root.ts` wires real implementations; tests wire test doubles through the same `createApp(deps)` function. There is no hidden global state in the app.
- **Independent modules.** `chat/` and `subscriptions/` do not import each other's domain code. The chat module's quota ledger reads the subscription table at the database level only, through its own port.
- **Quota rule defined once.** `selectQuotaSource()` in `chat/domain/entities/quota.ts` is the business rule as a pure function. The PostgreSQL ledger implements the same rule atomically in SQL, and database tests check that they agree under concurrency.
- **Money in integer cents** in the domain, converted to `Decimal` only at the database boundary.
- **Express 5** for familiarity and its native async error handling. The domain is framework-free, so moving to another framework would only affect the HTTP layer.
- **Native ESM with `NodeNext` resolution**, matching how current packages ship.
- **Versions pinned deliberately:** Prisma 6 (stable configuration model) and TypeScript 5.9 (supported by typescript-eslint).

### Request pipeline

```
request ID and logging
  > security headers > CORS (unlisted origins rejected with 403)
  > global timeout > content-type check > JSON parser with size limit
  > per-IP rate limits (global and per route group)
  > /health (internal key)
  > authentication: token verification, replay protection, user lookup
  > per-user rate limits (per route group)
  > routes: role check (controller level) > service > domain policy
  > 404 handler > central error handler
```

Everything after the authentication middleware is protected by default: a new route cannot be added without authentication.

## Quota and concurrency design

Each chat request goes through three steps:

1. **Reserve one message** in a short database transaction.
2. **Call the AI model** (mocked, with simulated latency) outside any transaction, so slow responses never hold locks.
3. **Store** the question, answer, token usage, quota source and request ID. If step 2 or 3 fails, the reserved message is released (refunded).

Reserving before calling the model prevents overselling: requests that arrive while an answer is being generated already see the reduced balance.

### Atomic deduction

Free quota is one row per user per calendar month (`MonthlyUsage`, unique on `userId + period`). Deduction is a single conditional update:

```sql
UPDATE "MonthlyUsage" SET "freeUsed" = "freeUsed" + 1
WHERE "userId" = $1 AND "period" = $2 AND "freeUsed" < 3
RETURNING "freeUsed";
```

The check and the increment happen in one statement. PostgreSQL locks the row and re-evaluates the condition for each concurrent update, so exactly three requests succeed no matter how many arrive at once. There is no read-then-write gap in application code.

Bundles use the same pattern. The usable bundle with the latest start date is selected and locked with `SELECT ... FOR UPDATE`, and incremented only if it still has quota. If a concurrent request took that bundle's last message, the ledger retries with the next usable bundle.

The monthly reset needs no scheduled job: the period key (for example `2026-10`) changes on the 1st (UTC), so a new row starts at zero.

All raw SQL uses Prisma's tagged templates, so every value is sent as a query parameter.

These guarantees are tested against a real PostgreSQL database (`pnpm test:db`): for example, 20 simultaneous requests receive exactly 3 free messages, and 30 simultaneous requests against free quota plus a 10-message bundle receive exactly 13.

## Subscriptions and billing

| Tier       | Messages per billing period | Monthly | Yearly  |
| ---------- | --------------------------- | ------- | ------- |
| Basic      | 10                          | $9.99   | $99.00  |
| Pro        | 100                         | $29.99  | $299.00 |
| Enterprise | Unlimited                   | $99.99  | $999.00 |

- **Creation** charges the first period through the payment gateway. If the payment fails, nothing is created and the API returns `402 PAYMENT_FAILED`.
- **Each subscription stores** `maxMessages`, `usedMessages`, `price`, `startDate`, `endDate`, `renewalDate`, `autoRenew`, `status` and `cancelledAt`. Allowance and price are copied from the catalog at purchase, so later catalog changes do not affect existing subscriptions.
- **Billing simulation** (`RenewalService`) runs on a schedule (`BILLING_CRON`, every 5 minutes by default). For every active subscription past its renewal date:
  - cancelled or auto-renew off: marked inactive (the period has ended);
  - otherwise charged: success starts the next back-to-back period and resets usage; failure marks it inactive and records the failure reason.
- **Payments fail randomly** at `PAYMENT_FAILURE_RATE` (20% by default) in the simulated gateway. Every attempt is stored in `PaymentAttempt`.
- **No double renewals:** a renewal is applied only if the subscription still has the renewal date the job read (a guarded update in one transaction with its payment record), and charges carry an idempotency key per subscription and period.
- **Cancellation** turns off auto-renew and records `cancelledAt`. The subscription stays usable until `endDate`, then becomes inactive. Nothing is deleted; chats and payments stay linked to it.
- **Settings changes never overwrite usage:** toggling auto-renew or cancelling writes only those fields, so it cannot lose messages counted by concurrent chat requests.

## Security model

### Authentication

- **External provider only.** Auth0 handles sign-up, login, email/password and Google OAuth. The API never handles credentials.
- **Server-side token verification** on every request (`jose`): signature against Auth0's published JWKS keys, **RS256 only** (rejects `alg: none` and algorithm-confusion attacks), issuer, audience, expiry and required claims (`sub`, `exp`, `iat`). The API holds no Auth0 secrets.
- **Identity mapping.** The token's `sub` is mapped to an internal user, created on first request. **Roles are stored in our database and never read from the token.** New users are always `USER`.
- **Uniform failures.** All token failures return the same `401` message, so clients cannot learn which check failed. The real reason is logged.

### A token alone is not enough: replay protection

Every request must carry `X-Request-Timestamp` and a single-use `X-Request-Nonce`:

- The timestamp must be within `NONCE_WINDOW_SECONDS` (5 minutes) of server time, in either direction.
- The nonce must be a UUID that has never been used. It is stored with a primary key, so the database guarantees single use even for simultaneous requests.

A captured request cannot be replayed, and old nonces are deleted by the maintenance job once their timestamp could no longer be accepted.

### Authorization

- **Controller level:** `requireRole()` on every router (`USER`/`ADMIN`, admin-only for `/admin`).
- **Domain policy level:** ownership policies (`canAccessSubscription`, `canViewChatMessage`) inside the services. Users only see their own data; admins see everything.
- **No information leaks:** another user's subscription or message returns `404`, not `403`, so IDs cannot be probed.
- **Deny by default:** anonymous requests receive `401` for every route, including unknown ones.

### HTTP protections

| Protection              | Implementation                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secure headers          | helmet with a JSON-API policy: CSP `default-src 'none'`, `frame-ancestors 'none'`, HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` |
| Restricted CORS         | Allowlist from `CORS_ORIGINS`; other browser origins are rejected with 403 before processing; no credentials (cookies)                                      |
| Request size limit      | JSON bodies limited by `BODY_LIMIT` (10 KB)                                                                                                                 |
| Content-type validation | Requests with a body must be `application/json`, otherwise 415                                                                                              |
| Global timeout          | `REQUEST_TIMEOUT_MS` (10 s), then 503                                                                                                                       |
| Rate limiting           | Per IP (before authentication) and per user (after), with separate limits for auth, chat and subscription routes                                            |
| Health endpoint         | Protected by `X-Health-Key`, compared in constant time                                                                                                      |

### Input validation and sanitization

- **Schema validation** with Zod on every body, path parameter and query string.
- **Unknown fields are rejected** (`z.strictObject`), which also prevents **mass assignment**: clients cannot set fields such as `userId`, `price`, `status` or `source`. Controllers map validated input to domain objects explicitly.
- **XSS:** chat questions have all HTML removed (`sanitize-html`) before storage, and the API only returns JSON with a restrictive CSP.
- **Injection:** all database access uses Prisma's parameterized queries, including the raw SQL in the quota ledger.

## Errors

Every error uses the same JSON shape:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "No messages left. Free messages reset monthly; add a subscription bundle to continue now.",
    "details": {
      "freeLimit": 3,
      "freeUsed": 3,
      "freeResetsAt": "2026-11-01T00:00:00.000Z",
      "activeBundlesWithQuota": 0
    },
    "requestId": "a1b2c3d4-..."
  }
}
```

| Code                                                                  | Status                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `VALIDATION_FAILED`, `INVALID_JSON`                                   | 400                                                              |
| `UNAUTHORIZED`                                                        | 401                                                              |
| `QUOTA_EXCEEDED`, `PAYMENT_FAILED`                                    | 402                                                              |
| `FORBIDDEN`, `ORIGIN_NOT_ALLOWED`                                     | 403                                                              |
| `NOT_FOUND`                                                           | 404                                                              |
| `CONFLICT`, `SUBSCRIPTION_ALREADY_CANCELLED`, `SUBSCRIPTION_INACTIVE` | 409                                                              |
| `PAYLOAD_TOO_LARGE`                                                   | 413                                                              |
| `UNSUPPORTED_MEDIA_TYPE`                                              | 415                                                              |
| `RATE_LIMITED`                                                        | 429                                                              |
| `INTERNAL_ERROR`                                                      | 500 (no internal details are returned; the full error is logged) |
| `REQUEST_TIMEOUT`, `AI_UNAVAILABLE`                                   | 503                                                              |

Domain code throws errors with stable codes and never chooses HTTP statuses; the central error handler maps codes to statuses.

## Observability

- **Structured JSON logs** (pino) for every request with request ID, user ID, method, URL, status and response time. Authorization headers, cookies and nonces are redacted.
- **Request IDs** are returned in `X-Request-Id` and in every error body. A client-supplied `X-Request-Id` is reused only if it is a valid UUID.
- **Health check:** `GET /health` (internal key), also used by the Docker health check.
- **Metrics:** `GET /admin/metrics` (admin only) returns users, active and inactive subscriptions by tier, messages (total, last 24 hours, free versus paid), token usage, monthly free quota usage, and payments (succeeded, failed, revenue). Aggregates are computed in the database.
- **Graceful shutdown:** on SIGTERM the scheduler stops, in-flight requests finish and the database connection is closed.

## Testing

```bash
pnpm test        # unit and integration tests, no database needed

# PostgreSQL tests (concurrency, repositories, billing job, metrics)
docker compose up -d db
TEST_DATABASE_URL=postgresql://app:app@localhost:5433/chatapp_test pnpm test:db
```

The `chatapp_test` database is created automatically when the Postgres volume is first created. For an existing volume, create it once with `docker compose exec db createdb -U app chatapp_test`.

| Suite                             | Covers                                                                                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                              | Quota rule and monthly periods; subscription lifecycle (create, cancel, auto-renew rules, renewal, expiry, date maths); renewal service (success, payment failure, expiry, no double processing); chat and subscription services (refunds, policies, typed errors); maintenance job |
| Integration (Supertest, real app) | Authenticated access, token rejection cases, replay protection, RBAC, rate limiting, security middleware (headers, CORS, content type, size, timeout), validation and mass-assignment rejection, XSS stripping, all endpoints                                                       |
| PostgreSQL                        | Concurrent quota deduction, bundle ordering and fallback, Enterprise, monthly reset, refunds, lost-update protection, billing run end to end, metrics                                                                                                                               |

**The authentication provider is mocked, not bypassed.** Tests generate an RSA key pair, expose its public key as a local JWKS, and sign real RS256 tokens. The application verifies them with exactly the same code as in production; only the key source differs. Forged, expired, wrong-audience, wrong-issuer and unsigned tokens are rejected in tests.

## Assumptions

- **Quota order:** free monthly messages are used first, then bundles.
- **"Bundle with the latest remaining quota"** is interpreted as the usable bundle (active, within its period, with messages left) with the **latest start date**, falling back to older bundles when it is used up. Ties are broken by the most recently created.
- **Monthly reset** follows the UTC calendar month.
- **Bundle allowances apply per billing period:** a yearly Basic bundle includes 10 messages for the year. Usage resets when a subscription renews.
- **Prices** are not specified in the assignment; the values above are assumptions defined in `tier-catalog.ts`.
- **The first period is charged at creation;** a failed first payment creates nothing.
- **A failed renewal payment** makes the subscription inactive immediately (no retries or grace period).
- **Cancellation "ends the current billing cycle"** is interpreted as: the subscription stays usable until the end of the period already paid for, then becomes inactive and never renews. It is not refunded or cut short.
- **Cancelled subscriptions** cannot be re-enabled; the user buys a new bundle.
- **Authentication endpoint:** login happens at Auth0, so the API's authentication route group is `/auth` (`GET /auth/me`), which has its own rate limits.
- **Health and metrics:** health is protected by an internal key so monitoring can use it without a user token; metrics require the admin role.
- **Accounts:** email/password and Google logins create different Auth0 identities (`sub`), and therefore different users, unless linked in Auth0.
- **Mocked OpenAI:** responses follow the Chat Completions format, with simulated latency (`MOCK_AI_LATENCY_MS`) and token counts estimated at about 4 characters per token.
- **Questions** are limited to 2,000 characters after trimming, with HTML removed.

## Limitations and production notes

- **Proof of possession:** timestamp and nonce validation prevents replaying captured requests, but does not cryptographically bind a token to its client. A stolen token could still be used with fresh headers until it expires. DPoP or request signing with a client key would close that gap.
- **Rate limits** are stored in memory, which is correct for one instance. Multiple instances would share a store such as Redis.
- **Scheduled jobs** use node-cron in the API process; `JOBS_ENABLED=false` disables them on additional instances. Production would use a durable queue (for example pg-boss or BullMQ) or leader election.
- **Payments** are simulated. A real provider would add idempotent charge requests (keys are already generated), webhooks and retry or grace-period policies.
- **The request timeout** stops waiting and responds with 503, but cannot cancel work already running in Node.js.
- **Docker image:** the runtime image includes development dependencies because the same image runs migrations with the Prisma CLI. A separate migration image would make the API image smaller.
- **History endpoints** use a simple limit; cursor-based pagination would be added for large histories.
