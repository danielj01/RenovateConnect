-- Remove the in-app construction-payment stack (deposit + milestone escrow +
-- disputes + Stripe Connect) for CSLB compliance. Homeowners contract with and
-- pay the licensed contractor directly, off-platform. Preserved at git tag
-- `pre-deposit-removal`. The Pro subscription (Business.pro* + stripeCustomerId)
-- is unrelated and intentionally kept.

-- Drop dependent tables first (FKs), then parents.
DROP TABLE IF EXISTS "Dispute" CASCADE;
DROP TABLE IF EXISTS "Payment" CASCADE;
DROP TABLE IF EXISTS "Milestone" CASCADE;
DROP TABLE IF EXISTS "Project" CASCADE;

-- Drop the Stripe Connect capability columns from Business.
ALTER TABLE "Business" DROP COLUMN IF EXISTS "stripeAccountId";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "chargesEnabled";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "payoutsEnabled";

-- Drop the now-unused enums.
DROP TYPE IF EXISTS "PaymentStatus";
DROP TYPE IF EXISTS "MilestoneStatus";
DROP TYPE IF EXISTS "ProjectStatus";
DROP TYPE IF EXISTS "DisputeStatus";
DROP TYPE IF EXISTS "DisputeReason";
