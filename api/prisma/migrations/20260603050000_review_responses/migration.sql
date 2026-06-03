-- Public business reply to a review (one per review).
ALTER TABLE "Review" ADD COLUMN "response" TEXT;
ALTER TABLE "Review" ADD COLUMN "respondedAt" TIMESTAMP(3);
