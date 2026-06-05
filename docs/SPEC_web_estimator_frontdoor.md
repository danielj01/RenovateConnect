# Spec — Web AI Estimator Front Door

> The top-of-funnel growth surface from
> `CLIENT_ACQUISITION_AND_DIFFERENTIATION.md` §4. A public web page where anyone
> can get an instant AI renovation estimate from a photo **without installing the
> app**, then is nudged to open/download the app to save it and get matched with
> a vetted pro. It's also where the contractor share links (`/b/:id`) resolve.
>
> Status: SPEC (not yet built). _Last updated: 2026-06-04_

---

## 1. Why this exists

- **Breaks cold-start.** The estimator is useful with zero marketplace liquidity,
  so the app earns its first visit before we have density.
- **Captures the #1 search intent** ("what will my kitchen remodel cost?") — the
  cheapest, compounding acquisition channel.
- **Completes the contractor share loop.** The `/b/:id` links the QR feature
  already generates need a real destination; this provides it.

**Primary metric:** estimator completions → app installs (and the
estimate→install→match conversion rate). Secondary: organic sessions from SEO.

---

## 2. Scope

### In scope (v1)
1. **Landing page** (`/`) — the wedge pitch + "Get your instant estimate" CTA.
2. **Estimator flow** (`/estimate`) — upload/take a photo, pick room type +
   optional notes, get an itemized AI cost breakdown (reuses the existing
   `POST /estimations/guest` endpoint).
3. **Soft conversion gate** — after the result, "Save this estimate & get matched
   with a vetted pro" → smart App Store / deep link with the estimate attached.
4. **Contractor profile page** (`/b/:id`) — public, SEO-friendly rendering of a
   business (reuses `GET /businesses/:id`), with "Message / get a quote → open in
   app" CTAs. Resolves the share links + QR codes.
5. **SEO cost pages** (`/cost/:metro/:category`, e.g. `/cost/oakland/kitchen`) —
   content + a pre-filled estimator CTA.
6. **Universal Links** — host `apple-app-site-association` so `/b/:id`,
   `/estimate`, and saved-estimate links open the installed app directly.

### Out of scope (v1)
- Full account/auth on web (sign-in stays in-app). Web is anonymous-to-install.
- Web messaging, payments, booking (those live in the app).
- Server-side rendering framework rewrite — keep it light (see §4).

---

## 3. User flows

**Cold visitor → install**
```
Google "kitchen remodel cost oakland"
  → /cost/oakland/kitchen (SEO page, ballpark ranges + CTA)
  → /estimate?room=kitchen&metro=oakland (photo → AI itemized estimate)
  → "Save & get matched" → App Store (or deep link if installed)
  → app opens with the estimate prefilled, shows matched East Bay pros
```

**Contractor-shared link**
```
Scan QR / tap link → /b/:id (public profile, reviews, portfolio)
  → "Message this pro / get a quote" → open in app (or App Store)
```

---

## 4. Technical approach

**Recommendation: a small Next.js app** in a new `web/` workspace.
- Why Next: first-class SSR/SSG for SEO (the whole point), image handling, easy
  Vercel deploy, React reuse. The cost/`/b/:id` pages must be server-rendered for
  crawlers — a pure SPA won't rank.
- **No backend rewrite.** Web calls the existing Express API:
  - `POST /estimations/guest` (already public, multipart image → breakdown).
  - `GET /businesses/:id` (already public, now returns `shareUrl`).
  - `GET /businesses?...` for matched/featured pros on the metro pages.
- **Deploy:** Vercel (web) + the existing API host. Point `renovateconnect.app`
  at the web app; API stays on its subdomain (e.g. `api.renovateconnect.app`).
- **Universal Links:** serve `/.well-known/apple-app-site-association` (JSON, no
  extension, `application/json`) listing the app's `appID` and the `/b/*`,
  `/estimate*`, `/e/*` paths. Add the Associated Domains entitlement in the iOS
  app (`applinks:renovateconnect.app`).

### API gaps to fill (small)
- [ ] **CORS**: allow the web origin(s) on the estimator + business GET routes
      (ties into the CORS-allowlist item in `LAUNCH_READINESS.md`).
- [ ] **Rate-limit / abuse**: `POST /estimations/guest` is unauthenticated and
      calls Claude (cost). Add a tighter per-IP limit + a simple bot check
      (hCaptcha/Turnstile) before exposing it to the open web.
- [ ] **Saved-estimate handoff**: encode the estimate in the install deep link
      (e.g. `/e/:shortId` resolving to a stored estimate) so it survives the App
      Store round-trip. Needs a lightweight `GET /estimations/:id` public-read by
      opaque id, or pass the result via the link.
- [ ] Optional: `shareUrl`/canonical fields already added; confirm `GET /businesses`
      list projection has enough for SEO cards (name, city, rating, logo).

### iOS work
- [ ] Associated Domains entitlement + handle incoming universal links
      (`/b/:id` → business screen; `/estimate` / `/e/:id` → estimator/result).
      The app already has `DeepLink` + a `.business` screen to route into.
- [ ] On cold launch from a saved-estimate link, hydrate the estimator result.

---

## 5. Build phases

**Phase 1 — Resolve the share links (unblocks the QR feature already shipped)**
1. Next.js `web/` skeleton on Vercel, domain wired.
2. `/b/:id` SSR profile page hitting `GET /businesses/:id`.
3. `apple-app-site-association` + iOS Associated Domains so links open the app.

**Phase 2 — The estimator front door**
4. `/` landing + `/estimate` flow against `POST /estimations/guest`.
5. Abuse protection (per-IP limit + captcha) and CORS allowlist.
6. Soft "save & get matched" → App Store / deep-link handoff.

**Phase 3 — SEO engine**
7. `/cost/:metro/:category` templated pages for the launch metro.
8. Sitemap, metadata, structured data (LocalBusiness / FAQ schema).
9. Analytics on the full funnel (source → estimate → install → match).

---

## 6. Risks / decisions to lock before building

- **Estimator cost exposure.** Open, unauthenticated Claude calls can be abused.
  Decide the per-IP cap + captcha before launch. (Hard requirement.)
- **Domain split.** `renovateconnect.app` → web, `api.` → API. Confirm before
  wiring `APP_BASE_URL` and AASA (the `shareUrl` already assumes the apex domain).
- **SSR is non-negotiable for the SEO pages** — don't ship them as a client-only
  SPA or they won't rank.
- **Keep web thin.** Resist rebuilding app features (auth, chat, pay) on web;
  every account-only action funnels into the app. Web's job is estimate + browse
  + convert to install.
