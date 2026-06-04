# RenovateConnect — Claude context

## What this project is

iOS marketplace for homeowners to find renovation contractors. Revenue model:
- **Deposit commission** — when a homeowner accepts a quote and pays the in-app
  deposit, the platform takes a commission (fee-on-top) via Stripe Connect.
  This is the live revenue stream.
- **Admin verification** — trust signal that earns top search placement (not for
  sale). Curated by admins; the basis for the future paid-vetting tier.

> Historical note: the project originally monetized via per-lead fees and paid
> "promoted listings." Both were fully retired (code + DB columns removed) in
> favor of the transaction + verification model above. Don't reintroduce
> `isPromoted`, lead-fee billing, or saved-card-on-file concepts.

## Architecture

- `api/` — Node.js + Express REST API, Prisma ORM on PostgreSQL
- `ios/` — SwiftUI app, two user types: `client` and `business`

## Key concepts

**User types:** `CLIENT`, `BUSINESS`, and `ADMIN` — the `role` field on the `User` model controls access. Businesses have a linked `Business` record with their profile, specialties, and Stripe Connect payout state.

**Lead tracking:** A `Lead` record is created when a client opens a conversation with a business for the first time. Leads are the contractor's free CRM pipeline (`NEW → CONTACTED → CONVERTED → CLOSED`) — they are no longer billed.

**Verification:** `Business.verified` + `Business.verifiedAt`, set by an admin via `PATCH /businesses/:id/verify`. Verified businesses sort ahead of unverified ones in search (`orderBy: [{ verified: 'desc' }, { averageRating: 'desc' }]`).

**In-app deposits:** On quote acceptance a homeowner pays a deposit through Stripe Connect (hosted Checkout, destination charge). The deposit is 10% of the quote midpoint (floored at $50); the platform commission is 8% charged on top as the Stripe `application_fee_amount`. Contractors onboard a Connect account (`/payments/connect/*`) and need `payoutsEnabled` before they can receive deposits. Refunds (`POST /payments/:id/refund`, contractor or admin) are full and reverse the transfer + application fee. Settlement is webhook-driven (`services/stripe.js`, `routes/webhooks.js`).

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
