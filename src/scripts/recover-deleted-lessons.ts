/**
 * ============================================================
 * 🛟 RECOVER-DELETED-LESSONS — Startup Auto-Recovery Script
 * ============================================================
 * Runs automatically at every Dokploy deployment (npm start).
 * Scans ALL local backup files + Cloud Backup DB and restores
 * any lessons that are missing from the active PostgreSQL DB.
 *
 * Strategy:
 *  1. Load all lessons currently in the active DB.
 *  2. Load all courses currently in the active DB.
 *  3. Scan every local backup file in /app/uploads/backups and /app.
 *  4. Scan the cloud backup DB for REALTIME_SYNC records.
 *  5. For each lesson found in backups that is NOT in the active DB,
 *     insert it back (upsert by ID). Never overwrites existing data.
 *  6. For each course found in backups that has 0 lessons in active DB
 *     but has lessons in backup, restore those lessons.
 *  7. Print a full recovery report.
 * ============================================================
 */

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;

const cloudPool = new Pool({
  connectionString: BACKUP_DB_URL,
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function safeDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseSafe(value: any): any {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

/** Scan all local backup files and return a merged list of lessons */
async function collectLessonsFromLocalBackups(): Promise<{ lessons: any[]; courses: any[] }> {
  const searchDirs = [
    process.cwd(),
    path.join(process.cwd(), 'uploads', 'backups'),
    '/app',
    '/app/uploads/backups',
  ];

  const seenFiles = new Set<string>();
  const allBackupFiles: string[] = [];

  for (const dir of searchDirs) {
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        if (
          file.startsWith('backup-') ||
          file.startsWith('backup_') ||
          file === 'recovery.json' ||
          file === 'courses_dump.json'
        ) {
          const fullPath = path.join(dir, file);
          if (!seenFiles.has(fullPath)) {
            seenFiles.add(fullPath);
            allBackupFiles.push(fullPath);
          }
        }
      }
    } catch {
      // skip inaccessible directories
    }
  }

  console.log(`🗂️  [Recovery] Found ${allBackupFiles.length} local backup file(s) to scan.`);

  // Sort newest first by mtime so we always prefer the most recent data
  const withStats = allBackupFiles.map(f => ({
    path: f,
    mtime: (() => { try { return fs.statSync(f).mtime.getTime(); } catch { return 0; } })()
  })).sort((a, b) => b.mtime - a.mtime);

  const mergedLessons = new Map<string, any>(); // id → lesson (newest wins)
  const mergedCourses = new Map<string, any>(); // id → course (newest wins)

  for (const { path: filePath } of withStats) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const data = parsed.data || parsed;

      const lessons: any[] = Array.isArray(data.lesson) ? data.lesson : [];
      const courses: any[] = Array.isArray(data.course) ? data.course : [];

      for (const c of courses) {
        if (c?.id && !mergedCourses.has(c.id)) {
          mergedCourses.set(c.id, c);
        }
      }

      for (const l of lessons) {
        if (l?.id && !mergedLessons.has(l.id)) {
          mergedLessons.set(l.id, l);
        }
      }
    } catch {
      // skip malformed files silently
    }
  }

  return {
    lessons: Array.from(mergedLessons.values()),
    courses: Array.from(mergedCourses.values()),
  };
}

/** Scan cloud backup DB for the most recent REALTIME_SYNC records */
async function collectLessonsFromCloudBackups(): Promise<{ lessons: any[]; courses: any[] }> {
  const mergedLessons = new Map<string, any>();
  const mergedCourses = new Map<string, any>();

  try {
    const result = await cloudPool.query(`
      SELECT data, created_at
      FROM cloud_backups
      WHERE type IN ('REALTIME_SYNC', 'AUTO_HOURLY', 'MANUAL')
      ORDER BY created_at DESC
      LIMIT 20;
    `);

    console.log(`☁️  [Recovery] Found ${result.rows.length} cloud backup record(s) to scan.`);

    for (const row of result.rows) {
      try {
        const payload = row.data;
        const data = payload?.data || payload;

        const courses: any[] = Array.isArray(data?.course) ? data.course : [];
        const lessons: any[] = Array.isArray(data?.lesson) ? data.lesson : [];

        for (const c of courses) {
          if (c?.id && !mergedCourses.has(c.id)) {
            mergedCourses.set(c.id, c);
            // Also extract lessons embedded in course records (REALTIME_SYNC format)
            if (Array.isArray(c.lessons)) {
              for (const l of c.lessons) {
                if (l?.id && !mergedLessons.has(l.id)) {
                  mergedLessons.set(l.id, { ...l, courseId: l.courseId || c.id });
                }
              }
            }
          }
        }

        for (const l of lessons) {
          if (l?.id && !mergedLessons.has(l.id)) {
            mergedLessons.set(l.id, l);
          }
        }
      } catch {
        // skip malformed cloud record
      }
    }
  } catch (err: any) {
    console.warn(`⚠️  [Recovery] Could not reach cloud backup DB: ${err.message} — will rely on local backups only.`);
  }

  return {
    lessons: Array.from(mergedLessons.values()),
    courses: Array.from(mergedCourses.values()),
  };
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🛟  ==========================================');
  console.log('🛟  [Recover-Deleted-Lessons] Starting...');
  console.log('🛟  ==========================================\n');

  // 1. Load active DB state
  const [activeLessons, activeCourses] = await Promise.all([
    prisma.lesson.findMany({ select: { id: true, courseId: true, title: true } }),
    prisma.course.findMany({ select: { id: true, title: true, _count: { select: { lessons: true } } } }),
  ]);

  const activeLessonIds = new Set(activeLessons.map(l => l.id));
  const activeCourseIds = new Set(activeCourses.map(c => c.id));
  const courseToLessonCount = new Map(activeCourses.map(c => [c.id, c._count.lessons]));

  console.log(`📊  [Recovery] Active DB: ${activeCourses.length} courses, ${activeLessons.length} lessons.`);

  // 2. Collect from all backup sources (local + cloud) in parallel
  const [local, cloud] = await Promise.all([
    collectLessonsFromLocalBackups(),
    collectLessonsFromCloudBackups(),
  ]);

  // Merge: local takes priority (newer files sorted first already), cloud fills gaps
  const allBackupLessons = new Map<string, any>();
  const allBackupCourses = new Map<string, any>();

  for (const c of [...cloud.courses, ...local.courses]) {
    if (c?.id && !allBackupCourses.has(c.id)) allBackupCourses.set(c.id, c);
  }
  for (const l of [...cloud.lessons, ...local.lessons]) {
    if (l?.id && !allBackupLessons.has(l.id)) allBackupLessons.set(l.id, l);
  }

  console.log(`📦  [Recovery] Total unique backup pool: ${allBackupCourses.size} courses, ${allBackupLessons.size} lessons.\n`);

  const { isLessonDeleted, isCourseDeleted } = await import('../lib/tombstones');

  let restoredLessons = 0;
  let restoredCourses = 0;
  let skippedLessons = 0;

  // 3. Restore missing courses first (so we can attach lessons to them)
  for (const [courseId, backupCourse] of allBackupCourses) {
    if (activeCourseIds.has(courseId)) continue;
    if (!backupCourse?.id || !backupCourse?.title) continue;

    // 🔒 Skip courses explicitly deleted by user
    if (await isCourseDeleted(courseId)) {
      console.log(`🔒  [Recovery] Skipping course "${backupCourse.title}" (${courseId}) — marked as EXPLICITLY DELETED by user.`);
      continue;
    }

    try {
      await prisma.course.create({
        data: {
          id: backupCourse.id,
          title: backupCourse.title,
          description: backupCourse.description ?? null,
          coverImage: backupCourse.coverImage ?? null,
          grade: backupCourse.grade ?? null,
          grades: backupCourse.grades ?? null,
          subject: backupCourse.subject ?? null,
          country: backupCourse.country || 'مصر',
          isCentral: backupCourse.isCentral ?? false,
          schoolId: backupCourse.schoolId ?? null,
          createdAt: safeDate(backupCourse.createdAt) ?? new Date(),
          updatedAt: safeDate(backupCourse.updatedAt) ?? new Date(),
        }
      });
      activeCourseIds.add(courseId);
      courseToLessonCount.set(courseId, 0);
      restoredCourses++;
      console.log(`✅  [Recovery] Restored missing course: "${backupCourse.title}" (${courseId})`);
    } catch (err: any) {
      console.warn(`⚠️  [Recovery] Could not restore course "${backupCourse.title}": ${err.message}`);
    }
  }

  // 4. Restore missing lessons
  const lessonsToRestore = Array.from(allBackupLessons.values()).filter(
    l => l?.id && !activeLessonIds.has(l.id)
  );

  console.log(`🔍  [Recovery] Found ${lessonsToRestore.length} lesson(s) to check for restoration.\n`);

  for (const lesson of lessonsToRestore) {
    if (!lesson?.id || !lesson?.courseId) {
      skippedLessons++;
      continue;
    }

    // 🔒 Skip lessons explicitly deleted by user
    if (await isLessonDeleted(lesson.id)) {
      console.log(`🔒  [Recovery] Skipping lesson "${lesson.title}" (${lesson.id}) — marked as EXPLICITLY DELETED by user.`);
      skippedLessons++;
      continue;
    }

    // Parent course must exist in DB
    if (!activeCourseIds.has(lesson.courseId)) {
      console.warn(`⚠️  [Recovery] Skipping lesson "${lesson.title}" — parent course ${lesson.courseId} not in DB.`);
      skippedLessons++;
      continue;
    }

    try {
      await prisma.lesson.create({
        data: {
          id: lesson.id,
          courseId: lesson.courseId,
          title: lesson.title || 'Untitled Lesson',
          domain: lesson.domain ?? null,
          content: lesson.content ?? null,
          videoUrl: lesson.videoUrl ?? null,
          duration: lesson.duration ?? 0,
          summary: lesson.summary ?? null,
          notes: lesson.notes ?? null,
          questions: parseSafe(lesson.questions) ?? null,
          assignments: parseSafe(lesson.assignments) ?? null,
          attachments: parseSafe(lesson.attachments) ?? null,
          slides: parseSafe(lesson.slides) ?? null,
          standards: lesson.standards ?? null,
          indicators: lesson.indicators ?? null,
          learningOutcomes: lesson.learningOutcomes ?? null,
          isCentral: lesson.isCentral ?? false,
          isVisible: lesson.isVisible !== undefined ? !!lesson.isVisible : true,
          publishDate: safeDate(lesson.publishDate),
          cutOffDate: safeDate(lesson.cutOffDate),
          order: lesson.order ?? 0,
          createdAt: safeDate(lesson.createdAt) ?? new Date(),
          updatedAt: safeDate(lesson.updatedAt) ?? new Date(),
        }
      });

      restoredLessons++;
      const currentCount = courseToLessonCount.get(lesson.courseId) || 0;
      courseToLessonCount.set(lesson.courseId, currentCount + 1);
      console.log(`✅  [Recovery] Restored lesson: "${lesson.title}" → course ${lesson.courseId}`);
    } catch (err: any) {
      if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
        skippedLessons++;
        // Already exists (race condition) — safe to skip
      } else {
        console.warn(`⚠️  [Recovery] Failed to restore "${lesson.title}" (${lesson.id}): ${err.message}`);
        skippedLessons++;
      }
    }
  }

  // 5. Final report
  console.log('\n🛟  ==========================================');
  console.log(`🛟  [Recovery] COMPLETE`);
  console.log(`   ✅  Courses restored : ${restoredCourses}`);
  console.log(`   ✅  Lessons restored : ${restoredLessons}`);
  console.log(`   ⏭️   Lessons skipped  : ${skippedLessons}`);
  console.log('🛟  ==========================================\n');
}

main()
  .catch(err => {
    console.error('❌  [Recovery] Critical error:', err);
    // Do NOT exit(1) — a recovery failure must never block server startup
  })
  .finally(async () => {
    await prisma.$disconnect();
    try { await cloudPool.end(); } catch { /* ignore */ }
  });
