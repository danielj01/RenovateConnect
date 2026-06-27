-- Clickwrap record of Terms of Service acceptance (proof of assent for
-- arbitration / class-action-waiver enforceability).
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "termsVersion" TEXT;
