-- Sponsored-slot performance metrics: impressions + clicks for the Pro
-- dashboard's performance card.
ALTER TABLE "Business" ADD COLUMN "sponsoredImpressions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Business" ADD COLUMN "sponsoredClicks" INTEGER NOT NULL DEFAULT 0;
