-- Additive only: preserve all existing competition questions, answers and scores.
ALTER TABLE "Competition" ADD COLUMN IF NOT EXISTS "subject" TEXT;
ALTER TABLE "Competition" ADD COLUMN IF NOT EXISTS "scoringMode" TEXT NOT NULL DEFAULT 'SPEED';
ALTER TABLE "CompetitionQuestion" ALTER COLUMN "correctIndex" SET DEFAULT -1;
ALTER TABLE "CompetitionQuestion" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'MCQ';
ALTER TABLE "CompetitionQuestion" ADD COLUMN IF NOT EXISTS "points" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "CompetitionQuestion" ADD COLUMN IF NOT EXISTS "correctAnswer" JSONB;
ALTER TABLE "CompetitionQuestion" ADD COLUMN IF NOT EXISTS "correctAnswerEn" JSONB;
ALTER TABLE "CompetitionQuestion" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "CompetitionAnswer" ADD COLUMN IF NOT EXISTS "answer" JSONB;
