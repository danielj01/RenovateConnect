# RenovateConnect

iOS marketplace connecting homeowners with vetted renovation contractors. Revenue comes from lead acquisition fees and promoted business listings.

## Features

- **Business discovery** — search and filter contractors by specialty, location, and rating
- **AI cost estimation** — upload photos of your space and get an instant renovation estimate
- **AI chatbot** — find the right contractor by describing your project in plain language
- **Direct messaging** — chat with businesses before committing
- **Promoted listings** — businesses can pay to appear at the top of search results

## Repo structure

```
renovate-connect/
├── api/          # Node.js + Express + Prisma (PostgreSQL) backend
├── ios/          # SwiftUI iOS application
└── docs/         # Architecture and API docs
```

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Xcode 15+
- An [Anthropic API key](https://console.anthropic.com/) for AI features
- A [Stripe](https://stripe.com/) account for payments

## Quick start

### API

```bash
cd api
cp .env.example .env       # fill in your secrets
npm install
npx prisma migrate dev     # creates the database
npm run dev                # starts on :3000
```

### iOS

Open `ios/RenovateConnect/RenovateConnect.xcodeproj` in Xcode, set your team and bundle ID, then run on a simulator or device.

## Team

| Role | Owner |
|------|-------|
| iOS | |
| Backend | |

## Contributing

1. Branch off `main` — use `feature/`, `fix/`, or `chore/` prefixes
2. Open a PR; CI must pass before merge
3. Squash merge into `main`
