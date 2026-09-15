-- Native Inspiration posts: contractors publish slideshow posts straight to the
-- Inspiration feed instead of the feed only reflecting PortfolioProject photos.
-- Same PENDING-by-default admin gate as PortfolioProject.

CREATE TABLE "InspirationPost" (
  "id"              TEXT NOT NULL,
  "businessId"      TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "caption"         TEXT,
  "category"        TEXT,
  "costMin"         INTEGER,
  "costMax"         INTEGER,
  "imageUrls"       TEXT[],
  "beforeImageUrls" TEXT[],
  "featured"        BOOLEAN NOT NULL DEFAULT false,
  "approvalStatus"  "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InspirationPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InspirationPost_businessId_idx" ON "InspirationPost"("businessId");
CREATE INDEX "InspirationPost_approvalStatus_createdAt_idx" ON "InspirationPost"("approvalStatus", "createdAt");

ALTER TABLE "InspirationPost"
  ADD CONSTRAINT "InspirationPost_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
