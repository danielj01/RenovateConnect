-- AlterTable
ALTER TABLE "Business" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Business" ADD COLUMN "proSubscriptionId" TEXT;
ALTER TABLE "Business" ADD COLUMN "proStatus" TEXT;
ALTER TABLE "Business" ADD COLUMN "proTrialEndsAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "proCurrentPeriodEnd" TIMESTAMP(3);
