-- Watermark for the favorites "what's new" digest.
ALTER TABLE "User" ADD COLUMN "favoritesDigestSeenAt" TIMESTAMP(3);
