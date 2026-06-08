# RenovateConnect — Retention & Feature Roadmap

*Prepared: June 2026 · Product Engineering Strategy v1*

---

## 1. Current Feature Inventory & UX Audit

### 1.1 Client (Homeowner) features
| Feature | File | State | UX notes |
|---|---|---|---|
| Contractor search | `BusinessSearchView.swift` | ✅ Solid | Specialty chips, featured carousel, list cards, `.searchable`, debounced empty-query reload. **No location/price/rating filters, no sort, no map.** |
| Business detail | `BusinessDetailView.swift` | ✅ Strong | Hero, stat row, about, specialties, portfolio gallery, reviews, contact CTA. **No save/favorite, no share, no booking.** |
| AI cost estimation | `EstimationView.swift` | ✅ Differentiator | Photo upload → Claude breakdown in a sheet. **Result is ephemeral — closes and is gone; no history surfaced even though `GET /estimations` exists.** |
| AI chatbot | `AIChatView.swift` | ✅ Differentiator | Recommends businesses by specialty. **History is local `@State` only → lost on tab switch; no deep links to recommended businesses.** |
| Messaging | `MessagingView.swift`, `ConversationsView.swift` | ⚠️ Basic | Loads once via `.task`; manual pull-to-refresh. **No unread indicators, no read receipts, no auto-refresh/real-time, no tab badge, no timestamps.** |
| Reviews | `BusinessDetailView` + `businesses.js` | ⚠️ Partial | Can post rating+text; recalculates average. **Unverified, no photos, no prompt loop after a job.** |
| Profile | `ProfileView.swift` | ✅ Basic | Avatar, role badge, business card, sign out. **No edit, no settings, no notification prefs.** |
| Auth | `LoginView.swift`, `RegisterView.swift` | ✅ Works | Email + Sign in with Apple. **No onboarding/first-run, thin registration (name/email/pw/role only).** |

### 1.2 Business (Contractor) features
| Feature | File | State |
|---|---|---|
| Dashboard analytics | `DashboardView.swift` + `GET /businesses/dashboard` | ✅ New — leads, conversion %, pipeline $, profile views |
| Lead CRM | `LeadsView.swift` + `PATCH /leads/:id` | ✅ New — pipeline, notes, value |
| Portfolio manager | `PortfolioManagerView.swift` + portfolio CRUD | ✅ New |
| Promoted listing | `advertising.js` + `webhooks.js` | ✅ Stripe subscription (no upsell UI) |
| Role-based nav | `MainTabView.swift` | ✅ Separate business/client tab bars |

### 1.3 Cross-cutting audit findings (the retention-critical ones)
- **🔴 Zero push notification infrastructure.** No APNs, no device-token storage, no triggers. Nothing pulls a user back into the app.
- **🔴 No unread/badge state anywhere.** The Messages tab and conversation rows never signal "you have something waiting."
- **🔴 The AI estimate — our top acquisition hook — is not retained.** Users get value once, then it vanishes. No reason to return to it.
- **🔴 No saved/favorited contractors.** Browsing is disposable; no personal collection to come back to.
- **🟡 Messaging is poll-only and feels dead** — no live updates, receipts, or timestamps.
- **🟡 No trust signals** (verified/license badges) despite a `licenseNumber` field in the schema.
- **🟡 No onboarding, empty-state guidance, or activity feed.**

---

## 2. Consumer Behavior & Retention Research Insights

### 2.1 The benchmark we're fighting (marketplace apps, 2023→2024)
| Milestone | Marketplace retention | Implication |
|---|---|---|
| Day 1 | ~25% | 3 of 4 users gone after day one → onboarding + immediate value matter |
| Day 7 | ~15% | The "habit window" → needs a recurring reason to open |
| Day 30 | ~8% | Long-tail → needs notifications + saved state + repeat use |

### 2.2 What moves the needle (evidence)
- **Push notifications are the single biggest lever.** Users who receive ≥1 push in their first 90 days retain **~3× (≈120%) higher**; **weekly pushes ≈ 440% higher**, **daily ≈ 820% higher** retention vs. zero. Retail apps see **2–5× higher 90-day retention** from weekly pushes.
- **Saved providers + repeat bookings** convert one-time users into loyal ones; repeat booking is the clearest trust/return signal.
- **Trust signals (verified badges)** measurably influence hiring decisions and increase platform usage; 2025 best practice is *dynamic* badges ("Verified — checked 2h ago", "Level 3") over static ones.
- **Subscriptions/membership perks** drove a reported **+27% ARPU** for marketplaces adopting them in 2024 (ties to our monetization plan).
- **Gamification** (points, levels, response-time badges) is a proven repeat-engagement driver.
- **Session math:** push-enabled users typically reach ≥9 sessions; 11 sessions is the informal "retained" threshold.

### 2.3 Translation to our app
Our differentiator (AI estimation) wins **Day 1**. But we have **nothing that wins Day 7/30** — no push, no saved state, no live messaging. That is precisely where marketplace apps bleed users, and precisely where our code is empty.

---

## 3. Gap Analysis — what competitors do that our code lacks

| Retention pattern | Competitor benchmark | Our code today | Gap severity |
|---|---|---|---|
| Push re-engagement | Thumbtack/Angi: instant "new lead/message" + digests | None | 🔴 Critical |
| Live messaging + read state | In-app chat w/ receipts, unread badges | Poll-once, no unread | 🔴 Critical |
| Saved providers / wishlists | Houzz "Ideabooks," Angi saved pros | None | 🔴 Critical |
| Persisted value artifacts | Houzz saved projects; estimates kept | Estimate discarded after sheet | 🔴 Critical |
| Verified/trust badges | Google "Verified", Angi background-checked | `licenseNumber` unused | 🟡 High |
| Booking/scheduling | Calendars, appointment requests | None | 🟡 High |
| Onboarding / first-run | Guided setup, permission priming | None | 🟡 High |
| Review prompt loop + photos | Post-job review nudges | Manual, text-only | 🟢 Medium |
| Gamification / loyalty | Levels, perks, points | None | 🟢 Medium |

**Highest-friction drop-off points in our current flows:**
1. **Post-estimate cliff** — user gets an AI estimate, closes the sheet, and there's no saved record and no guided next step → they leave.
2. **Silent inbox** — a contractor replies, but the homeowner is never notified and sees no unread badge → conversation dies.
3. **Disposable browsing** — no way to save a contractor they liked → no reason to reopen the app.
4. **Empty cold start** — no onboarding, so a brand-new user with no data sees sparse screens and churns on Day 1.

---

## 4. Prioritized Feature Roadmap (Impact × Effort)

### 🟢 Quick Wins (high impact, low effort — ship first)
1. **Verified / Trust badges** — add `verified` (and surface `licenseNumber`) → badge on cards & detail. *(Schema: 1 bool; UI: reuse `FeaturedBadge` pattern.)*
2. **Unread message badges** — tab badge + bold/dot on conversation rows. *(Needs lightweight read-state; see Spec #2.)*
3. **Persist + surface AI estimate history** — `GET /estimations` already exists; add a "My Estimates" list and re-open results. *(Backend done; iOS view only.)*
4. **Persist AI chat history + deep links** — store history in a `@StateObject`/store and link recommended business names to `BusinessDetailView`.
5. **Empty-state CTAs & permission priming** — turn blank screens into guided actions ("Get your first estimate", "Save a contractor").

### 🟠 Major Projects (high impact, higher effort — core retention engine)
1. **Push Notifications (APNs) end-to-end** — *Spec #1*. The #1 retention multiplier.
2. **Real-time-feeling messaging** — read receipts, unread counts, auto-refresh/polling, timestamps — *Spec #2*.
3. **Saved Contractors + "My Projects" return hub** — favorites + estimate history in one personalized home — *Spec #3*.
4. **Booking / appointment requests** — `Appointment` model + request/confirm flow + calendar UI.
5. **Onboarding wizard** — first-run priming (incl. notification permission) + business-profile creation flow.
6. **In-app activity feed / notification center** — mirrors pushes for users who declined them.

### 🔵 Future Enhancements (strategic, post-liquidity)
1. **Gamification** — contractor response-time badges, "Level 3 Verified," homeowner project milestones.
2. **Membership/loyalty perks** (+27% ARPU lever; ties to monetization plan).
3. **In-app payments / escrow** (Stripe Connect) — unlocks transaction take-rate + verified reviews. ✅ *Shipped.*
4. **Photo reviews + automated post-job review prompts.**
5. **Referral loops** (two-sided) with deep links.
6. **Pro "Insights" tier — $10/mo (upsell from the $5 Sponsored tier).** A higher
   plan giving contractors more market intelligence: demand by area (where
   homeowners are searching/estimating near them), trending project categories,
   their profile-view/impression trends, and lead-source analytics.
   - **Shape it as aggregated/anonymized market data, not raw PII.** Surfacing an
     individual homeowner's location or personal search history to contractors is
     a privacy/legal landmine (CCPA/GDPR + App Store privacy rules) and cuts
     against our "no-spam, you-choose" positioning. Deliver value as heatmaps and
     trends ("12 kitchen estimates in 94610 this month"), not named individuals.
   - Builds naturally on existing data: `searchImpressions`, `profileViews`,
     estimations, saved-search demand, and the new geocoded business/search
     coordinates. Tier it above the $5 Sponsored plan (`proStatus` →
     plan/price-id), reusing the subscription plumbing already in place.

---

## 5. Technical Implementation Specs — Top 3 Highest-Impact Features

> Stack reference: Node/Express + Prisma/Postgres (`api/`), SwiftUI iOS (`ios/`), JWT auth (`middleware/auth.js`), Prisma singleton (`services/db.js`), router-per-file mounted in `app.js`.

---

### ⭐ Spec #1 — Push Notifications (APNs) — *the 3× retention lever*

**Goal:** notify the right user the moment something happens — new message, new lead, estimate ready — plus a weekly digest.

**New schema (`schema.prisma`):**
```prisma
model DeviceToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  platform  String   @default("ios")
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
// User { ... deviceTokens DeviceToken[]   pushEnabled Boolean @default(true) }
```

**New backend:**
- `services/push.js` — wraps APNs (`node-apn` or `@parse/node-apn`, or Firebase Admin). Single `sendPush(userId, { title, body, data })` that looks up the user's `DeviceToken`s and sends, pruning dead tokens.
- `routes/devices.js` (mount `/devices` in `app.js`):
  - `POST /devices` (auth) — register/update `{ token, platform }`.
  - `DELETE /devices/:token` (auth) — on logout.

**Trigger points (modify existing handlers):**
- `routes/messages.js` → after `db.message.create` in `POST /conversations/:id/messages`: `sendPush(recipientId, { title: senderName, body, data:{ conversationId } })`.
- `routes/messages.js` → `POST /conversations` (new lead): notify the business owner ("New lead from {client}").
- `routes/estimations.js` → after estimate completes: notify the homeowner ("Your estimate is ready").
- **Weekly digest:** a cron (or scheduled task) → businesses get "You have N new leads this week"; clients get "3 new contractors near you."

**iOS changes:**
- Add `AppDelegate` via `@UIApplicationDelegateAdaptor` in `RenovateConnectApp.swift`; implement `didRegisterForRemoteNotificationsWithDeviceToken` → `APIService.shared.registerDevice(token:)`.
- **Permission priming screen** (don't cold-prompt): after the user's first valuable action (first estimate or first message), show a custom "Stay updated" sheet → then `UNUserNotificationCenter.requestAuthorization`.
- Handle notification taps → deep link to the relevant `MessagingView`/conversation.
- `AuthStore.logout()` → call `DELETE /devices/:token`.

**UX patterns:** app icon badge counts, in-app banners when foregrounded, granular prefs in Profile (messages / leads / digests).

**Effort:** Major (APNs cert/key setup + backend service + iOS plumbing). **Impact:** Highest single lever (≈3× retention).

---

### ⭐ Spec #2 — Real-time-feeling Messaging + Unread State — *wins the Day-7 habit loop*

**Goal:** make the inbox feel alive — unread badges, read receipts, auto-refreshing threads, timestamps.

**New schema (`schema.prisma`):** add read-state to `Conversation`:
```prisma
model Conversation {
  // ...existing...
  clientLastReadAt   DateTime?
  businessLastReadAt DateTime?
}
```
*(Per-side timestamp avoids a per-message read table; unread = messages with `createdAt > myLastReadAt && senderId != me`.)*

**New / modified endpoints (`routes/messages.js`):**
- Modify `GET /conversations` → include `unreadCount` per conversation (count messages after the caller's `lastReadAt` not sent by them) and `lastMessage`/`updatedAt` (already partially there).
- `POST /conversations/:id/read` (auth) → set the caller's `clientLastReadAt`/`businessLastReadAt = now()`.
- Add `GET /conversations/unread-count` → total across threads (for the tab badge).
- (Receipts) `GET /conversations/:id/messages` already ordered asc; expose the *other* party's `lastReadAt` so the client can render "Read".

**iOS changes:**
- `ConversationsView` / `ConversationRowView` → show an unread dot + bold title + count chip when `unreadCount > 0`; relative timestamp.
- `MainTabView` → `.badge(unreadTotal)` on the Messages tab; fetch via a small `@StateObject` `InboxStore` polled on `scenePhase == .active`.
- `MessagingView` → on `.onAppear` call `POST /conversations/:id/read`; **auto-refresh** by polling `getMessages` every ~4s while visible (pragmatic pre-WebSocket); render sent/delivered/read ticks and message timestamps; keep existing optimistic append + auto-scroll.
- (Optional later) swap polling for a WebSocket/SSE channel.

**UX patterns:** unread dots, bold rows, "Read" receipts, "typing…" (optional), grouped day separators.

**Effort:** Medium–Major. **Impact:** Very high — messaging is the core marketplace engagement loop.

---

### ⭐ Spec #3 — Saved Contractors + "My Projects" Return Hub — *gives users a reason to come back*

**Goal:** stop disposable browsing and the post-estimate cliff. Let users **save contractors** and **revisit past AI estimates** from one personalized hub — and bridge estimate → contact.

**New schema (`schema.prisma`):**
```prisma
model Favorite {
  id         String   @id @default(cuid())
  userId     String
  businessId String
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@unique([userId, businessId])
}
```
*(Estimates already persist via the `Estimation` model + `GET /estimations` — no new storage needed, just exposure.)*

**New endpoints (`routes/favorites.js`, mount `/favorites`):**
- `POST /favorites/:businessId` (auth, CLIENT) — idempotent upsert.
- `DELETE /favorites/:businessId` (auth).
- `GET /favorites` (auth) — returns saved businesses (reuse the search `include`).
- Reuse existing `GET /estimations` for history; optionally add `GET /estimations/:id`.

**iOS changes:**
- **Heart toggle** on `BusinessDetailView` (toolbar) and on `BusinessListCard`/`FeaturedBusinessCard` with a spring animation + optimistic state via a `FavoritesStore`.
- **New "My Projects" hub** (add a tab for clients in `MainTabView`, or a section in `ProfileView`): two segments —
  - *Saved contractors* → cards linking to `BusinessDetailView`.
  - *My estimates* → date-stamped cards; tap re-opens `EstimationResultView`; add a **"Find contractors for this estimate"** CTA that routes to filtered search / `ContactBusinessSheet` (closes the post-estimate cliff).
- Persist AI chat history into a store as part of the same hub.

**UX patterns:** heart fill animation, "Saved ✓" toasts, empty states that guide ("Save contractors to compare them later"), estimate cards showing room type + total range + date.

**Effort:** Medium. **Impact:** High — directly converts one-time AI-estimate users into returning users (Day-30 lever).

---

### Suggested sequencing
1. **Sprint 1 (Quick Wins):** verified badges, unread badges (Spec #2 read-state), estimate-history view, chat persistence, empty-state CTAs.
2. **Sprint 2 (Spec #1):** Push notifications end-to-end + permission priming.
3. **Sprint 3 (Spec #2 full + Spec #3):** live messaging polish + Saved/My Projects hub.
4. **Sprint 4+:** booking, onboarding wizard, activity feed → then Future Enhancements.

---

*Sources*
- [Benchmarks Report: How Push Notifications Impact Mobile App Retention (Airship)](https://grow.urbanairship.com/rs/313-QPJ-195/images/WP_App_Retention_Rates_Benchmarks.pdf)
- [50+ Push Notification Statistics for 2025 (MobiLoud)](https://www.mobiloud.com/blog/push-notification-statistics)
- [Push Notifications Statistics 2025 (Business of Apps)](https://www.businessofapps.com/marketplace/push-notifications/research/push-notifications-statistics/)
- [Mobile App Retention Benchmarks by Industry 2025 (Growth-onomics)](https://growth-onomics.com/mobile-app-retention-benchmarks-by-industry-2025/)
- [2026 Guide to App Retention (GetStream)](https://getstream.io/blog/app-retention-guide/)
- [21 Services Marketplace Features You Need in 2026 (Rigby)](https://www.rigbyjs.com/blog/services-marketplace-features)
- [Google Unifies Trust Signals: "Verified" Badge (Searchen)](https://www.searchen.com/2025/09/30/google-unifies-trust-signals-all-local-services-ads-to-show-google-verified-badge-starting-october-2025/)
- [The "Verified" Badge: Consumer Psychology & CTR (Jasmine Directory)](https://www.jasminedirectory.com/blog/the-verified-badge-consumer-psychology-and-click-through-rates/)
- [Top 10 Custom Features for Your Services Marketplace in 2025 (Oyelabs)](https://oyelabs.com/top-custom-features-for-your-services-marketplace/)
