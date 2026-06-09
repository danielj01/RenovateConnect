-- Contractor verification documents: license PDF + insurance cert + optional ID.

CREATE TYPE "VerificationDocType" AS ENUM ('LICENSE', 'INSURANCE', 'IDENTITY');
CREATE TYPE "VerificationDocStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "VerificationDocument" (
  "id"              TEXT NOT NULL,
  "businessId"      TEXT NOT NULL,
  "type"            "VerificationDocType" NOT NULL,
  "fileUrl"         TEXT NOT NULL,
  "documentNumber"  TEXT,
  "issuer"          TEXT,
  "expiresAt"       TIMESTAMP(3),
  "status"          "VerificationDocStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "reviewedById"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VerificationDocument_businessId_idx"        ON "VerificationDocument"("businessId");
CREATE INDEX "VerificationDocument_status_createdAt_idx"  ON "VerificationDocument"("status", "createdAt");
CREATE INDEX "VerificationDocument_expiresAt_idx"         ON "VerificationDocument"("expiresAt");

ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
