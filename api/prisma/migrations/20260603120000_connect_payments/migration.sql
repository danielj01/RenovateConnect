-- In-app deposit payments via Stripe Connect.
--
-- Adds the connected-account/payout state to Business and a Payment table that
-- records each deposit a homeowner pays when accepting a quote. All new columns
-- are nullable or default false, and Payment is a new table, so existing rows
-- are unaffected — no backfill required.

-- Payment lifecycle.
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- Stripe Connect fields on Business.
ALTER TABLE "Business"
  ADD COLUMN "stripeAccountId" TEXT,
  ADD COLUMN "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Deposit payments.
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "quoteRequestId" TEXT,
  "clientId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "commissionCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "stripePaymentIntentId" TEXT,
  "description" TEXT,
  "paidAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_quoteRequestId_key" ON "Payment"("quoteRequestId");
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");
CREATE INDEX "Payment_businessId_idx" ON "Payment"("businessId");
CREATE INDEX "Payment_clientId_idx" ON "Payment"("clientId");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId")
    REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId")
    REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
