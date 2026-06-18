-- Pre-launch email capture (waitlist).
CREATE TYPE "WaitlistRole" AS ENUM ('HOMEOWNER', 'CONTRACTOR');

CREATE TABLE "WaitlistEntry" (
  "id"         TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "role"       "WaitlistRole" NOT NULL DEFAULT 'HOMEOWNER',
  "city"       TEXT,
  "source"     TEXT,
  "context"    TEXT,
  "notifiedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");
CREATE INDEX "WaitlistEntry_role_createdAt_idx" ON "WaitlistEntry"("role", "createdAt");
