-- Saved payment-method display details for off-session lead/subscription billing.
-- We store only the brand and last4 for UI; the card itself lives in Stripe.
ALTER TABLE "Business" ADD COLUMN "cardBrand" TEXT;
ALTER TABLE "Business" ADD COLUMN "cardLast4" TEXT;
