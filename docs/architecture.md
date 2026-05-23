# Architecture

## Overview

```
iOS App (SwiftUI)
    │
    │  HTTPS / JSON
    ▼
Express API (Node.js)
    │
    ├─ PostgreSQL (Prisma ORM)
    ├─ S3 (photo storage)
    ├─ Anthropic Claude API (AI)
    └─ Stripe (payments)
```

## User types

| Role | Description |
|------|-------------|
| `CLIENT` | Homeowner searching for contractors |
| `BUSINESS` | Renovation company with a profile |
| `ADMIN` | Internal platform operator |

## Revenue flows

### Lead fees
1. Client opens a conversation with a business for the **first time**
2. `POST /conversations` detects first contact, creates a `Lead` record
3. A Stripe invoice item is added to the business's customer immediately
4. Stripe collects on the business's monthly invoice cycle

### Promoted listings
1. Business hits `POST /advertising/subscribe`
2. API creates a Stripe subscription; returns `clientSecret` for the iOS app to complete payment via Stripe SDK
3. On `invoice.payment_succeeded` webhook → `business.isPromoted = true`
4. Search results order: `isPromoted DESC, averageRating DESC`

## AI features

### Cost estimation (`POST /estimations`)
- Accepts 1–5 JPEG images via multipart upload
- Images stored in S3; base64 copies sent to Claude claude-opus-4-7 (vision)
- Claude returns structured JSON (line items, total range, confidence)
- Result stored in `Estimation` table for history

### AI chatbot (`POST /chat`)
- Stateless — client sends full conversation history each request
- System prompt includes all business profiles (name, city, specialties, rating)
- Claude recommends specific businesses by name based on client's project description

## Data model highlights

- `Conversation` has a unique constraint on `(clientId, businessId)` — one thread per pair
- `Lead` is 1:1 with `Conversation`, created on first message
- `Business.isPromoted` is flipped by Stripe webhooks, not set directly by the API
