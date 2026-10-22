ALTER TABLE "CompetitionQuestion" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompetitionEntry" ADD COLUMN IF NOT EXISTS "questionSnapshot" JSONB;

-- Keep the exact question set used by existing attempts before published edits.
UPDATE "CompetitionEntry" e
SET "questionSnapshot" = COALESCE((
  SELECT jsonb_agg(to_jsonb(q) ORDER BY q."order")
  FROM "CompetitionQuestion" q
  WHERE q."competitionId" = e."competitionId"
), '[]'::jsonb)
WHERE e."questionSnapshot" IS NULL;
