# API Reference

Base URL: `http://localhost:3000` (dev) / `https://api.renovateconnect.com` (prod)

Auth: `Authorization: Bearer <jwt>`

---

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Register client or business |
| POST | `/auth/login` | No | Get JWT token |
| GET | `/auth/me` | Yes | Current user + business profile |

## Businesses

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/businesses` | No | Search (query params: `q`, `city`, `state`, `specialty`, `page`, `limit`) |
| GET | `/businesses/:id` | No | Business detail + reviews |
| POST | `/businesses` | BUSINESS | Create profile |
| PUT | `/businesses/:id` | BUSINESS | Update own profile |
| POST | `/businesses/:id/reviews` | CLIENT | Add review |

## Estimations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/estimations` | Yes | Upload photos (`multipart/form-data`), get AI estimate |
| GET | `/estimations` | Yes | My estimation history |
| GET | `/estimations/:id` | Yes | Single estimation |

## Conversations & Messaging

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/conversations` | Yes | My conversations |
| POST | `/conversations` | CLIENT | Start conversation (creates Lead on first contact) |
| GET | `/conversations/:id/messages` | Yes | Message history |
| POST | `/conversations/:id/messages` | Yes | Send a message |

## AI Chat

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/chat` | Yes | Send message to AI assistant. Body: `{ message, history? }` |

## Advertising

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/advertising/subscribe` | BUSINESS | Start promoted listing subscription |
| DELETE | `/advertising/subscribe` | BUSINESS | Cancel promoted listing |
| GET | `/advertising/status` | BUSINESS | Check promotion status |

## Leads (internal)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/leads` | BUSINESS / ADMIN | View leads |
| PATCH | `/leads/:id/bill` | ADMIN | Mark lead as billed |

## Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhooks/stripe` | Stripe event handler (raw body, signature verified) |
