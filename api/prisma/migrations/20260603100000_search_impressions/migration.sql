-- Track how many times a business listing appeared in search results,
-- distinct from profileViews (full-profile opens).
ALTER TABLE "Business" ADD COLUMN "searchImpressions" INTEGER NOT NULL DEFAULT 0;
