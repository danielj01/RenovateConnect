# RenovateConnect Web

Public web front for RenovateConnect. **Phase 1 (this):** server-rendered
contractor profile pages at `/b/:id` so the share links + QR codes generated in
the app resolve to a real, SEO-friendly page, plus the Apple App Site
Association file so those links open the iOS app when installed.

Later phases add the AI-estimator front door and SEO cost pages
(see `../docs/SPEC_web_estimator_frontdoor.md`).

## Stack

- Next.js (App Router), TypeScript. Server-side data fetching from the existing
  Express API — **no CORS needed** (all fetches run on the server) and no
  backend rewrite.
- Deploy target: Vercel.

## Routes

| Route | Type | Purpose |
|---|---|---|
| `/` | static | Landing (estimator CTA wired in Phase 2) |
| `/b/[id]` | SSR | Public contractor profile — the share-link destination |
| `/.well-known/apple-app-site-association` | dynamic | Universal-links file (→ `/api/aasa`) |

## Local dev

```bash
cd web
cp .env.example .env        # set API_BASE_URL=http://localhost:3000
npm install
npm run dev                 # http://localhost:3000  (run the API on :3000 too,
                            # or point API_BASE_URL at a deployed API)
```

Visit `/b/<a-real-business-id>` to see a profile.

## Environment

| Var | Purpose |
|---|---|
| `API_BASE_URL` | Base URL of the Express API (server-side only). Prod: `https://api.renovateconnect.app` |
| `IOS_APP_ID` | `<TeamID>.<BundleID>` for the AASA file. Set once the app has a real signing team + bundle id. |
| `APP_STORE_URL` | App Store listing URL for "Get the app" CTAs |
| `APPLE_APP_STORE_ID` | Numeric App Store id for the Safari Smart App Banner |

## Deploy (Vercel)

1. Import the repo, set the project root to `web/`.
2. Add the env vars above (Production + Preview).
3. Point `renovateconnect.app` at this project; keep the API on a subdomain
   (e.g. `api.renovateconnect.app`) so `API_BASE_URL` and the in-app `shareUrl`
   (`APP_BASE_URL`) agree on the apex domain.

## Security note

Keep Next.js patched — it ships frequent security fixes. This app deliberately
avoids `next/image` (renders with plain `<img>`), so the Image Optimizer attack
surface is unused.
