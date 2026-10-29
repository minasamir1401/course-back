CREATE TABLE "AiProvider" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "kind" TEXT NOT NULL, "baseUrl" TEXT NOT NULL,
 "model" TEXT NOT NULL DEFAULT 'openai/gpt-oss-120b',
 "encryptedKey" TEXT NOT NULL, "keyFingerprint" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "allowPublic" BOOLEAN NOT NULL DEFAULT false,
 "lastAssignedAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01', "cooldownUntil" TIMESTAMP(3),
 "requestCount" INTEGER NOT NULL DEFAULT 0, "failureCount" INTEGER NOT NULL DEFAULT 0,
 "lastStatus" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AiProvider_keyFingerprint_key" ON "AiProvider"("keyFingerprint");
CREATE INDEX "AiProvider_enabled_lastAssignedAt_idx" ON "AiProvider"("enabled", "lastAssignedAt");
CREATE TABLE "AiConversation" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "lessonId" TEXT, "title" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AiConversation_userId_updatedAt_idx" ON "AiConversation"("userId", "updatedAt");
CREATE TABLE "AiMessage" (
 "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "role" TEXT NOT NULL, "content" TEXT NOT NULL, "model" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");
CREATE TABLE "StudentAiInsight" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "evidence" JSONB NOT NULL, "narrative" TEXT, "fingerprint" TEXT NOT NULL, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AiLessonGuidance" (
 "lessonId" TEXT PRIMARY KEY REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "instructions" TEXT NOT NULL DEFAULT '', "referenceText" TEXT NOT NULL DEFAULT '',
 "starterPrompts" JSONB, "updatedAt" TIMESTAMP(3) NOT NULL
);
