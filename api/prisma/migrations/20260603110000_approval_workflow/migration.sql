-- Admin approval workflow for business listings and portfolio projects.
-- New rows default to PENDING; existing rows are backfilled to APPROVED so
-- already-live data isn't suddenly hidden from search.

CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Business"
  ADD COLUMN "approvalStatus"  "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "reviewedAt"      TIMESTAMP(3);

ALTER TABLE "PortfolioProject"
  ADD COLUMN "approvalStatus"  "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "reviewedAt"      TIMESTAMP(3);

-- Backfill existing data as APPROVED with a reviewedAt stamp so it stays live.
UPDATE "Business"
   SET "approvalStatus" = 'APPROVED', "reviewedAt" = NOW();

UPDATE "PortfolioProject"
   SET "approvalStatus" = 'APPROVED', "reviewedAt" = NOW();
