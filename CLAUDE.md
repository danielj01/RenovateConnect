# RenovateConnect — Claude context

## What this project is

iOS marketplace for homeowners to find renovation contractors. Revenue model
(changed 2026-07-04):
- **Listing subscription** — contractors pay the platform **$10/mo** (Stripe
  subscription) to **be publicly listed at all**. Every business gets **one
  free month**, stamped at first admin approval (`Business.freeListingEndsAt`);
  after that, non-subscribers are hidden from search, the Inspiration feed,
  public profiles, and AI-chat recommendations until they pay (data intact,
  reactivates instantly). Includes the **Market Insights** dashboard (the old
  separate $5/$10 Sponsored/Insights tiers are gone — `proPlan` was dropped).
  Routes: `/payments/pro/*`; status mirrored from Stripe subscription webhooks
  onto `Business.proStatus`. If a contractor subscribes during their free
  month, its end becomes the Stripe `trial_end` (no double-charging).
  **`services/listing.js` is the single source of eligibility truth** —
  `isListed()` / `listedWhere()`; every public surface must filter through it.
- **Boost** — **$5 one-time for 7 days** in the clearly-labeled **"Boosted"**
  slot ABOVE organic search (wire/DB name `sponsored` kept for compat; UI says
  "Boosted"). Concurrent boosts capped per city (`BOOST_CITY_CAP`, default 3,
  first-come; extending your own boost is always allowed). `POST
  /payments/boost` → Stripe Checkout (mode: payment) → activated idempotently
  by the `checkout.session.completed` webhook (`Boost` rows +
  `Business.boostedUntil`).
- **Admin verification** — trust signal. Organic search placement is earned by
  verification + rating and is **not for sale**; paid visibility exists ONLY via
  the disclosed Boosted slot, which never reorders the organic list.

> **In-app construction payments were REMOVED (2026-06-26) for CSLB compliance.**
> The deposit-commission + Stripe Connect + milestone-escrow + disputes stack is
> gone: RenovateConnect is a pure referral/advertising platform, and homeowners
> contract with and pay the licensed contractor directly, off-platform (per the
> CSLB online-marketplace bulletin). Do NOT reintroduce platform-collected
> construction payments without a CA construction-law attorney's sign-off. The
> full implementation is preserved at git tag `pre-deposit-removal` / branch
> `deposit-feature-archive`. Stripe is now used ONLY for the listing
> subscription and Boost payments (platform advertising fees, not construction
> payments).

> Monetization guardrails: **per-lead fees stay retired** (don't reintroduce
> lead-fee billing). The OLD silent **`isPromoted`** boolean that reordered
> organic results also stays retired — paid placement must remain a *separate,
> clearly-labeled* Boosted slot, never a secret bump in organic ranking.

## Architecture

- `api/` — Node.js + Express REST API, Prisma ORM on PostgreSQL
- `ios/` — SwiftUI app, two user types: `client` and `business`

## Key concepts

**User types:** `CLIENT`, `BUSINESS`, and `ADMIN` — the `role` field on the `User` model controls access. Businesses have a linked `Business` record with their profile, specialties, and (required) contractor license number.

**Lead tracking:** A `Lead` record is created when a client opens a conversation with a business for the first time. Leads are the contractor's free CRM pipeline (`NEW → CONTACTED → CONVERTED → CLOSED`) — they are no longer billed.

**Verification:** `Business.verified` + `Business.verifiedAt`, set by an admin via `PATCH /businesses/:id/verify`. Verified businesses sort ahead of unverified ones in search (`orderBy: [{ verified: 'desc' }, { averageRating: 'desc' }]`).

**Contractor license:** `Business.licenseNumber` is **required** at profile creation and shown on the public profile — contractor listings are "advertising" under CA Bus. & Prof. Code § 7030.5, which requires the license number to appear. Enforced in the `profileSchema` (`routes/businesses.js`) and the iOS setup/edit forms.

**In-app payments:** REMOVED (see the revenue-model note above). There is no deposit, escrow, Stripe Connect, dispute, or earnings flow anymore. Stripe (`services/stripe.js`, `routes/webhooks.js`) handles only the listing-subscription lifecycle and one-time Boost payments. Preserved at tag `pre-deposit-removal`.

**Listing eligibility:** `services/listing.js` (`isListed`, `listedWhere`, `freeListingEnd`). Applied in `routes/businesses.js` (search + public profile), `routes/feed.js` (feed + quote-this-look), and `routes/chat.js`. `routes/admin.js` stamps `freeListingEndsAt` on first approval. Owner and admins always see a hidden profile; the iOS Dashboard shows a "Your listing is hidden" banner (`ProStatus.listed`).

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
