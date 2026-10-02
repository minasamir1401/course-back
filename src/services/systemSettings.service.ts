import prisma from '../lib/prisma';

export async function isContentDeletionAllowed(): Promise<boolean> {
  // Always use the authoritative value, including across server workers.
  if ((prisma as any).systemSetting?.findUnique) {
    const setting = await (prisma as any).systemSetting.findUnique({
      where: { key: 'allow_content_deletion' }
    });
    return setting?.value === 'true';
  } else {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "value" FROM "SystemSetting" WHERE "key" = 'allow_content_deletion' LIMIT 1`
    );
    return rows.length > 0 && rows[0].value === 'true';
  }
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

  return allowed;
}
