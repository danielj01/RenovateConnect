# RenovateConnect — Session Handoff

_Last updated: 2026-07-04 · `main` · API suite: 377 tests passing_

iOS + web marketplace connecting homeowners with renovation contractors.
Monorepo at `~/renovate-connect`: `api/` (Node/Express/Prisma/Postgres),
`ios/` (SwiftUI), `web/` (Next.js). See `CLAUDE.md` for the source-of-truth
architecture notes.

---

## ⚠️ 2026-07-04 session: revenue model pivot + security audit

### Revenue model changed (again)

**One $10/mo listing subscription (includes Insights) is now required to be
publicly listed.** Every business gets **one free month**, stamped at first
admin approval (`Business.freeListingEndsAt`, backfilled +30d for existing
approved rows by migration `20260704010000`). Lapsed businesses vanish from
search / feed / public profiles / AI-chat until they subscribe (owner + admin
still see them; iOS Dashboard shows a "listing hidden" banner). Subscribing
during the free month sets Stripe `trial_end` to the month's end. The old
$5 Sponsored / $10 Insights tiers are gone (`proPlan` dropped).

**Boost:** $5 one-time for 7 days in the labeled **"Boosted"** slot above
organic search (the old Sponsored slot, relabeled — wire name `sponsored`
kept). Capped at `BOOST_CITY_CAP` (3) concurrent boosts per city, first-come;
extending your own boost is always allowed. `POST /payments/boost` → Stripe
Checkout (mode: payment) → idempotent webhook activation (`Boost` table +
`Business.boostedUntil`).

Key files: `api/src/services/listing.js` (NEW — eligibility source of truth),
`services/stripe.js`, `routes/{payments,webhooks,businesses,admin,chat,feed}.js`,
`prisma/migrations/20260704010000_listing_subscription_boosts/`, iOS
`Models.swift` / `APIService.swift` / `DashboardView.swift` (ARL disclosure now
adjacent to the Subscribe button) / `BusinessSearchView.swift` /
`SponsoredDisclosureSheet.swift`. New tests: `tests/listingGate.test.js`.

### Fixed this session

- **Local login 500** — the dev DB was missing the 6/26 migrations; applied.
  (`danjeznach@gmail.com` dev password was reset in the local DB only.)

### Security audit findings (full report in the 2026-07-04 session transcript)

**FIXED (2026-07-04):**
2. ✅ **Error-message leak** — global handler now echoes a message only when we
   mark it safe (`err.expose`, via `utils/httpError.js`); all else is generic by
   status class. AI service maps provider failures to a clean 503. (commit 1aa4d6e)
6. ✅ **Estimator media-type bug** — `services/ai.js` now sniffs image magic
   bytes (jpeg/png/gif/webp); HEIC/unknown → clean 415. (commit 1aa4d6e)
7. ✅ **`GET /businesses` params** — coerced + bounded by zod (page rejected if
   invalid, limit clamped to 50; array params → 400). Verified live. (1aa4d6e)
8. ✅ **`/estimations/share`** now caps the stored blob at 20 KB. (commit 8377256)
3+4. ✅ **Password reset + email verification + pre-hijack** — full SendGrid-
   backed workstream (commits 44ccb0a API, 0cb5640/ae4144a iOS). Password
   registration is now unverified until an emailed 6-digit code is confirmed;
   login is blocked (403) until verified; unverified emails can be taken over by
   a new registration; social sign-in rotates the password when adopting an
   unverified account. forgot/reset/change-password endpoints + iOS UI
   (VerifyEmailView, ForgotPasswordView, ChangePasswordView) shipped. Existing
   users grandfathered verified. Email no-ops when unconfigured; dev/test get
   `devCode` in the response. **Needs at deploy: SENDGRID_API_KEY + EMAIL_FROM
   (authenticated domain).**

**STILL OPEN:**
1. **Anthropic API account out of credits** — all AI estimation/chat is down
   until credits are topped up (not a code fix). Now fails with a clean 503.
5. **Verification documents (incl. government IDs) on public S3 URLs** — NEXT UP:
   decided approach is a private prefix/bucket + short-lived presigned GET URLs
   (portfolio/avatars stay public). Needs the code change + bucket set private.
8b. Minor/deferred: search metrics (impressions/clicks) forgeable by anon
   requests; 30-day JWTs have no revocation (a tokenVersion claim would let
   password-change/reset evict old sessions).

---

## ⚠️ Biggest change this session: the in-app payment stack was REMOVED

RenovateConnect is now a **pure referral / advertising platform**. Homeowners
contract with and pay the licensed contractor **directly, off-platform**. This
was done for **CSLB compliance** — California's Contractors State License Board
bulletin for online marketplaces says the customer should pay the licensed
contractor directly, and a referral service must not collect/hold construction
payments or solicit/negotiate on a contractor's behalf.

**What was removed** (commit `4dd32c0`): the entire deposit-commission +
milestone-escrow + disputes + Stripe Connect + earnings stack — API models,
routes, services, webhooks, migration, tests; and the iOS views, models, and
API-client methods.

**Revenue model then:** `$5/mo Sponsored` + `$10/mo Insights` tiers —
**superseded 2026-07-04** by the $10/mo listing subscription + $5 Boost (see
the section above).

**♻️ How to restore the payment stack** (if the business/legal picture changes):
everything is preserved at:
- git tag **`pre-deposit-removal`**
- branch **`deposit-feature-archive`** (pushed to origin)

Do NOT revive platform-collected construction payments without a **California
construction-law attorney's** sign-off.

---

## Also shipped this session

1. **Cost-tier search UX** (`52fca41`, `94ea306`) — homeowners filter by price by
   typing `high`/`medium`/`low` (or `$$$`, `budget`, `premium`…) in the search
   bar; server maps the keyword to a tier (`services/costTier.js` `tierForQuery`).
   Removed the old `$/$$/$$$` chip row. Cost badge added to the contractor detail
   header. Badges now show only the active `$` marks.

2. **Terms of Service rewrite** (`c139538`) — full lawyer-grade ToS at
   `web/app/terms/page.tsx` (binding individual arbitration + class-action waiver
   w/ 30-day opt-out, Apple EULA, DMCA, UGC license, warranty disclaimer,
   liability cap, indemnification). `OPERATOR` constant still = brand name —
   **replace with the registered legal entity before launch.**

3. **Pre-launch legal hardening** (`28ae1d4`, `b475142`):
   - **Clickwrap Terms acceptance record** — `User.termsAcceptedAt` +
     `termsVersion` (migration `20260626010000`); `services/legal.js`
     `CURRENT_TERMS_VERSION`. `/auth/register` requires `acceptedTerms===true`;
     social sign-in records acceptance; `POST /auth/accept-terms` for
     re-acceptance; `/auth/me` exposes `needsTermsAcceptance`. iOS: explicit
     "I agree" toggle on registration + disclosure under Apple/Google buttons.
   - **"What Verified means" disclosure** — the Verified row on a contractor
     detail opens a sheet (point-in-time check, not a guarantee/endorsement,
     verify license + insurance independently). Aligns UI with ToS §5.
   - **CA deposit cap** — this shipped, then became moot when the whole payment
     stack was removed (it lives in the archived branch).

4. **Contractor license required + displayed** (`2d1a39c`) — `licenseNumber` is
   now **required** on business-profile creation and shown on the public profile
   (CA Bus. & Prof. Code § 7030.5: contractor listings are "advertising" and must
   carry the license number). Enforced in `profileSchema` (`routes/businesses.js`)
   and iOS setup/edit forms.

---

## Pre-launch legal checklist (from this session's research — NOT legal advice)

Verified against current (2026) sources. Get a licensed CA attorney to sign off.

**Now largely mechanical (can self-serve):**
- [ ] **Form the operating entity**; replace `OPERATOR` in `web/app/terms/page.tsx`.
- [ ] **Register a DMCA agent** at dmca.copyright.gov ($6, renew every 3 yrs) —
      the Inspiration feed republishes contractor portfolio photos. Monitor
      `legal@renovateconnect.app`.
- [ ] **CA Automatic-Renewal Law (AB 2863, eff 7/1/2025)** for Pro subs: on the
      subscribe screen show auto-renew + price + interval **adjacent to the buy
      button**, capture affirmative consent, same-medium (in-app) cancel,
      post-signup email, trial-conversion + price-change notices. (The federal
      FTC "click-to-cancel" rule was vacated 7/2025; state ARL + ROSCA bind.)
- [ ] **Stand up inboxes**: `support@`, `legal@`, `privacy@renovateconnect.app`.
- [ ] Finish the **App Store privacy label** (esp. the Pro Insights aggregated
      data); confirm Insights isn't a CCPA/CPRA "sale/share".

**Needs an attorney:**
- [ ] Finalize the **arbitration clause** (name AAA/JAMS + rules; mass-arbitration
      handling; confirm class-waiver + opt-out enforceability).

**Resolved this session:** the Tier-0 "platform collecting construction payments"
risk (removed the payment stack) and the license-in-advertising requirement
(license now required + displayed). Remaining CSLB to-do: **validate license
numbers against the CSLB database** (currently accepted as free-form text).

Full detail + primary sources: see the memory file
`project_renovate_connect_legal.md`.

---

## Open / next (pick up here)

- **Validate contractor license # against the CSLB database** (currently
  free-form). Tie into the existing verification flow / an expiry sweep.
- **ARL-compliant subscription screen** (see checklist) — the in-app Pro
  purchase UI needs the auto-renewal disclosure adjacent to the buy button.
- **Launch track** (`LAUNCH_READINESS.md`): deploy API to Render + secrets,
  deploy web to Vercel, domain split (`renovateconnect.app`→web /
  `api.`→API), Apple signing/bundle id, Push capability, Stripe **live** keys +
  prod webhook.
- Deferred features: admin iOS UI for the verification queue,
  verification-doc expiry sweep, image CDN, multi-quote project posting
  (biggest demand-side gap — quotes are 1:1 today), contractor web "claim your
  founding listing" page, two-sided referrals, cost-tier per-specialty
  normalization.
- **Note:** the Project hub (homeowner notes/status) and the earnings/payments
  UI were casualties of the payment-stack removal. If you want a lightweight
  non-payment "saved jobs / notes" feature back, it can be rebuilt cleanly
  (the old escrow-coupled version is in the `pre-deposit-removal` tag).

---

## Dev conventions & gotchas

- **API tests:** `cd api && npm test` (jest, real Postgres via `db push`).
  Lint: `cd api && npx eslint src/`.
- **iOS only builds on CI** (no local Xcode CLI build) — rely on the GitHub
  Actions iOS job. The Xcode project is filesystem-synchronized, so adding/
  deleting `.swift` files needs no `project.pbxproj` edits.
- After each change: commit on `main`, push, watch CI to green before moving on.
  Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **SwiftUI gotcha:** heavy view bodies hit "compiler unable to type-check in
  reasonable time" — extract into `@ViewBuilder` helpers / ViewModifiers.
- **Dev API host:** addressed by the Mac's mDNS hostname
  (`Daniels-MacBook-Air-204.local:3000`) in both the iOS DEBUG base URL and
  `api/.env` `PUBLIC_BASE_URL` — survives WiFi changes. Don't hardcode a raw IP.
  Restart `npm run dev` after `.env` changes.
- **Prisma:** schema changes need both a schema edit AND a hand-written migration
  in `api/prisma/migrations/<ts>_name/migration.sql` (prod runs
  `prisma migrate deploy`; tests use `db push`).

---

## Key files touched this session

| Area | Files |
|------|-------|
| Payment removal (API) | `api/prisma/schema.prisma`, `api/prisma/migrations/20260626020000_remove_payment_stack/`, `api/src/routes/{payments,quotes,admin,webhooks}.js`, `api/src/services/stripe.js`, `api/src/app.js`, `render.yaml` |
| Payment removal (iOS) | `ios/.../Services/APIService.swift`, `ios/.../Models/Models.swift`, `ios/.../Views/Business/{DashboardView,BusinessDetailView}.swift`, `ios/.../Views/{Home/ProfileView,Quotes/QuotesView}.swift` |
| License requirement | `api/src/routes/businesses.js`, `ios/.../Views/Business/{BusinessProfileSetupView,EditBusinessProfileView}.swift` |
| Legal hardening | `web/app/terms/page.tsx`, `api/src/services/legal.js`, `api/src/routes/auth.js`, `ios/.../Views/Auth/{RegisterView,LoginView}.swift`, `ios/.../Views/Business/BusinessDetailView.swift` |
| Cost-tier UX | `api/src/services/costTier.js`, `api/src/routes/businesses.js`, `ios/.../Views/Business/BusinessSearchView.swift`, `ios/.../Views/Theme.swift` |
