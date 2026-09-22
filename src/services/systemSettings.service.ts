import prisma from '../lib/prisma';

let cachedDeletionAllowed: boolean | null = null;
let cacheExpiry = 0;
const CACHE_DURATION_MS = 15_000;

export async function isContentDeletionAllowed(): Promise<boolean> {
  const now = Date.now();
  if (cachedDeletionAllowed !== null && now < cacheExpiry) {
    return cachedDeletionAllowed;
  }

  try {
    if ((prisma as any).systemSetting?.findUnique) {
      const setting = await (prisma as any).systemSetting.findUnique({
        where: { key: 'allow_content_deletion' }
      });
      cachedDeletionAllowed = setting ? setting.value === 'true' : false;
    } else {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "value" FROM "SystemSetting" WHERE "key" = 'allow_content_deletion' LIMIT 1`
      );
      cachedDeletionAllowed = rows.length > 0 ? rows[0].value === 'true' : false;
    }
  } catch {
    cachedDeletionAllowed = false;
  }

  cacheExpiry = now + CACHE_DURATION_MS;
  return cachedDeletionAllowed;
}

export async function setContentDeletionAllowed(allowed: boolean): Promise<boolean> {
  const stringValue = allowed ? 'true' : 'false';
  if ((prisma as any).systemSetting?.upsert) {
    await (prisma as any).systemSetting.upsert({
      where: { key: 'allow_content_deletion' },
      update: { value: stringValue },
      create: { key: 'allow_content_deletion', value: stringValue }
    });
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
       VALUES ('allow_content_deletion', $1, CURRENT_TIMESTAMP)
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP`,
      stringValue
    );
  }

  cachedDeletionAllowed = allowed;
  cacheExpiry = Date.now() + CACHE_DURATION_MS;
  return allowed;
}
