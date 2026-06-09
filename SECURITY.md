# Security

How RenovateConnect protects accounts, data, and secrets. Aligned with OWASP
(API Security Top 10 + MASVS for the iOS app). See also `PRIVACY_COMMITMENT.md`.

## Secrets & API keys

- **No secrets in source.** Audited: no API keys, tokens, or passwords are
  hard-coded anywhere in `api/`, `ios/`, or `web/`. All secrets come from
  environment variables (`api/.env.example` documents every one). `.env` files
  are gitignored and not tracked.
- **Server-only keys stay server-only.** `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, `INTERNAL_API_KEY`, and the `AWS_*` /
  `APNS_*` sets are read by the Node API only and are **never** sent to a client.
- **No keys shipped to clients.** The iOS app embeds no secrets. The web app
  exposes only `NEXT_PUBLIC_API_BASE_URL` (a public URL, not a secret); all
  privileged calls (Claude, Stripe) happen server-side.
- **Stripe** uses webhook signature verification (`constructWebhookEvent`) — the
  webhook route is mounted before the body parser and rate limiter so signatures
  verify and Stripe is never throttled.

### Key rotation runbook
Rotate on a schedule and immediately on any suspected exposure:
1. **JWT_SECRET** — rotating invalidates all existing sessions (users re-login).
   Generate a new random value, set it in the host secret store, redeploy.
2. **STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET** — roll in the Stripe dashboard,
   update the env secret, redeploy; verify a test event still settles.
3. **ANTHROPIC_API_KEY** — issue a new key in the Anthropic console, update env,
   revoke the old key.
4. **AWS_* / APNS_* / INTERNAL_API_KEY** — rotate at the provider / regenerate,
   update env, redeploy.
Secrets live only in the deploy platform's secret manager (e.g. Render) — never
in the repo, the client bundles, or logs.

## Authentication & tokens

- Passwords hashed with **bcrypt** (cost 12). Login responses never reveal
  whether the email or password was wrong.
- **iOS stores the auth token in the Keychain** (encrypted, backup-excluded),
  not UserDefaults (`Keychain.swift` / `AuthToken`). Existing UserDefaults
  tokens are transparently migrated on first read.
- **Sign in with Apple** identity tokens are verified against Apple's public JWKs
  (RS256, issuer check).
- Account deletion (`DELETE /auth/me`) removes the user and their data.

## Transport

- iOS App Transport Security is **not** weakened (no arbitrary-loads exception);
  production traffic is HTTPS. (The dev base URL is plain HTTP for LAN testing
  only and is blocked by ATS in release builds.)
- API sets `helmet()` security headers and `trust proxy` for correct client IPs
  behind the load balancer.

## Rate limiting (OWASP API4 — resource consumption)

Centralized in `api/src/middleware/rateLimit.js`; all limiters return a graceful
JSON **429** with `RateLimit-*` / `Retry-After` headers.
- **Global**: baseline cap per 15-min window, keyed **per authenticated user**
  (valid JWT) or **per IP** otherwise (`RATE_LIMIT_MAX`, default 300).
- **Auth**: strict per-IP cap on `/auth/login`, `/register`, `/apple` to blunt
  brute-force / credential stuffing (`AUTH_RATE_LIMIT_MAX`, default 20).
- **AI endpoints**: tight per-IP caps on the unauthenticated, Claude-backed
  `POST /estimations/guest` and `/estimations/share` (cost/DoS control).

## Input validation (OWASP API — injection / mass assignment)

Every request body is validated with **Zod** before use:
- **`.strict()`** schemas reject unexpected fields (mass-assignment defense).
- **Length, type, range, and enum limits** on all strings, numbers, and arrays.
- Free text fed to the AI model (estimator notes, chat) is length-capped.
- `ZodError`s are returned as readable **400**s, never 500s.
Prisma (parameterized queries) prevents SQL injection; React/Next auto-escaping
prevents stored XSS when rendering user content on the web.

## CORS

Locked to an allowlist (`WEB_ORIGINS`); the native app (no `Origin`) is allowed,
unknown browser origins get no CORS headers.

## Reporting

Report suspected vulnerabilities privately to the maintainers rather than opening
a public issue.
