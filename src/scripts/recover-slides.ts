import prisma from '../lib/prisma';
import { Pool } from 'pg';

export async function autoRecoverMissingSlides() {
  console.log('\n🤖 [Auto-Recover-Slides] Checking for lessons with missing slides...');
  try {
    // 1. Fetch all active lessons
    const activeLessons = await prisma.lesson.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true, slides: true, course: { select: { title: true } } }
    });

    // 2. Fetch recent cloud backups IDs (up to 100)
    const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
    const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 1, connectionTimeoutMillis: 8000 });
    let backupRecords: any[] = [];

    try {
      const result = await cloudPool.query('SELECT id, created_at FROM cloud_backups ORDER BY created_at DESC LIMIT 100');
      backupRecords = result.rows;
    } catch (e: any) {
      console.error('🤖 [Auto-Recover-Slides] Failed to fetch backup list:', e.message);
      await cloudPool.end().catch(() => {});
      return;
    }

    if (backupRecords.length === 0) {
      console.warn('🤖 [Auto-Recover-Slides] No cloud backups found. Cannot recover.');
      await cloudPool.end().catch(() => {});
      return;
    }

    console.log(`🤖 [Auto-Recover-Slides] Found ${backupRecords.length} backups to scan. Processing one by one...`);

    let recoveredCount = 0;
    const lessonsToRecover = activeLessons.map(l => {
      let currentLength = 0;
      if (Array.isArray(l.slides)) {
        currentLength = l.slides.length;
      } else if (typeof l.slides === 'string') {
        try {
          const parsed = JSON.parse(l.slides);
          if (Array.isArray(parsed)) currentLength = parsed.length;
        } catch {}
      }
      return { ...l, currentLength, bestSlides: null as any, maxLengthFound: currentLength, bestDate: null as string | null };
    });

    // 3. Search through backups one by one
    try {
      for (const record of backupRecords) {
        // console.log(`   - Scanning backup from ${record.created_at}...`);
        const dataResult = await cloudPool.query('SELECT data FROM cloud_backups WHERE id = $1', [record.id]);
        if (dataResult.rows.length === 0) continue;
        
        const backupData = dataResult.rows[0].data;
        const backupObj = backupData?.data || backupData;
        const backupLessons: any[] = Array.isArray(backupObj?.lesson) ? backupObj.lesson : [];

        for (const l of lessonsToRecover) {
          const backupLesson = backupLessons.find(bl => bl.id === l.id);
          if (backupLesson && backupLesson.slides) {
            let parsedSlides = backupLesson.slides;
            if (typeof backupLesson.slides === 'string') {
              try { parsedSlides = JSON.parse(backupLesson.slides); } catch {}
            }
            
            if (Array.isArray(parsedSlides)) {
              if (parsedSlides.length > l.maxLengthFound) {
                l.maxLengthFound = parsedSlides.length;
                l.bestSlides = parsedSlides;
                l.bestDate = record.created_at;
              }
            }
          }
        }
      }
    } finally {
      await cloudPool.end().catch(() => {});
    }

    // 4. Restore the best found slides
    for (const l of lessonsToRecover) {
      if (l.bestSlides && l.maxLengthFound > l.currentLength) {
        console.log(`🤖 [Auto-Recover-Slides] Restoring "${l.title}" (${l.course?.title}): Current slides = ${l.currentLength}, Found = ${l.maxLengthFound} in backup from ${l.bestDate}`);
        await prisma.lesson.update({
          where: { id: l.id },
          data: { slides: l.bestSlides }
        });
        recoveredCount++;
      }
    }

    console.log(`🤖 [Auto-Recover-Slides] Completed! Recovered slides for ${recoveredCount} lessons.\n`);

  } catch (error: any) {
    console.error('🤖 [Auto-Recover-Slides] Error:', error.message);
  }
}
