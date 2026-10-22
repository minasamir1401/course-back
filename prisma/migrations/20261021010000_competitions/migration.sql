BEGIN;
-- CreateTable
CREATE TABLE "CompetitionPolicy" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "publicBoard" BOOLEAN NOT NULL DEFAULT false,
    "sound" BOOLEAN NOT NULL DEFAULT true,
    "motion" BOOLEAN NOT NULL DEFAULT true,
    "leaderboard" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CompetitionPolicy_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CompetitionProfile" (
    "userId" TEXT NOT NULL,
    "sound" BOOLEAN NOT NULL DEFAULT true,
    "motion" BOOLEAN NOT NULL DEFAULT true,
    "publicName" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CompetitionProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleEn" TEXT,
    "description" TEXT,
    "schoolId" TEXT,
    "creatorId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SELF_PACED',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "grade" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'GENERAL',
    "sourceId" TEXT,
    "teams" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER NOT NULL DEFAULT 200,
    "publicBoard" BOOLEAN NOT NULL DEFAULT false,
    "prizeLabel" TEXT,
    "prizePlaces" INTEGER NOT NULL DEFAULT 3,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "currentIndex" INTEGER NOT NULL DEFAULT -1,
    "questionStartedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionQuestion" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textEn" TEXT,
    "options" JSONB NOT NULL,
    "optionsEn" JSONB,
    "correctIndex" INTEGER NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 30,
    "order" INTEGER NOT NULL,

    CONSTRAINT "CompetitionQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "team" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "correct" INTEGER NOT NULL DEFAULT 0,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "questionStartedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionAnswer" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedIndex" INTEGER,
    "correct" BOOLEAN NOT NULL,
    "points" INTEGER NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionAward" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Competition_schoolId_status_idx" ON "Competition"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Competition_sourceKind_sourceId_idx" ON "Competition"("sourceKind", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionQuestion_competitionId_order_key" ON "CompetitionQuestion"("competitionId", "order");

-- CreateIndex
CREATE INDEX "CompetitionEntry_competitionId_score_idx" ON "CompetitionEntry"("competitionId", "score");

-- CreateIndex
CREATE INDEX "CompetitionEntry_studentId_finishedAt_idx" ON "CompetitionEntry"("studentId", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionEntry_competitionId_studentId_key" ON "CompetitionEntry"("competitionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionAnswer_entryId_questionId_key" ON "CompetitionAnswer"("entryId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionAward_entryId_key" ON "CompetitionAward"("entryId");

-- AddForeignKey
ALTER TABLE "CompetitionProfile" ADD CONSTRAINT "CompetitionProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionQuestion" ADD CONSTRAINT "CompetitionQuestion_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionAnswer" ADD CONSTRAINT "CompetitionAnswer_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionAnswer" ADD CONSTRAINT "CompetitionAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CompetitionQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionAward" ADD CONSTRAINT "CompetitionAward_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
