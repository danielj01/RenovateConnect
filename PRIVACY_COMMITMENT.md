# RenovateConnect — Privacy Commitment

> Plain-English commitment to homeowners about what we collect and how the
> contractor-facing **Pro Insights** tier works. This is the design contract the
> code must uphold (see `api/src/routes/payments.js` → `/pro/insights`), and the
> basis for the user-facing privacy policy + App Store privacy answers.
>
> _Last updated: 2026-06-04_

---

## 1. Our promise to homeowners

- **We never sell or share your personal information with contractors.** A
  contractor only ever sees your details when **you** choose to contact them
  (message, quote request, booking) — never before, and never by paying us.
- **Your number, email, exact location, and search history are never exposed**
  to contractors, period.
- **You choose who to talk to.** Your contact info is not auctioned, blasted, or
  sold as a "lead." (This is the core of our anti-Angi positioning.)

## 2. What the contractor "Insights" tier actually shows

The $10/mo **Pro Insights** plan gives contractors **aggregated, de-identified
market trends only** — never data about a specific person:

- **Demand by category** — e.g. "Kitchen: 23 saved searches this period."
- **Demand by project type** — counts of AI estimates by room type.
- **Demand by area** — **city-level only** (e.g. "Oakland, CA: 9"), never a
  street address, ZIP+4, or anything that points to a household.
- **Their own performance** — the contractor's own profile views, search
  impressions, leads, and conversion. (Their data, not yours.)

**Small-group suppression:** every figure is a bucket of **at least 5**. Any
group smaller than that is hidden entirely, so no number can be traced back to an
individual or a small set of people. (Constant: `MIN_BUCKET = 5`.)

## 3. Why this is compliant

- **CCPA/CPRA**: "de-identified" and "aggregate consumer information" are outside
  the law's scope — data that can't reasonably be linked to a consumer or that
  describes a group. Our aggregation + small-bucket suppression keeps insights in
  that category, and we don't attempt re-identification.
- **GDPR**: truly **anonymized** (irreversibly non-identifying) data falls outside
  the GDPR. Aggregated counts with suppressed small buckets and no per-record
  output meet that bar; we never expose row-level or personal data.
- **Apple App Store**: we disclose data collection accurately in the App Privacy
  label, request location only with purpose strings + consent, and never
  repurpose personal data into something sold to third parties.

> Guardrail for engineers: the insights endpoint must **only** return aggregates
> with `count >= MIN_BUCKET`. Never add a code path that returns row-level data,
> a homeowner identifier, precise coordinates, or any bucket finer than
> city-level. If a future feature needs more, it requires explicit homeowner
> **opt-in consent** + a privacy-policy update first.

## 4. What we collect (and why)

| Data | Why | Shared with contractors? |
|---|---|---|
| Name, email | Account, contacting contractors you pick | Only when you contact them |
| Photos you upload | AI estimates, messages you send | Only in chats you start |
| Approximate location | "Near me" search (on-device; not stored to a profile) | No (only aggregated city-level demand) |
| Saved searches / estimates | Personalize + power aggregate demand trends | No — only as anonymized counts |
| Usage / device | Reliability, notifications | No |

## 5. Your controls

- **Delete your account** anytime in-app (Profile → Delete account); we remove
  your data (`DELETE /auth/me`).
- **Location is opt-in** and used only while you search; deny it and the app
  still works.
- **Notifications** are per-type toggleable.

---

## 6. User-facing pledge (short form for the app / website)

> **Your privacy, simply put.** We never sell your information. Contractors only
> reach you when *you* contact them first — never by paying us. Any market data
> we share with pros is anonymized and grouped (city-level at most), so it can
> never point back to you. You can delete your account and data anytime.

## 7. Sources

- [GDPR anonymization vs CCPA/CPRA de-identification — TermsFeed](https://www.termsfeed.com/blog/gdpr-anonymization-versus-ccpa-de-identification/)
- [Can a service provider use/transfer personal information if anonymized or aggregated? — Lexology](https://www.lexology.com/library/detail.aspx?g=7b6dc7a4-a247-4778-a2d1-5a145b9454bf)
- [What you must know about 'third parties' under GDPR and CCPA — IAPP](https://iapp.org/news/a/what-you-must-know-about-third-parties-under-the-gdpr-ccpa)
- [Privacy Laws Compared: CCPA, GDPR, LGPD (2025) — ComplianceHub](https://compliancehub.wiki/privacy-laws-compared-ccpa-gdpr-and-lgpd-compliance-requirements-2025-update/)
