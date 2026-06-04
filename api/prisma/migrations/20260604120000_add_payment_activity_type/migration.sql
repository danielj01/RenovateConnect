-- Add PAYMENT to the ActivityType enum so deposit-refund events can post a
-- durable homeowner feed entry (alongside the push notification).
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'PAYMENT';
