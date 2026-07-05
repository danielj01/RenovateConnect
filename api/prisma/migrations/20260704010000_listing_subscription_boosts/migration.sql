-- Revenue model change: a single $10/mo listing subscription (includes
-- Insights) is now required to be publicly listed, replacing the two-tier
-- Sponsored/Insights plans. The slot above organic search is now sold as a
-- $5 one-time, 7-day "Boost" instead of coming with the subscription.

-- The two-tier plan discriminator is gone — there is only one plan now.
ALTER TABLE "Business" DROP COLUMN "proPlan";

-- End of the free first month of listing (stamped at first admin approval)
-- and the denormalized boost expiry used by search.
ALTER TABLE "Business" ADD COLUMN "freeListingEndsAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "boostedUntil" TIMESTAMP(3);

-- Every already-approved business gets a fresh free month so nothing vanishes
-- from search the moment this deploys.
UPDATE "Business"
SET "freeListingEndsAt" = NOW() + INTERVAL '30 days'
WHERE "approvalStatus" = 'APPROVED';

-- Boost purchase history (one row per paid boost week).
CREATE TABLE "Boost" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Boost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Boost_stripeSessionId_key" ON "Boost"("stripeSessionId");
CREATE INDEX "Boost_businessId_idx" ON "Boost"("businessId");

ALTER TABLE "Boost" ADD CONSTRAINT "Boost_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
