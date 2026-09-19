-- Safely add foreign key on ExamModule(parentModuleId) if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ExamModule_parentModuleId_fkey'
  ) THEN
    ALTER TABLE "ExamModule" ADD CONSTRAINT "ExamModule_parentModuleId_fkey"
      FOREIGN KEY ("parentModuleId") REFERENCES "ExamModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Safely sync indexes for ExamModule and SubExam
CREATE INDEX IF NOT EXISTS "ExamModule_examId_order_idx" ON "ExamModule"("examId", "order");
CREATE INDEX IF NOT EXISTS "ExamModule_parentModuleId_idx" ON "ExamModule"("parentModuleId");
DROP INDEX IF EXISTS "ExamModule_examId_idx";

CREATE INDEX IF NOT EXISTS "SubExam_moduleId_order_idx" ON "SubExam"("moduleId", "order");
DROP INDEX IF EXISTS "SubExam_moduleId_idx";
