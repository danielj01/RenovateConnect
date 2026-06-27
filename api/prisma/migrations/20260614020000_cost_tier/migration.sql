-- Contractor price level (cost tier) derived from portfolio project cost ranges.
CREATE TYPE "CostTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

ALTER TABLE "Business" ADD COLUMN "costTier" "CostTier";
ALTER TABLE "Business" ADD COLUMN "typicalCostLow" INTEGER;
ALTER TABLE "Business" ADD COLUMN "typicalCostHigh" INTEGER;
ALTER TABLE "Business" ADD COLUMN "costSamples" INTEGER NOT NULL DEFAULT 0;
