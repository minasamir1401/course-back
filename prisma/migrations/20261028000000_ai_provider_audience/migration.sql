-- Existing connections keep their previous student access and public opt-in.
ALTER TABLE "AiProvider" ADD COLUMN "allowStudent" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AiProvider" ADD CONSTRAINT "AiProvider_audience_check"
  CHECK ("allowPublic" OR "allowStudent");
