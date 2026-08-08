-- Private storage for contractor verification documents.
--
-- These uploads include license, insurance, and government-ID scans. They were
-- written to the public S3 prefix and stored as durable public URLs, so anyone
-- holding (or guessing) the link could read someone's ID. New uploads go under
-- a `private/` prefix and are served as short-lived presigned URLs generated at
-- read time; only the object key is persisted.
--
-- Existing rows keep their `fileUrl` and are left readable so the admin queue
-- doesn't break mid-review. Those legacy objects should be migrated into the
-- private prefix (or deleted, if the documents have already been reviewed) as a
-- follow-up — the column stays nullable so both shapes coexist meanwhile.

ALTER TABLE "VerificationDocument" ADD COLUMN "storageKey" TEXT;
