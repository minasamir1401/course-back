-- Additive migration: legacy scores stay unchanged and are explicitly labelled as legacy.
ALTER TABLE "ExamSubmission" ADD COLUMN "reportSnapshot" JSONB;
ALTER TABLE "ExamSubmission" ADD COLUMN "schoolIdAtSubmission" TEXT;
ALTER TABLE "ExamSubmission" ADD COLUMN "gradeAtSubmission" TEXT;
ALTER TABLE "StudentAnswer" ADD COLUMN "questionSnapshot" JSONB;
CREATE INDEX "ExamSubmission_schoolIdAtSubmission_createdAt_idx" ON "ExamSubmission"("schoolIdAtSubmission", "createdAt");
ALTER TABLE "LessonProgress" ADD COLUMN "activeStudySeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LessonProgress" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
CREATE TABLE "Message" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recipientId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3)
);
CREATE INDEX "Message_recipientId_createdAt_idx" ON "Message"("recipientId", "createdAt");
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");
