ALTER TABLE "AiProvider" ADD COLUMN "parentId" TEXT;
CREATE INDEX "AiProvider_parentId_idx" ON "AiProvider"("parentId");
ALTER TABLE "AiProvider" ADD CONSTRAINT "AiProvider_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "AiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
