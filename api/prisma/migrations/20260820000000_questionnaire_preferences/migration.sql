-- Add onboarding questionnaire fields to User.
-- questionnaireCompleted: gates the "show wizard on next open" flag.
-- questionnairePreferences: raw JSON answers keyed by question id,
--   used by the search scoring layer and AI chat personalisation.

ALTER TABLE "User"
  ADD COLUMN "questionnaireCompleted"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "questionnairePreferences" JSONB;
