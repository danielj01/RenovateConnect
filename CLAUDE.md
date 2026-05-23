# RenovateConnect — Claude context

## What this project is

iOS marketplace for homeowners to find renovation contractors. Revenue model:
- **Lead fees** — charged to businesses when a client contacts them for the first time
- **Promoted listings** — businesses pay a monthly flat fee to appear at the top of search results

## Architecture

- `api/` — Node.js + Express REST API, Prisma ORM on PostgreSQL
- `ios/` — SwiftUI app, two user types: `client` and `business`

## Key concepts

**User types:** `CLIENT` and `BUSINESS` — the `role` field on the `User` model controls access. Businesses have a linked `Business` record with their profile, specialties, and subscription status.

**Lead tracking:** A `Lead` record is created when a client opens a conversation with a business for the first time. Billing is handled via Stripe at end-of-month.

**Promoted listings:** `Business.isPromoted` + `Business.promotedUntil`. Promoted businesses sort before non-promoted ones in search results.

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
