/**
 * ================================================================
 * 🛟 RESTORE-FROM-LOCAL-BACKUP — Full Data Recovery Script
 * ================================================================
 * Reads ALL backup files from a given directory, merges them
 * (most-data wins), and restores every course + lesson with their
 * Quizzes, Assignments, Slides, and Attachments into the live DB.
 *
 * Usage:
 *   npx ts-node src/scripts/restore-from-local-backup.ts [backupDir]
 *
 * Example:
 *   npx ts-node src/scripts/restore-from-local-backup.ts "C:\Users\Administrator\Downloads\Compressed"
 * ================================================================
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────

function safeDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function parseSafe(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v; // already parsed (JSONB)
}

function countItems(v: any): number {
  const parsed = parseSafe(v);
  if (Array.isArray(parsed)) return parsed.length;
  return 0;
}

// Pick the value with MORE items (to preserve the richest data)
function pickRicher(existing: any, incoming: any): any {
  return countItems(incoming) >= countItems(existing) ? incoming : existing;
}

// ── Load & Merge all backup files ────────────────────────────────

function loadAndMergeBackups(backupDir: string): { courses: Map<string, any>; lessons: Map<string, any>; exams: Map<string, any> } {
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup directory not found: ${backupDir}`);
  }

  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      fullPath: path.join(backupDir, f),
      mtime: (() => { try { return fs.statSync(path.join(backupDir, f)).mtime.getTime(); } catch { return 0; } })()
    }))
    .sort((a, b) => b.mtime - a.mtime); // newest first

  console.log(`📂 Found ${files.length} backup files in: ${backupDir}`);

  const courses = new Map<string, any>();
  const lessons = new Map<string, any>();
  const exams = new Map<string, any>();

  for (const { name, fullPath } of files) {
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const data = parsed.data || parsed;

      const backupCourses: any[] = Array.isArray(data.course) ? data.course : [];
      const backupLessons: any[] = Array.isArray(data.lesson) ? data.lesson : [];
      const backupExams: any[] = Array.isArray(data.exam) ? data.exam : [];

      for (const c of backupCourses) {
        if (!c?.id || !c?.title) continue;
        if (!courses.has(c.id)) {
          courses.set(c.id, { ...c });
        }
        // Extract embedded lessons from REALTIME_SYNC format
        if (Array.isArray(c.lessons)) {
          for (const l of c.lessons) {
            if (!l?.id) continue;
            if (!lessons.has(l.id)) {
              lessons.set(l.id, { ...l, courseId: l.courseId || c.id });
            } else {
              // Merge — keep richer data
              const existing = lessons.get(l.id)!;
              lessons.set(l.id, {
                ...existing,
                slides: pickRicher(existing.slides, l.slides),
                questions: pickRicher(existing.questions, l.questions),
                assignments: pickRicher(existing.assignments, l.assignments),
                attachments: pickRicher(existing.attachments, l.attachments),
              });
            }
          }
        }
      }

      for (const l of backupLessons) {
        if (!l?.id) continue;
        if (!lessons.has(l.id)) {
          lessons.set(l.id, { ...l });
        } else {
          // Merge — keep richer data for each field
          const existing = lessons.get(l.id)!;
          lessons.set(l.id, {
            ...existing,
            slides: pickRicher(existing.slides, l.slides),
            questions: pickRicher(existing.questions, l.questions),
            assignments: pickRicher(existing.assignments, l.assignments),
            attachments: pickRicher(existing.attachments, l.attachments),
          });
        }
      }

      for (const e of backupExams) {
        if (!e?.id) continue;
        if (!exams.has(e.id)) {
          exams.set(e.id, { ...e });
        } else {
          const existing = exams.get(e.id)!;
          exams.set(e.id, {
            ...existing,
            questions: pickRicher(existing.questions, e.questions),
            schools: pickRicher(existing.schools, e.schools),
            grades: pickRicher(existing.grades, e.grades),
            subjects: pickRicher(existing.subjects, e.subjects)
          });
        }
      }

      process.stdout.write(`  ✓ ${name} — ${backupCourses.length} courses, ${backupLessons.length} lessons, ${backupExams.length} exams\n`);
    } catch (err: any) {
      console.warn(`  ⚠ Skipped ${name}: ${err.message}`);
    }
  }

  return { courses, lessons, exams };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const backupDir = process.argv[2] || 'C:\\Users\\Administrator\\Downloads\\Compressed';

  console.log('\n🛟 ================================================');
  console.log('🛟  FULL DATA RESTORE FROM LOCAL BACKUPS');
  console.log('🛟 ================================================\n');
  console.log(`📁 Backup directory: ${backupDir}\n`);

  // 1. Load and merge all backups
  const { courses: backupCourses, lessons: backupLessons, exams: backupExams } = loadAndMergeBackups(backupDir);
  console.log(`\n📊 Merged pool: ${backupCourses.size} unique courses, ${backupLessons.size} unique lessons, ${backupExams.size} unique exams\n`);

  // 2. Load current active DB state
  const [activeCourses, activeLessons] = await Promise.all([
    prisma.course.findMany({ select: { id: true, title: true } }),
    prisma.lesson.findMany({ select: { id: true, courseId: true, title: true, slides: true, questions: true, assignments: true, attachments: true } }),
  ]);

  const activeCourseIds = new Set(activeCourses.map(c => c.id));
  const activeLessonMap = new Map(activeLessons.map(l => [l.id, l]));

  console.log(`📊 Active DB: ${activeCourses.length} courses, ${activeLessons.length} lessons\n`);

  let restoredCourses = 0;
  let updatedCourses = 0;
  let restoredLessons = 0;
  let updatedLessons = 0;
  let skipped = 0;
  const report: string[] = [];

  // 3. Restore / update courses
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📚 STEP 1: Restoring Courses');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const [courseId, c] of backupCourses) {
    try {
      const payload = {
        title: c.title,
        description: c.description ?? null,
        coverImage: c.coverImage ?? null,
        grade: c.grade ?? null,
        grades: c.grades ?? null,
        subject: c.subject ?? null,
        country: c.country || 'مصر',
        isCentral: c.isCentral ?? true,
        schoolId: c.schoolId ?? null,
        deletedAt: null, // Restore from trash if soft-deleted
        updatedAt: new Date(),
      };

      if (activeCourseIds.has(courseId)) {
        // Update existing course (un-delete if soft-deleted)
        await prisma.course.update({ where: { id: courseId }, data: payload });
        updatedCourses++;
        report.push(`🔄 Updated course: "${c.title}"`);
        console.log(`  🔄 Updated: "${c.title}"`);
      } else {
        // Create missing course
        await prisma.course.create({
          data: {
            id: courseId,
            ...payload,
            createdAt: safeDate(c.createdAt) ?? new Date(),
          }
        });
        activeCourseIds.add(courseId);
        restoredCourses++;
        report.push(`✅ Restored course: "${c.title}"`);
        console.log(`  ✅ Restored: "${c.title}"`);
      }
    } catch (err: any) {
      const msg = `❌ Course "${c.title}" (${courseId}): ${err.message}`;
      report.push(msg);
      console.warn(`  ⚠ ${msg}`);
      skipped++;
    }
  }

  // 4. Restore / update lessons with Quizzes, Assignments, Slides
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📖 STEP 2: Restoring Lessons (with Q, A, Slides)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const [lessonId, l] of backupLessons) {
    if (!l.courseId) { skipped++; continue; }
    if (!activeCourseIds.has(l.courseId)) {
      console.warn(`  ⚠ Skipping "${l.title}" — parent course ${l.courseId} not found`);
      skipped++;
      continue;
    }

    const backupQ = parseSafe(l.questions);
    const backupA = parseSafe(l.assignments);
    const backupS = parseSafe(l.slides);
    const backupAtt = parseSafe(l.attachments);

    try {
      if (activeLessonMap.has(lessonId)) {
        // Lesson EXISTS — update fields, but only if backup has MORE data
        const existing = activeLessonMap.get(lessonId)!;
        const existingQ = parseSafe(existing.questions);
        const existingA = parseSafe(existing.assignments);
        const existingS = parseSafe(existing.slides);
        const existingAtt = parseSafe(existing.attachments);

        // Use whichever is richer
        const finalQ = (Array.isArray(backupQ) && backupQ.length > 0 && backupQ.length >= (existingQ?.length || 0)) ? backupQ : existingQ;
        const finalA = (Array.isArray(backupA) && backupA.length > 0 && backupA.length >= (existingA?.length || 0)) ? backupA : existingA;
        const finalS = (Array.isArray(backupS) && backupS.length > 0 && backupS.length >= (existingS?.length || 0)) ? backupS : existingS;
        const finalAtt = (Array.isArray(backupAtt) && backupAtt.length > 0 && backupAtt.length >= (existingAtt?.length || 0)) ? backupAtt : existingAtt;

        const qChanged = JSON.stringify(finalQ) !== JSON.stringify(existingQ);
        const aChanged = JSON.stringify(finalA) !== JSON.stringify(existingA);
        const sChanged = JSON.stringify(finalS) !== JSON.stringify(existingS);
        const attChanged = JSON.stringify(finalAtt) !== JSON.stringify(existingAtt);

        if (qChanged || aChanged || sChanged || attChanged) {
          await prisma.lesson.update({
            where: { id: lessonId },
            data: {
              questions: finalQ as any,
              assignments: finalA as any,
              slides: finalS as any,
              attachments: finalAtt as any,
              deletedAt: null,
              updatedAt: new Date(),
            }
          });
          updatedLessons++;
          const changes = [
            qChanged ? `Q:${(existingQ?.length||0)}→${(finalQ?.length||0)}` : '',
            aChanged ? `A:${(existingA?.length||0)}→${(finalA?.length||0)}` : '',
            sChanged ? `S:${(existingS?.length||0)}→${(finalS?.length||0)}` : '',
          ].filter(Boolean).join(', ');
          report.push(`  🔄 Updated lesson: "${l.title}" [${changes}]`);
          console.log(`  🔄 Updated: "${l.title}" [${changes}]`);
        } else {
          // Already has data, just un-delete if needed
          if ((existing as any).deletedAt) {
            await prisma.lesson.update({ where: { id: lessonId }, data: { deletedAt: null } });
          }
        }
      } else {
        // Lesson MISSING — create it with all data
        await prisma.lesson.create({
          data: {
            id: lessonId,
            courseId: l.courseId,
            title: l.title || 'Untitled Lesson',
            domain: l.domain ?? null,
            content: l.content ?? null,
            videoUrl: l.videoUrl ?? null,
            duration: l.duration ?? 0,
            summary: l.summary ?? null,
            notes: l.notes ?? null,
            questions: backupQ as any,
            assignments: backupA as any,
            attachments: backupAtt as any,
            slides: backupS as any,
            standards: l.standards ?? null,
            indicators: l.indicators ?? null,
            learningOutcomes: l.learningOutcomes ?? null,
            isCentral: l.isCentral ?? false,
            isVisible: l.isVisible !== undefined ? !!l.isVisible : true,
            publishDate: safeDate(l.publishDate),
            cutOffDate: safeDate(l.cutOffDate),
            order: l.order ?? 0,
            deletedAt: null,
            createdAt: safeDate(l.createdAt) ?? new Date(),
            updatedAt: new Date(),
          }
        });
        activeLessonMap.set(lessonId, l);
        restoredLessons++;
        report.push(`  ✅ Restored lesson: "${l.title}" Q:${backupQ?.length||0} A:${backupA?.length||0} S:${backupS?.length||0}`);
        console.log(`  ✅ Restored: "${l.title}" | Q:${backupQ?.length||0} A:${backupA?.length||0} S:${backupS?.length||0}`);
      }
    } catch (err: any) {
      const msg = `❌ Lesson "${l.title}" (${lessonId}): ${err.message}`;
      report.push(msg);
      console.warn(`  ⚠ ${msg}`);
      skipped++;
    }
  }

  // 5. Final report
  console.log('\n🛟 ================================================');
  console.log('🛟  RESTORE COMPLETE — SUMMARY');
  console.log('🛟 ================================================');
  console.log(`  ✅ Courses restored : ${restoredCourses}`);
  console.log(`  🔄 Courses updated  : ${updatedCourses}`);
  console.log(`  ✅ Lessons restored : ${restoredLessons}`);
  console.log(`  🔄 Lessons updated  : ${updatedLessons}`);
  console.log(`  ⏭  Items skipped   : ${skipped}`);
  console.log('🛟 ================================================\n');

  // Save report to file
  const reportPath = path.join(process.cwd(), `restore-report-${Date.now()}.txt`);
  fs.writeFileSync(reportPath, report.join('\n'), 'utf-8');
  console.log(`📄 Full report saved to: ${reportPath}\n`);
}

main()
  .catch(err => {
    console.error('\n❌ CRITICAL ERROR during restore:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('✅ Database connection closed.');
  });
