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

**Simulator:** nothing to configure. Debug builds default to `http://localhost:3000`, which reaches the API running on your Mac.

**Physical device:** the device can't reach `localhost`, so point it at your Mac
over the LAN. Copy the example config and fill in your Mac's mDNS name:

```bash
cd ios/RenovateConnect
cp Config/Local.xcconfig.example Config/Local.xcconfig
scutil --get LocalHostName    # e.g. "Your-MacBook-Air-123" -> use "Your-MacBook-Air-123.local"
```

Edit `API_BASE_URL` in `Config/Local.xcconfig`, then rebuild. The file is
gitignored — the dev host is never committed, because machine names and LAN
leases change and a stale one breaks everyone else's build. Both devices must
be on the same WiFi, and the API must bind `0.0.0.0` rather than `127.0.0.1`.
See BUILD_GUIDE.md section 4.4 for how the value reaches the app.

## Team

| Role | Owner |
|------|-------|
| iOS | |
| Backend | |

## Contributing

1. Branch off `main` — use `feature/`, `fix/`, or `chore/` prefixes
2. Open a PR; CI must pass before merge
3. Squash merge into `main`
