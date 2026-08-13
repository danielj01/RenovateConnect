-- Waitlist confirmation email.
--
-- POST /waitlist is idempotent on email (re-submitting updates the row), so a
-- "did we already welcome this person?" flag has to live on the row rather than
-- being inferred from the insert. Stamped after SendGrid accepts the message,
-- which makes the send exactly-once across retries and re-submits.
--
-- Existing rows are left NULL deliberately: anyone who signed up before this
-- shipped never got a confirmation, so they should get one on their next touch
-- rather than being silently marked as handled.

ALTER TABLE "WaitlistEntry" ADD COLUMN "welcomeSentAt" TIMESTAMP(3);
