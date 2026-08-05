-- Listing-lifecycle warnings: tell a contractor their free month is about to
-- end, and tell them when their listing has actually gone hidden. Before this,
-- a business was silently delisted at day 30 with no notice of any kind.

-- New activity/notification category for these notices. (PG 12+ permits
-- ALTER TYPE ... ADD VALUE inside a transaction as long as the new value isn't
-- used in the same transaction — this migration only declares it.)
ALTER TYPE "ActivityType" ADD VALUE 'LISTING';

-- Send-once bookkeeping for each notice, cleared when a subscription goes live
-- so a later lapse warns again.
ALTER TABLE "Business" ADD COLUMN "listingExpiryWarnedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "listingLapsedNoticeAt" TIMESTAMP(3);
