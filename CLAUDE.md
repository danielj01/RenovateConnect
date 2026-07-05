# RenovateConnect — Claude context

## What this project is

iOS marketplace for homeowners to find renovation contractors. Revenue model:
- **Pro subscription** (the sole revenue stream) — contractors can pay the
  platform **$5/mo (90-day free trial)** via a Stripe **subscription**. While
  trialing/active they appear in a clearly-labeled, capped **"Sponsored"** slot
  shown ABOVE organic search results. Routes: `/payments/pro/*`; status mirrored
  from Stripe subscription webhooks onto `Business.proStatus`. A saved card on
  file is expected here (it's a normal subscription).
- **Admin verification** — trust signal. Organic search placement is earned by
  verification + rating and is **not for sale**; paid visibility exists ONLY via
  the disclosed Sponsored slot, which never reorders the organic list.

> **In-app construction payments were REMOVED (2026-06-26) for CSLB compliance.**
> The deposit-commission + Stripe Connect + milestone-escrow + disputes stack is
> gone: RenovateConnect is a pure referral/advertising platform, and homeowners
> contract with and pay the licensed contractor directly, off-platform (per the
> CSLB online-marketplace bulletin). Do NOT reintroduce platform-collected
> construction payments without a CA construction-law attorney's sign-off. The
> full implementation is preserved at git tag `pre-deposit-removal` / branch
> `deposit-feature-archive`. Stripe is now used ONLY for the Pro subscription.

> Monetization guardrails: **per-lead fees stay retired** (don't reintroduce
> lead-fee billing). The OLD silent **`isPromoted`** boolean that reordered
> organic results also stays retired — paid placement must remain a *separate,
> clearly-labeled* Sponsored slot, never a secret bump in organic ranking.

## Architecture

- `api/` — Node.js + Express REST API, Prisma ORM on PostgreSQL
- `ios/` — SwiftUI app, two user types: `client` and `business`

## Key concepts

**User types:** `CLIENT`, `BUSINESS`, and `ADMIN` — the `role` field on the `User` model controls access. Businesses have a linked `Business` record with their profile, specialties, and (required) contractor license number.

**Lead tracking:** A `Lead` record is created when a client opens a conversation with a business for the first time. Leads are the contractor's free CRM pipeline (`NEW → CONTACTED → CONVERTED → CLOSED`) — they are no longer billed.

**Verification:** `Business.verified` + `Business.verifiedAt`, set by an admin via `PATCH /businesses/:id/verify`. Verified businesses sort ahead of unverified ones in search (`orderBy: [{ verified: 'desc' }, { averageRating: 'desc' }]`).

**Contractor license:** `Business.licenseNumber` is **required** at profile creation and shown on the public profile — contractor listings are "advertising" under CA Bus. & Prof. Code § 7030.5, which requires the license number to appear. Enforced in the `profileSchema` (`routes/businesses.js`) and the iOS setup/edit forms.

**In-app payments:** REMOVED (see the revenue-model note above). There is no deposit, escrow, Stripe Connect, dispute, or earnings flow anymore. Stripe (`services/stripe.js`, `routes/webhooks.js`) handles only the Pro subscription lifecycle. Preserved at tag `pre-deposit-removal`.

**AI estimation:** `POST /estimations` accepts multipart images, passes them to Claude (vision), and returns a structured cost breakdown. Model: `claude-opus-4-7`.

**AI chatbot:** `POST /chat` — stateless, system prompt includes all business specialties from the DB so Claude can recommend specific businesses by name.

## Environment variables (see .env.example)

`DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `AWS_*` (S3 for photo storage)

## Running locally

```bash
cd api && npm run dev   # :3000
```

## Conventions

- Route files export an Express Router; `app.js` mounts them
- All auth uses `middleware/auth.js` — always apply to protected routes
- AI calls go through `services/ai.js`, never directly in route handlers
- Prisma client is a singleton at `services/db.js`
