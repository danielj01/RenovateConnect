# Next-Steps Research — June 2026

> Companion to `RETENTION_AND_FEATURE_ROADMAP.md`. That doc was written before
> push, escrow, photo messaging, near-me, the Inspiration feed, the Pro tier,
> and the OWASP pass shipped — so most of its "Quick Wins" and Specs #1/#2 are
> now done. This doc is the fresh look: **what's missing today, and which
> flows are worth reworking next.**
>
> Three lenses: (1) what's blocking a clean launch, (2) what unlocks the next
> leg of retention/revenue, (3) which existing flows are clunky and should be
> redone.

---

## Lens 1 — Launch-blocking gaps in the product itself

(Infra gaps live in `LAUNCH_READINESS.md`. These are product gaps that block
TestFlight or expose us to legal/PR/regulatory risk.)

1. **Reporting + blocking for UGC.** Apple App Store guideline 1.2 requires
   any app with user-generated content to provide a way to report objectionable
   content/users and to block other users. We have UGC in three places: photos
   (portfolio, inspiration, message attachments), messages, and reviews. There
   is no `Report` model, no `Block` model, no UI. **Apple will reject without
   this.** ~half day backend + ~half day iOS.
2. **Dispute flow on milestones.** Escrow auto-releases at 7 days, but a
   homeowner has no way to raise a concern that pauses the release. The first
   unhappy homeowner emails support; the first contractor screams about money.
   Needs: a `Dispute` model (status, reason, evidence photos), pause-on-dispute
   in the auto-release sweep, an admin review queue. Highest unmanaged legal
   risk in the product right now. ~2 days backend + ~1 day iOS + admin.
3. **Contractor identity verification beyond a string.** `Business.verified` is
   admin-toggleable but the input is a free-text `licenseNumber`. For a
   marketplace touching money, "verified" needs document upload (business
   license PDF, insurance certificate with expiry), an admin review queue, and
   automatic expiry handling. Otherwise the badge means whatever we say it
   means and we can't defend it if challenged. ~2 days.
4. **Homeowner receipt + stored agreement artifact.** When a homeowner pays a
   deposit, Stripe sends a generic email. There's no branded receipt with line
   items, contractor info, scope, refund policy, and dispute window — and no
   stored "agreement" they can reopen in the app. This also unblocks chargeback
   defense. ~1 day.
5. **Review authenticity gate.** Anyone with an account can review any
   business. Tie review eligibility to a paid deposit or at minimum a closed
   `Lead`. Houzz/Angi got burned by fake-review lawsuits — cheap to get ahead
   of while volume is zero. ~half day.

> **Already done, do not re-do:** notification preferences (master switch +
> `notifyLeads/Messages/Appointments/Reviews` on `User`, `PATCH /auth/me`,
> `NotificationSettingsView.swift`). Push notifications (APNs end-to-end).
> Account deletion (`DELETE /auth/me`).

---

## Lens 2 — Next leg of retention/revenue

6. **Quote templating + line items.** Today a quote is a low/high range + scope
   text. Saved line-item templates ("Bathroom remodel — demo, plumbing rough-in,
   tile…") drop quote-send time from ~20 min to ~2 min, which is the #1 reason
   contractors abandon marketplaces. Also feeds Insights with real material.
7. **"Project" as the homeowner's first-class hub.** `Project` exists in the
   schema (active/completed/cancelled) but the iOS surface is thin. Make it the
   homeowner's home base: photos, estimate, saved contractors, quotes received,
   messages, milestones, receipts — all under one Project. Most of the data
   already exists; this is a join screen. Houzz's D30 retention is driven by
   exactly this pattern.
8. **Re-engagement push around the AI estimate.** Estimates are already
   persisted (`Estimation` model). The unlock: 3 days after an estimate, push
   *"3 verified contractors near you can do this for ~$X — want a one-tap
   intro?"* Converts the top-of-funnel estimator into bookings.
9. **Sponsored slot performance reporting for Pro contractors.** A contractor
   paying $5/mo can't see impressions/clicks/leads from the Sponsored slot.
   Churn at month 4 (end of 90-day trial + 1 paid month) will be brutal
   without it. A simple impressions/CTR card makes the $5 self-justify and is
   the natural Insights ($10) upsell ("see who's searching for what near you").
10. **Saved searches → push alerts.** `savedSearches.js` ships rows but I don't
    believe anything triggers from them. *"3 new contractors match your saved
    search 'kitchen, 94610'"* is one of the highest-CTR re-engagement pushes
    in any marketplace. Cheap given the wiring exists.
11. **Two-sided referrals.** Homeowner refers a friend → both get $25 off the
    next deposit commission (platform eats it). Contractor refers another
    contractor → 1 month free Pro. Two-sided referrals shorten marketplace CAC
    payback by ~40%.

---

## Lens 3 — Flows worth redesigning

12. **Quote → deposit → escrow is opaque.** Compress it into a single visible
    "project status bar" inside the Project view:
    *Quote sent → Accepted → Deposit paid → Milestone 1 funded → Released → …*.
    Does more for trust than any badge.
13. **Onboarding splits by role at the wrong moment.** Most marketplaces now
    ask *"what brings you here?"* before account creation and tailor the next
    3 screens. Asking for role *after* register lets the homeowner-who's-
    secretly-a-contractor abandon. Move the role pick to the cold-start screen.
14. **Inspiration → contractor handoff is too many taps.** Today: tap photo →
    contractor profile → tap message → empty message box. Add a *"Get a quote
    for this look"* button on the photo itself that pre-fills the conversation
    with the photo + an auto-generated estimate from that photo. This is the
    single biggest "wow" moment in the app and it's currently 3 taps and a
    blank textbox.
15. **Sponsored slot disclosure copy.** Once an FTC investigator or an App
    Store reviewer sees the slot without a tappable *"Sponsored — learn more"*
    explanation, we risk a forced redesign. Tiny copy fix, big derisk. Do it
    while there's only one slot.
16. **Messaging is poll-based; will hurt around ~50 active conversations.**
    Move to **Server-Sent Events** before WebSockets — easier on Render, works
    through the existing HTTP stack, same "live" feel for inbound. WebSockets
    can wait until we also want typing indicators.
17. **iOS dev base URL is HTTP.** Already a known TODO. Process fix, not just a
    one-time flip: drive `APIService.base` from `Configuration` per build
    config (Debug vs Release) so it's literally impossible to ship a release
    pointing at LAN HTTP.

---

## Recommended sequence (next ~2 weeks of product work)

Ignoring the LAUNCH_READINESS infra/Apple-signing track, which runs in parallel:

1. **Reporting + blocking** (Apple 1.2 blocker — small) — ~1 day
2. **Disputes on milestones** (biggest unmanaged risk) — ~3 days
3. **Contractor doc-verification** (defensible "verified" badge) — ~2 days
4. **Project hub view on iOS** (D30 retention join screen) — ~2 days
5. **Inspiration → "quote this look" one-tap intro** (flagship flow rework) — ~1 day
6. **Sponsored disclosure copy + dashboard perf card** (regulatory + churn) — ~half day
7. **Saved-search → push alerts** (re-engagement) — ~half day

Deferred until post-launch: quote templates, referrals, SSE messaging upgrade,
gamification, the Insights $10 tier feature expansion.

---

*Author: working session 2026-06-09. Update freely as items ship.*
