-- Milestone disputes: homeowner can pause auto-release and request admin review.

ALTER TYPE "MilestoneStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';

CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED_RELEASE', 'RESOLVED_REFUND', 'WITHDRAWN');
CREATE TYPE "DisputeReason" AS ENUM (
  'WORK_NOT_DONE', 'WORK_INCOMPLETE', 'WORK_LOW_QUALITY', 'NOT_AS_AGREED',
  'DAMAGE', 'WRONG_AMOUNT', 'OTHER'
);

ALTER TABLE "Milestone" ADD COLUMN "preDisputeStatus" "MilestoneStatus";

CREATE TABLE "Dispute" (
  "id"             TEXT NOT NULL,
  "milestoneId"    TEXT NOT NULL,
  "raisedById"     TEXT NOT NULL,
  "reason"         "DisputeReason" NOT NULL,
  "details"        TEXT NOT NULL,
  "status"         "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedById"   TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dispute_milestoneId_idx"        ON "Dispute"("milestoneId");
CREATE INDEX "Dispute_status_createdAt_idx"   ON "Dispute"("status", "createdAt");
CREATE INDEX "Dispute_raisedById_idx"         ON "Dispute"("raisedById");

ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
