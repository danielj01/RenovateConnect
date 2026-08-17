# RenovateConnect — Launch Readiness

> Operational readiness to take the app from "runs on my machine" to "live in
> the App Store with real users and real money." This is the infra/distribution
> companion to the business docs (`MARKET_ENTRY_AND_PROFITABILITY_PLAN.md`,
> `RETENTION_AND_FEATURE_ROADMAP.md`). Features are tracked there; **this doc is
> about shipping and running.**
>
> Status legend: ✅ done · 🟡 partial / needs config · 🔴 blocking · ⚪ nice-to-have

_Last updated: 2026-08-15_

---

## 0. TL;DR — the critical path

The backend gate is **cleared** — the API, database, and web app are deployed
and serving on custom domains. What's left splits three ways:

1. **Get off the free tiers before real users exist** 🔴 — free Postgres is
   deleted 30 days after creation (+14-day grace). Everything else about the
   deploy is sound; this one is a data-loss deadline, not a nice-to-have.
2. **iOS distributable** 🟡 — signing team, the APNs `.p8` key, App Store
   Connect setup + assets. The project-side work (bundle ID, entitlements,
   privacy manifest, account deletion) is done.
3. **Go-live ops** 🟡 — Stripe live keys, uptime monitoring, a Sentry DSN, and
   AI-provider headroom (see §7).

Estimated remaining effort to a TestFlight-able build: **~2–3 focused
engineering days**, plus Apple review lead time (typically 1–3 days for first
submission).

---

## 1. Current state snapshot

### Already production-shaped ✅
- Express + Prisma API, clean one-file-per-resource routing (23 routers),
  central error handler, Zod validation on every input.
- 41 Prisma migrations; `prisma migrate deploy` runs on boot and in CI.
- 51 API test files; CI runs lint + tests against real Postgres on every
  push/PR, plus a Docker build and an iOS build.
- `GET /health` endpoint (used as Render's health check).
- `helmet()` security headers, a CORS allowlist, and Redis-backed rate limiting.
- **APNs push fully implemented** — ES256 provider JWT over HTTP/2, token cached
  ~50 min, safe no-op when unconfigured (`services/push.js`).
- **S3 storage implemented** (`services/storage.js`), mandatory in production,
  with a separate private prefix + presigned URLs for verification documents.
- **Stripe billing** for the $10/mo listing subscription and one-time $5 Boost,
  with signature-verified webhooks and idempotent boost activation.
- Secrets hygiene: `.env` is gitignored and untracked; CI uses GitHub Secrets;
  production secrets live in the Render dashboard (`sync: false` in the
  blueprint).

### Blocking / needs work 🔴🟡
See sections 2–4.

---

## 2. Backend: running in production

### 2.1 Deployment ✅
Deployed via the `render.yaml` blueprint: Docker web service + managed Postgres
+ a Key Value (Redis) instance + a daily cron job. Migrations run on boot
(`prisma migrate deploy && node src/app.js`).

- [x] `Dockerfile` (Node 20, `npm ci`, `prisma generate`, migrate-on-boot).
- [x] `render.yaml` blueprint, validated by the **API — Docker build** CI job.
- [x] Deployed and live at `api.renovateconnect.com` (Cloudflare DNS → Render,
      DNS-only so Render manages its own certificate).
- [x] Web app deployed to Vercel at `www.renovateconnect.com`; apex 308-redirects
      to `www`.
- [x] Secret env vars set in the Render dashboard.

### 2.2 Single-instance assumptions ✅
Both of the original concerns are resolved:

- [x] **The in-process `setInterval` is gone.** Scheduling now runs as a Render
      cron job hitting a protected internal route. Note the *purpose* changed
      with the payment stack removal — it is no longer a milestone auto-release
      sweep but a **listing-lifecycle sweep** (`POST /internal/listing-sweep`,
      authenticated with `x-internal-key`, driven by
      `api/scripts/listing-sweep.sh`). It warns contractors whose free month is
      ending and notifies those just delisted. Every notice is stamped
      send-once, so a retry or overlapping run is harmless.
- [x] **Rate limiting is Redis-backed** (`rate-limit-redis` + `ioredis` against
      a Render Key Value instance), so counts survive restarts and cold starts
      instead of resetting. Falls back to the in-memory store when `REDIS_URL`
      is unset, so local dev needs no Redis.

### 2.3 Ephemeral filesystem ✅
- [x] S3 is **mandatory in production** — `assertStorageConfigured()` runs at
      boot in `app.js` and refuses to start if `NODE_ENV === 'production'`
      without S3, rather than silently falling back to a disk that gets wiped
      on every deploy.
- [x] Verification documents (licence/insurance/ID scans) go to a separate
      `private/verification/` prefix and are only ever read through short-lived
      presigned URLs — never a durable public link.
- [ ] ⚪ Put CloudFront / Cloudflare in front of images later for cost + speed.
- [ ] ⚪ Thumbnails/resizing for the Inspiration feed before it scales — images
      are served at full upload resolution today.

### 2.4 Hardening 🟡
- [x] **CORS** restricted to an allowlist (`WEB_ORIGINS`), which auto-pairs the
      `www`/apex variants. A request with no `Origin` (native app, curl,
      server-to-server) is allowed through.
- [x] **Trust proxy** set (`app.set('trust proxy', 1)`) so rate limiting and
      client IPs are correct behind Render's load balancer.
- [x] **Sentry wired** (`src/instrument.js`, required before Express so it can
      instrument it) — but DSN-gated and therefore inert; see below.
- [x] **Security headers on the web app** too (`web/next.config.mjs`) — CSP,
      `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
      `Permissions-Policy`. Previously the Vercel side sent only HSTS.
- [ ] **Set `SENTRY_DSN`** in Render. Until then production errors exist only in
      Render's log stream, with no alerting.
- [ ] Add uptime monitoring on `/health` (BetterStack / UptimeRobot / Render's
      built-in).
- [ ] ⚪ Switch to structured JSON logs (`pino`); `morgan('dev')` today.

### 2.5 Database ops 🔴
- [x] Managed Postgres provisioned on Render.
- [ ] 🔴 **Upgrade off the free plan.** Render deletes a free database 30 days
      after creation plus a 14-day grace period. Fine for pre-launch testing;
      total data loss once real accounts exist. This is the single hardest
      deadline in this document.
- [ ] Confirm automated daily backups + point-in-time recovery are on after the
      upgrade (free plans don't get them).
- [ ] Verify Prisma connection-pool sizing (`connection_limit` in
      `DATABASE_URL`) if you ever scale past one instance.
- [ ] Run the seed (`prisma/seed.js`) **only** for staging demo data, never
      blind against prod.

---

## 3. iOS: make it distributable

### 3.1 Project identity 🟡
- [x] **Bundle ID**: `app.renovateconnect` (was the invalid
      `-x4-Solutions.RenovateConnect`). Matches the `APNS_BUNDLE_ID` example in
      `api/.env.example` — keep the server env in sync.
- [x] Production API URL points at the custom domain (`api.renovateconnect.com`);
      Associated Domains entitlement points at `renovateconnect.com`.
- [ ] Set `DEVELOPMENT_TEAM` to the Apple Developer account team ID; enable
      automatic signing (or set up manual provisioning profiles for CI).

### 3.2 Push Notifications capability 🟡
- [x] `aps-environment` entitlement wired via `CODE_SIGN_ENTITLEMENTS`.
- [x] **Background Modes → Remote notifications**
      (`INFOPLIST_KEY_UIBackgroundModes`).
- [ ] In the Apple Developer portal, create an **APNs Auth Key (.p8)**; load its
      contents + Key ID + Team ID into the server's `APNS_*` env, set
      `APNS_PRODUCTION=true` for App Store / TestFlight builds. Until then every
      push send is a safe no-op and all notification-driven re-engagement is
      inert.

### 3.3 App Store compliance 🔴/🟡
- [x] **In-app account deletion** — Apple *requires* it (Guideline 5.1.1(v)).
      `DELETE /auth/me` deletes the user + cascades their data (homeowner and
      contractor-with-business paths, both tested), surfaced in `ProfileView`.
- [x] **Privacy Policy + Terms of Service** live at `/privacy` and `/terms`,
      linked from the site footer + sitemap.
- [x] **Privacy manifest** (`PrivacyInfo.xcprivacy`): no tracking,
      collected-data types, UserDefaults required-reason (CA92.1).
- [x] **UGC moderation** (Guideline 1.2) — report + block endpoints with an
      admin review queue, enforced in the messaging routes.
- [x] **Sign in with Apple** offered alongside Google (Guideline 4.8).
- [ ] **App Privacy "nutrition label"** answers in App Store Connect (data
      collected: name/email, photos for estimates, payment via Stripe, push
      token, location, usage — mirror `PrivacyInfo.xcprivacy`).
- [ ] **Guideline 3.1.1 review notes.** The $10/mo listing subscription is a
      real-world-service fee, which is exempt from IAP — but this pattern draws
      false rejections often enough that the review notes should explain the
      business model up front rather than appealing afterward.
- [ ] App Store assets: icon set, screenshots (6.7" + 6.5" + iPad if supported),
      description, keywords (see `MARKET_ENTRY` §ASO), support URL.
- [ ] ⚪ Add iOS unit/UI tests (CI is build-only today).

### 3.4 Distribution pipeline 🟡
- [ ] First path: Xcode **Archive → TestFlight** for internal testing.
- [ ] ⚪ Later: automate with Fastlane + a signed CI build (current CI builds
      unsigned for verification only). `fastlane precheck` is worth running
      against the App Store Connect metadata before the first submission.

---

## 4. Payments go-live (Stripe) 🟡

> Scope note: in-app construction payments were **removed 2026-06-26** for CSLB
> compliance. There is no Stripe Connect, escrow, deposit, commission, payout,
> or dispute flow anymore — homeowners contract and pay the licensed contractor
> directly, off-platform. Stripe now handles **only** platform advertising fees.
> See `CLAUDE.md` before reintroducing anything here.

- [ ] Switch to **live** API keys + live `STRIPE_WEBHOOK_SECRET`.
- [ ] Register the production webhook endpoint (`https://api.renovateconnect.com/webhooks/stripe`)
      in the Stripe dashboard; confirm it's reachable and signature-verifying.
- [ ] Create the live-mode price for the $10/mo listing subscription and confirm
      the free-first-month trial maps onto it (`freeListingEndsAt` →
      Stripe `trial_end`, so a contractor who subscribes mid-free-month isn't
      double-charged).
- [ ] End-to-end test in live mode with a real card: subscribe, verify
      `Business.proStatus` mirrors from the webhook, cancel, confirm the listing
      stays visible through the paid period.
- [ ] Buy a Boost in live mode; confirm the `checkout.session.completed` webhook
      activates it idempotently and the per-city cap holds.

---

## 5. Infra stack (as deployed)

| Concern            | Choice                                    | Notes |
|--------------------|-------------------------------------------|-------|
| API host           | Render (Docker)                           | Free plan — sleeps when idle |
| Database           | Render managed Postgres                   | **Free plan — 30-day deletion clock** |
| Rate-limit store   | Render Key Value (Redis)                  | Free plan, private network only |
| Object storage     | AWS S3                                    | Public `uploads/` + private `private/verification/` |
| Web host           | Vercel                                    | Next.js, `www.renovateconnect.com` |
| DNS                | Cloudflare                                | DNS-only (unproxied) so each platform manages TLS |
| Scheduler          | Render Cron → `/internal/listing-sweep`   | Daily 15:00 UTC ≈ 8am PT |
| AI — vision        | NVIDIA NIM, Anthropic fallback            | See §7 |
| AI — chat          | NVIDIA NIM, Anthropic fallback            | Falls back only when unconfigured |
| Email              | SendGrid                                  | Verification + password reset |
| Error tracking     | Sentry                                    | Wired, **no DSN set** |
| Uptime             | —                                         | Not set up yet |
| Push               | APNs token auth (.p8)                     | Coded, **no key loaded** |
| iOS distribution   | TestFlight → App Store                    | Not started |

Current run cost is **≈$0/mo** (everything except the cron job is on a free
plan) + Apple Developer Program ($99/yr). Realistic cost once Postgres and the
web service move to paid plans: **~$20–40/mo**.

---

## 6. Sequenced launch checklist

**Phase 1 — Backend live** ✅
1. [x] Dockerfile + Render blueprint + `migrate deploy` release step
2. [x] Postgres, Key Value, and S3 provisioned; env vars set
3. [x] S3 mandatory-in-prod guard; CORS allowlist; `trust proxy`
4. [x] Listing sweep runs as a cron job (verified with a manual trigger)
5. [x] Redis-backed rate limiting
6. [x] Sentry wired (DSN-gated)
7. [x] Custom domains + TLS for both API and web
8. [ ] Uptime monitor on `/health`; set `SENTRY_DSN`

**Phase 2 — Before real users** 🔴
9. [ ] **Upgrade Postgres off the free plan** (deletion clock — see §2.5)
10. [ ] Upgrade the web service off free (kills the ~35s cold start)
11. [ ] Top up the Anthropic account so the AI fallback actually works
12. [ ] Configure the Google Sign-In OAuth client — `GOOGLE_CLIENT_IDS` isn't in
       `render.yaml` at all, so `/auth/google` returns 503 in production today

**Phase 3 — iOS shippable** 🟡
13. [x] Bundle ID, entitlements, privacy manifest, account deletion, moderation
14. [ ] Signing team + APNs `.p8`
15. [ ] App Privacy answers in App Store Connect
16. [ ] Icon + screenshots + listing copy + review notes (§3.3)
17. [ ] Archive → TestFlight internal test

**Phase 4 — Go live**
18. [ ] Stripe live keys + prod webhook, verified end-to-end (§4)
19. [ ] Seed launch supply (see the Bay Area contractor outreach plan)
20. [ ] Submit to App Store; prep launch-day monitoring runbook

---

## 7. Open risks to watch

- 🔴 **Free-tier Postgres deletion clock.** 30 days from creation plus a 14-day
  grace period. Nothing warns you in-app; the data is simply gone. Upgrade
  before the first real signup, not after.
- 🔴 **The AI fallback is currently non-functional.** Vision runs on NVIDIA NIM
  (free) with Anthropic as a runtime fallback for any failure — but the
  Anthropic account has no credit balance, so a NVIDIA failure currently
  surfaces as a broken estimate instead of an invisible retry. The photo
  estimator is the product's core moment, which makes this load-bearing.
- 🟡 **NVIDIA free-tier reliability is genuinely variable.** Live testing during
  development hit timeouts and 529s across several models, including
  text models that had been reliable. This is expected of best-effort free
  compute — it is exactly what the fallback exists for, which is why the point
  above matters.
- 🟡 **Cold starts.** The free web service sleeps when idle; the first request
  after a quiet spell measured ~35s, then ~100ms. Whoever opens the app first
  each morning waits it out.
- 🟡 **First Apple review.** Account deletion, privacy manifest, UGC moderation,
  and payment framing are the four most common rejection causes for an app like
  this. The first three are done; the fourth needs review notes (§3.3).
- 🟡 **Contractor licence numbers are unvalidated free text.** They're required
  and displayed (CA B&P §7030.5), but nothing checks them against the CSLB
  database — a typo or a fabricated number publishes as-is.
- **Cold-start liquidity.** Even a flawless app is empty without seed supply;
  the contractor-outreach effort is a launch dependency, not a post-launch
  nicety.
