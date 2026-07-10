-- Email verification + password recovery.
--
-- `emailVerified` gates password login (an unverified password account can't be
-- used, which stops an attacker pre-registering someone else's address). Social
-- accounts are created already-verified.

ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailVerifyCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifyExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passwordResetCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);

-- Grandfather every existing account as verified: they predate the requirement
-- and locking them out (or forcing a re-verify) would be a worse outcome than
-- the residual risk on already-owned addresses. New registrations must verify.
UPDATE "User" SET "emailVerified" = true;
