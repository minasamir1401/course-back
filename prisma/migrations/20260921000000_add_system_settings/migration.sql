-- CreateTable
CREATE TABLE IF NOT EXISTS "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- Insert default deletion policy (disabled by default)
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
VALUES ('allow_content_deletion', 'false', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
