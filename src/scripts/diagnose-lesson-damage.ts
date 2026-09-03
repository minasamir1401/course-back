/**
 * diagnose-lesson-damage.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY diagnostic script.
 * Does NOT modify the database — outputs a JSON report only.
 *
 * Purpose: Detect lessons/courses/exams that may have been incorrectly
 *          soft-deleted by the automatic runGlobalDeduplication() logic.
 *
 * Run manually:
 *   npx tsx src/scripts/diagnose-lesson-damage.ts
 *   npx tsx src/scripts/diagnose-lesson-damage.ts --json > report.json
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from '../lib/prisma';

interface SuspiciousLesson {
  id: string;
  title: string;
  courseId: string;
  courseTitle?: string;
  schoolId?: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  examCount: number;
  progressCount: number;
  orphanedQuestions: number;
  orphanedAssignments: number;
  orphanedAttachments: number;
  hasOrphanedRelationships: boolean;
}

interface TitleCollision {
  courseId: string;
  courseTitle?: string;
  normalizedTitle: string;
  lessons: { id: string; title: string; deletedAt: Date | null; createdAt: Date; updatedAt: Date }[];
}

interface RecentDeletion {
  id: string;
  title: string;
  type: 'lesson' | 'course' | 'exam';
  deletedAt: Date;
  courseId?: string;
  schoolId?: string;
}

async function runDiagnosis() {
  console.log('\n🔍 [Diagnostic] Starting read-only database diagnosis...\n');

  // ── 1. Count all soft-deleted records ──────────────────────────────────────
  const [softDeletedLessons, softDeletedCourses, softDeletedExams] = await Promise.all([
    prisma.lesson.count({ where: { deletedAt: { not: null } } }),
    prisma.course.count({ where: { deletedAt: { not: null } } }),
    prisma.exam.count({ where: { deletedAt: { not: null } } }),
  ]);

  console.log(`📊 Soft-deleted: Lessons=${softDeletedLessons}, Courses=${softDeletedCourses}, Exams=${softDeletedExams}`);

  // ── 2. Find all lessons (active + deleted) for collision check ──────────────
  const allLessons = await prisma.lesson.findMany({
    select: {
      id: true, title: true, courseId: true,
      deletedAt: true, createdAt: true, updatedAt: true,
      questions: true, assignments: true, attachments: true,
      course: { select: { title: true, schoolId: true } },
    },
    orderBy: { courseId: 'asc' },
  });

  // ── 3. Detect title collisions ─────────────────────────────────────────────
  const collisionMap = new Map<string, typeof allLessons>();
  for (const l of allLessons) {
    const key = `${l.courseId}__${l.title.trim().toLowerCase()}`;
    if (!collisionMap.has(key)) collisionMap.set(key, []);
    collisionMap.get(key)!.push(l);
  }

  const titleCollisions: TitleCollision[] = [];
  const suspiciousLessons: SuspiciousLesson[] = [];

  for (const [key, group] of collisionMap.entries()) {
    if (group.length > 1) {
      const [courseId] = key.split('__');
      const hasDeletedMembers = group.some(l => l.deletedAt !== null);
      if (hasDeletedMembers) {
        titleCollisions.push({
          courseId,
          courseTitle: group[0].course?.title,
          normalizedTitle: group[0].title.trim().toLowerCase(),
          lessons: group.map(l => ({
            id: l.id, title: l.title, deletedAt: l.deletedAt,
            createdAt: l.createdAt, updatedAt: l.updatedAt,
            questions: l.questions, assignments: l.assignments, attachments: l.attachments
          })),
        });

        // Add deleted ones to suspicious list
        for (const l of group.filter(x => x.deletedAt !== null)) {
        // lessonId is not a direct FK on Exam in this schema — skip exam count
          const examCount = 0;

          // Check JSON fields for orphaned content
          const parseCount = (val: any) => {
            if (Array.isArray(val)) return val.length;
            if (typeof val === 'string') {
              try {
                const parsed = JSON.parse(val);
                if (Array.isArray(parsed)) return parsed.length;
              } catch (e) {}
            }
            return 0;
          };

          const qCount = parseCount(l.questions);
          const aCount = parseCount(l.assignments);
          const attCount = parseCount(l.attachments);

          suspiciousLessons.push({
            id: l.id, title: l.title, courseId,
            courseTitle: l.course?.title,
            schoolId: l.course?.schoolId ?? undefined,
            deletedAt: l.deletedAt,
            createdAt: l.createdAt, updatedAt: l.updatedAt,
            examCount,
            progressCount: 0,
            orphanedQuestions: qCount,
            orphanedAssignments: aCount,
            orphanedAttachments: attCount,
            hasOrphanedRelationships: examCount > 0 || qCount > 0 || aCount > 0 || attCount > 0,
          });
        }
      }
    }
  }

  // ── 4. Recent deletions (last 30 days) ─────────────────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [recentLessons, recentCourses, recentExams] = await Promise.all([
    prisma.lesson.findMany({
      where: { deletedAt: { gte: thirtyDaysAgo } },
      select: { id: true, title: true, courseId: true, deletedAt: true },
      orderBy: { deletedAt: 'desc' },
      take: 100,
    }),
    prisma.course.findMany({
      where: { deletedAt: { gte: thirtyDaysAgo } },
      select: { id: true, title: true, schoolId: true, deletedAt: true },
      orderBy: { deletedAt: 'desc' },
      take: 50,
    }),
    prisma.exam.findMany({
      where: { deletedAt: { gte: thirtyDaysAgo } },
      select: { id: true, title: true, courseId: true, schoolId: true, deletedAt: true },
      orderBy: { deletedAt: 'desc' },
      take: 50,
    }),
  ]);

  const recentDeletions: RecentDeletion[] = [
    ...recentLessons.map(l => ({ id: l.id, title: l.title, type: 'lesson' as const, deletedAt: l.deletedAt!, courseId: l.courseId })),
    ...recentCourses.map(c => ({ id: c.id, title: c.title, type: 'course' as const, deletedAt: c.deletedAt!, schoolId: c.schoolId ?? undefined })),
    ...recentExams.map(e => ({ id: e.id, title: e.title, type: 'exam' as const, deletedAt: e.deletedAt!, courseId: e.courseId ?? undefined, schoolId: e.schoolId ?? undefined })),
  ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      softDeletedLessons,
      softDeletedCourses,
      softDeletedExams,
      suspiciousDeletions: suspiciousLessons.length,
      titleCollisionGroups: titleCollisions.length,
      recentDeletions: recentDeletions.length,
    },
    suspiciousLessons,
    titleCollisions,
    recentDeletions,
  };

  return report;
}

// ─── ENTRY POINT GUARD ───────────────────────────────────────────────────────
// Run manually ONLY: npx tsx src/scripts/diagnose-lesson-damage.ts [--json]
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  runDiagnosis()
    .then(report => {
      const isJson = process.argv.includes('--json');
      if (isJson) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('\n═══════════════════════════════════════════════════════');
        console.log('📋 DIAGNOSTIC REPORT — READ ONLY — NO CHANGES MADE');
        console.log('═══════════════════════════════════════════════════════');
        console.log('\n📊 SUMMARY:');
        console.log(JSON.stringify(report.summary, null, 2));

        if (report.suspiciousLessons.length > 0) {
          console.log(`\n⚠️  ${report.suspiciousLessons.length} SUSPICIOUS DELETIONS (title collision + soft-deleted):`);
          for (const l of report.suspiciousLessons.slice(0, 20)) {
            console.log(`  • [${l.id}] "${l.title}" | Course: ${l.courseTitle ?? l.courseId} | Deleted: ${l.deletedAt}`);
            if (l.hasOrphanedRelationships) {
              console.log(`      ↳ Orphaned Content -> Q: ${l.orphanedQuestions} | A: ${l.orphanedAssignments} | Att: ${l.orphanedAttachments}`);
            }
          }
        } else {
          console.log('\n✅ No suspicious deletions from title collisions found.');
        }

        console.log(`\n📅 RECENT DELETIONS (last 30 days): ${report.recentDeletions.length} records`);
        for (const d of report.recentDeletions.slice(0, 10)) {
          console.log(`  • [${d.type.toUpperCase()}] "${d.title}" deleted at ${d.deletedAt}`);
        }

        console.log('\n═══════════════════════════════════════════════════════');
        console.log('ℹ️  Run with --json flag for full JSON output.');
        console.log('⚠️  NO DATA WAS MODIFIED. This is a read-only scan.');
        console.log('═══════════════════════════════════════════════════════\n');
      }
    })
    .catch(err => {
      console.error('❌ Diagnostic failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { runDiagnosis };
