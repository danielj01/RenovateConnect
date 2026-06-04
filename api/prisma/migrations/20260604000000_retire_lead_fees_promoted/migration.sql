-- Retire the lead-fee + promoted-listing monetization model.
--
-- Discovery is now free and ranking is earned through admin verification, not
-- paid placement; revenue comes from the in-app deposit commission. This drops
-- the now-dead columns those models relied on:
--   Business.isPromoted / promotedUntil  — paid top-of-search placement
--   Business.stripeCustomerId / stripeSubId — the promoted-listing subscription
--   Business.cardBrand / cardLast4        — card on file for monthly lead-fee invoices
--   Lead.billed / billedAt                — per-lead billing state
--
-- Lead rows themselves are kept (they remain the contractor's CRM pipeline);
-- only their billing columns go away. No data backfill is needed.

ALTER TABLE "Business"
  DROP COLUMN IF EXISTS "isPromoted",
  DROP COLUMN IF EXISTS "promotedUntil",
  DROP COLUMN IF EXISTS "stripeCustomerId",
  DROP COLUMN IF EXISTS "stripeSubId",
  DROP COLUMN IF EXISTS "cardBrand",
  DROP COLUMN IF EXISTS "cardLast4";

ALTER TABLE "Lead"
  DROP COLUMN IF EXISTS "billed",
  DROP COLUMN IF EXISTS "billedAt";
