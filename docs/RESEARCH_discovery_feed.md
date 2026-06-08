# Research — Visual Discovery Feed ("Inspiration")

> Deep research for a Pinterest/Houzz-style scrollable feed of renovation
> project photos: passive visual browsing that engages users and routes a tap to
> the contractor behind the photo. **Research + design only — not yet built.**
>
> _Last updated: 2026-06-04_

---

## 1. The problem it solves (why this is worth building)

Our app today is **intent-driven**: you show up because you already want a
quote/estimate. That's great for conversion but weak for **engagement and
return visits** — and renovation is low-frequency (people remodel every few
years), which is our biggest structural retention enemy (see
`CLIENT_ACQUISITION_AND_DIFFERENTIATION.md` §6).

A visual discovery feed flips that: it gives people a reason to open the app
**between projects**, while they're still dreaming, not yet buying. It turns
"I'll deal with it later" browsing into:
- **Engagement** — passive scrolling is sticky (see §3 data).
- **Top-of-funnel demand** — inspiration → "what would this cost?" → estimate →
  matched contractor.
- **Supply value** — every photo is a contractor's marketing surface; great work
  gets discovered, which is a reason for contractors to keep their portfolio rich
  (feeds the cold-start loop).

**The tap-through is the whole point:** like Houzz, every photo links back to the
company that did the work → profile → message/quote. That's demand generation for
contractors and the bridge from inspiration to our existing funnel.

---

## 2. Competitive landscape

### Houzz (the direct analog — study this closely)
- **25M+ photos, 100k+ "Ideabooks."** Photos are uploaded by pros; each photo
  links to **more photos of that project, the pro's profile, and their reviews**.
  This is exactly the "tap a photo → go to the company" behavior we want.
- **Ideabooks** = saveable, organizable, **collaborative** boards (share with a
  partner/designer). Saving is the core engagement + retention loop.
- **Filters** by room, then contextual sub-filters (vanities, tile, color), and
  **by location**. ML recommends similar photos after a click.
- Takeaway: Houzz proved visual discovery is *the* engagement engine for home
  reno. We don't need to out-scale them — we need a sharper wedge (§4).

### Pinterest (the interaction-design analog)
- **Masonry/waterfall layout** (variable-height multi-column) → **+47%
  engagement vs. a uniform grid**, **+29% session duration**, lower bounce.
- **Infinite scroll** suits passive discovery ("scroll, glance, engage").
- **Personalization** lifts pin engagement up to **+80%**; **85%** of weekly
  users have bought from a pin → visual discovery genuinely drives action.

### Instagram / TikTok (the habit analog)
- Full-bleed, fast, algorithmic. Over-rotating here risks turning a utility into
  a doomscroll; we want *inspiration with intent*, not entertainment. Borrow the
  smooth media + save mechanics, not the dopamine-maximizing autoplay.

---

## 3. Our unique wedge (why ours beats a generic photo wall)

Houzz shows you a photo and a pro. **We can show you a photo, an instant AI cost
estimate for that look, and a vetted local pro who can do it — with payment
protection.** No major reno app closes that loop. Concretely:

1. **"What would this cost?" on any photo.** Tap a feed photo → the project's
   real cost range (we already store `PortfolioProject.costMin/costMax`) → and a
   CTA into our **AI estimator** to price *their* version of it. This fuses the
   discovery feed with the estimator front door we already built.
2. **Tap → the actual contractor who did it** (not a stock photo) → message,
   quote, deposit with escrow. Inspiration becomes a booked job in-app.
3. **Local-first.** Reuse the new geocoding/near-me work to bias the feed toward
   contractors who can actually serve the viewer's area — inspiration you can
   *act on*, unlike Houzz's global gallery.

That triad — **inspire → price → hire locally, with protection** — is the
differentiator. The feed is the new top of the funnel that feeds everything we've
already shipped.

---

## 4. What we can build on (current state)

Good news: the raw material already exists.
- **`PortfolioProject`**: `imageUrls[]`, `category` ("Kitchen"…), `costMin/costMax`,
  `durationWeeks`, `featured`, `businessId`, and an **`approvalStatus` (APPROVED)**
  admin gate. Photos are already moderated before they're public.
- **`Business`**: name, city/state, `lat/lng` (near-me), `verified`, rating,
  `proStatus`/`proPlan` (for sponsored pins).
- **S3 image storage**, multipart upload, and an iOS image pipeline (AsyncImage,
  the new message-photo downscaling).
- **`Favorite`** exists but is **business-level only** — photo-level saves
  ("Ideabooks") are net-new (see §6).
- **No feed/discovery endpoint exists yet** — portfolio is only fetched
  per-business (`GET /businesses/:id/portfolio`).

So a v1 feed is largely a *new read surface over existing approved photos* plus a
new save/board model — not a from-scratch content system.

---

## 5. UX design

### The feed ("Inspiration" tab or a Discover surface)
- **Masonry/waterfall**, 2 columns on phone, preserving each photo's aspect
  ratio. Infinite scroll with intelligent preloading.
- Each **pin card**: the photo, a subtle overlay on the contractor (logo + name +
  city), a **save (heart/bookmark)** button, and — our wedge — a small **cost
  range chip** ("~$25–40k") when the project has one.
- Lightweight **filters** up top: room/category (reuse the search specialties),
  and a **"Near me"** toggle (reuse CoreLocation) for local-first inspiration.

### Pin detail (tap a photo)
- Full photo (swipe through the project's other `imageUrls`).
- **Project facts**: category, cost range, duration.
- **The contractor**: avatar, name, verified badge, rating → **"View profile"**
  and **"Message / get a quote"** (straight into the existing flow).
- **The wedge CTA**: **"Get an instant estimate for a project like this"** →
  prefilled `/estimate` (room type from `category`).
- **Save to board** (Ideabook).

### Saving / "Boards" (the retention loop)
- Save any photo to a **Board** ("Kitchen ideas", "Master bath"). Mirrors Houzz
  Ideabooks; this is the #1 reason users come back.
- Boards live in **"My Projects"** (we already have that hub) alongside saved
  contractors + estimates — a single personalized return surface.
- v2: collaborative boards (share with a partner) — Houzz's stickiest feature.

### Web parity (SEO bonus)
- A public web **`/ideas`** feed + per-photo pages would be strong SEO (visual
  long-tail: "modern kitchen remodel oakland") and feed the install funnel, reusing
  the Next.js `web/` workspace. Defer to a later phase.

---

## 6. Data model (proposed)

Reuse `PortfolioProject` as the **source of truth for photos**; introduce a thin
**Pin** concept so a feed item = one *photo* (a project has many), plus saves.

```prisma
// One feed-able photo. Lets us rank/save at photo granularity and decouples the
// feed from the project record. Backfilled from existing PortfolioProject.imageUrls.
model Pin {
  id          String   @id @default(cuid())
  projectId   String
  businessId  String   // denormalized for fast feed queries + sponsored lookup
  imageUrl    String
  category    String?
  saveCount   Int      @default(0)   // popularity signal for ranking
  createdAt   DateTime @default(now())
  project     PortfolioProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  business    Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)
  @@index([category])
  @@index([businessId])
}

model Board {
  id        String   @id @default(cuid())
  userId    String
  name      String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  items     SavedPin[]
}

model SavedPin {
  id        String   @id @default(cuid())
  boardId   String
  pinId     String
  note      String?  // "love this backsplash" — Houzz-style
  createdAt DateTime @default(now())
  board     Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  pin       Pin      @relation(fields: [pinId], references: [id], onDelete: Cascade)
  @@unique([boardId, pinId])
}
```

**Alternative (leaner v1):** skip `Pin` and feed directly off
`PortfolioProject` (flatten `imageUrls` server-side into feed items), and reuse a
generalized favorite for saves. Trade-off: no per-photo `saveCount`/ranking and
messier save semantics. **Recommendation:** introduce `Pin` — it's small and
unlocks ranking + clean saves, and a one-time backfill from existing approved
projects is trivial.

---

## 7. Ranking & personalization

- **v1 (no ML):** APPROVED pins only, ranked by a simple blend — recency +
  `featured` + `saveCount`, with light shuffling so the feed feels fresh per
  load. Optional near-me bias (boost pins whose business is within X miles).
  Cheap, good enough, and avoids a filter-bubble on day one.
- **Sponsored pins:** Pro (`proStatus` trialing/active) businesses get a capped,
  **clearly-labeled** "Sponsored" pin every N items — consistent with the
  search Sponsored slot and the monetization guardrail (labeled, never silently
  ranked). Insights tier could even show which of their pins perform.
- **v2 personalization:** rank from the user's saves/among categories they
  browse (Pinterest's +80% lever). Keep it explainable; respect privacy
  (`PRIVACY_COMMITMENT.md` — no creepy cross-user inference).

---

## 8. Technical architecture

- **Feed endpoint:** `GET /pins?cursor=&category=&lat=&lng=` → cursor/seek
  pagination (NOT offset — infinite scroll needs stable paging as new pins land).
  Returns pin + denormalized business summary so cards render without N+1s.
- **Save endpoints:** `POST /boards`, `POST /boards/:id/pins`, `DELETE …`,
  `GET /boards`. Increment `Pin.saveCount` on save (fire-and-forget).
- **Images = the hard part at scale.** Portfolio photos can be large. Need:
  - **Thumbnails/variants** (feed needs ~600px, not full-res) — generate on
    upload (sharp) or via a CDN image resizer (Cloudflare Images / imgix /
    CloudFront+Lambda@Edge). This is the single biggest perf/cost lever.
  - **CDN in front of S3** (ties to `LAUNCH_READINESS.md` §2.3 note).
  - iOS: prefetch + memory/disk cache (Nuke/Kingfisher, or tuned AsyncImage).
- **iOS masonry:** a waterfall `LazyVStack` of two column stacks (assign each pin
  to the shorter column by running height) or a known SwiftUI masonry approach.
  Aspect-ratio-aware so images don't pop/reflow.
- **Web feed:** SSR/ISR masonry for SEO later (Phase 4).

---

## 9. Engagement & monetization loops

- **Save → board → notify:** "3 new kitchen pins from pros you saved" push ties
  into the existing activity/push system and the favorites digest.
- **Inspiration → estimate → lead:** the "price this look" CTA routes into the
  estimator and contractor match — directly grows the funnel we monetize.
- **Sponsored pins (Pro):** new inventory for the $5 tier; **Insights ($10)** can
  report pin impressions/saves (aggregated) — extends what we just shipped.
- **Contractor incentive:** "your work was saved 42 times this month" is a
  powerful reason to upload more portfolio → richer feed → flywheel.

---

## 10. Risks & hard problems

- **Cold-start content.** A sparse feed feels dead. Mitigations: backfill from
  all existing approved portfolios; make portfolio upload part of contractor
  onboarding; seed with the launch-metro outreach contractors
  (`CONTRACTOR_OUTREACH.md`); consider an editorial/curated row early.
- **Image rights & authenticity.** Only the contractor's *own* project photos
  (we already gate via admin approval). Don't allow stock/lifted images — add a
  "you own the rights" attestation on upload. Watermarking optional.
- **Moderation at scale.** Admin approval works at low volume; a growing feed
  needs better tooling (bulk review, reports, auto-flagging). 
- **Performance/cost.** Un-optimized images = slow feed + S3 egress bills.
  Thumbnails + CDN are non-negotiable before this scales (§8).
- **Scope creep into a social network.** Resist comments/follows/likes-as-vanity
  initially. The job is *inspiration that converts*, not a new social graph.
- **Don't cannibalize trust.** Sponsored pins must stay labeled; the feed
  shouldn't bury organic great work under paid placement.

---

## 11. Phased build plan

**Phase 0 — Decide & spike (small):** lock the data model (Pin vs. flatten),
choose the image-variant strategy (the critical dependency), prototype the iOS
masonry with ~50 seeded photos.

**Phase 1 — Read-only feed (MVP):**
- `Pin` model + backfill from approved `PortfolioProject` images.
- `GET /pins` cursor feed (category filter, optional near-me).
- iOS Inspiration tab (masonry + infinite scroll) → pin detail → **tap to
  contractor** + "price this look" CTA. *(No saving yet — ships the engagement +
  tap-through value first.)*
- Thumbnail variants + CDN.

**Phase 2 — Saving / Boards (retention):**
- `Board`/`SavedPin` models + endpoints; save button + board picker; Boards in
  "My Projects." Save-based push nudges.

**Phase 3 — Monetization & smarts:**
- Sponsored pins (Pro) + Insights pin analytics. Light personalization from saves.

**Phase 4 — Web `/ideas` feed** for SEO + install funnel.

---

## 12. Open questions for the user

- **Placement:** a new bottom-tab ("Inspiration"), or fold it into Explore as a
  toggle? (New tab = max visibility but more nav real estate.)
- **Saving model:** simple one-tap "saved photos" list, or full Houzz-style
  multi-board Ideabooks from day one? (Boards are stickier but more build.)
- **Content source for launch:** purely contractor-uploaded, or seed with a
  curated set to avoid an empty feed? (Affects cold-start feel.)
- **How aggressive on the AI-estimate CTA** — subtle chip vs. prominent button on
  every pin? (Our wedge, but don't make inspiration feel like a sales funnel.)

---

## 13. Sources

- [Houzz Ideabooks — How to create and use](https://www.houzz.com/magazine/how-to-create-and-use-ideabooks-stsetivw-vs~19764256)
- [Houzz home design ideas (photo discovery)](https://www.houzz.com/photos/home-design-ideas-phbr0-bp~)
- [A guide to using Houzz Ideabook — Anthony Slabaugh Remodeling](https://www.anthonyslabaughremodeling.com/unleashing-your-creativity-a-guide-to-using-houzz-ideabook)
- [Pinterest: How visual discovery built a $20B giant — Passionate Agency](https://passionates.com/pinterest-visual-discovery-social-commerce-giant/)
- [Inside Pinterest UX: endless scroll, endless engagement](https://en.incarabia.com/inside-pinterest-ux-endless-scroll-endless-engagement-768866.html)
- [Building a Pinterest-style masonry layout in SwiftUI — Medium](https://medium.com/@akashkottil/building-a-pinterest-style-masonry-layout-in-swiftui-reusable-responsive-8f5433ae80c7)
- [Infinite scroll design: definition, alternatives & tips — Lollypop](https://lollypop.design/blog/2026/march/infinite-scroll-design-definition-alternatives-tips/)
- [What is infinite scroll? — Shopify](https://www.shopify.com/blog/infinite-scroll)
