/**
 * ================================================================
 *  RESTORE-FROM-LOCAL-BACKUP — Full Data Recovery Script
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

function loadAndMergeBackups(backupDir: string): {
  courses: Map<string, any>;
  lessons: Map<string, any>;
  exams: Map<string, any>;
  modules: Map<string, any>;
  subExams: Map<string, any>;
  questions: Map<string, any>;
} {
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

  console.log(`Found ${files.length} backup files in: ${backupDir}`);

  const courses = new Map<string, any>();
  const lessons = new Map<string, any>();
  const exams = new Map<string, any>();
  const modules = new Map<string, any>();
  const subExams = new Map<string, any>();
  const questions = new Map<string, any>();

  for (const { name, fullPath } of files) {
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const data = parsed.data || parsed;

      const backupCourses: any[] = Array.isArray(data.course) ? data.course : [];
      const backupLessons: any[] = Array.isArray(data.lesson) ? data.lesson : [];
      const backupExams: any[] = Array.isArray(data.exam) ? data.exam : [];
      const backupModules: any[] = Array.isArray(data.examModule) ? data.examModule : [];
      const backupSubExams: any[] = Array.isArray(data.subExam) ? data.subExam : [];
      const backupQuestions: any[] = Array.isArray(data.question) ? data.question : [];

      for (const c of backupCourses) {
        if (!c?.id || !c?.title) continue;
        if (!courses.has(c.id)) {
          courses.set(c.id, { ...c });
        }
        if (Array.isArray(c.lessons)) {
          for (const l of c.lessons) {
            if (!l?.id) continue;
            if (!lessons.has(l.id)) {
              lessons.set(l.id, { ...l, courseId: l.courseId || c.id });
            } else {
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
        if (Array.isArray(c.exams)) {
          for (const e of c.exams) {
            if (!e?.id) continue;
            if (!exams.has(e.id)) {
              exams.set(e.id, { ...e, courseId: e.courseId || c.id });
            }
            if (Array.isArray(e.modules)) {
              for (const m of e.modules) {
                if (m?.id && !modules.has(m.id)) modules.set(m.id, { ...m, examId: e.id });
                if (Array.isArray(m.subExams)) {
                  for (const se of m.subExams) {
                    if (se?.id && !subExams.has(se.id)) subExams.set(se.id, { ...se, moduleId: m.id });
                  }
                }
                if (Array.isArray(m.subModules)) {
                  for (const sm of m.subModules) {
                    if (sm?.id && !modules.has(sm.id)) modules.set(sm.id, { ...sm, examId: e.id, parentModuleId: m.id });
                    if (Array.isArray(sm.subExams)) {
                      for (const se of sm.subExams) {
                        if (se?.id && !subExams.has(se.id)) subExams.set(se.id, { ...se, moduleId: sm.id });
                      }
                    }
                  }
                }
              }
            }
            if (Array.isArray(e.questions)) {
              for (const q of e.questions) {
                if (q?.id && !questions.has(q.id)) questions.set(q.id, { ...q, examId: e.id });
              }
            }
          }
        }
      }

      for (const l of backupLessons) {
        if (!l?.id) continue;
        if (!lessons.has(l.id)) {
          lessons.set(l.id, { ...l });
        } else {
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
        if (Array.isArray(e.modules)) {
          for (const m of e.modules) {
            if (m?.id && !modules.has(m.id)) modules.set(m.id, { ...m, examId: e.id });
            if (Array.isArray(m.subExams)) {
              for (const se of m.subExams) {
                if (se?.id && !subExams.has(se.id)) subExams.set(se.id, { ...se, moduleId: m.id });
              }
            }
            if (Array.isArray(m.subModules)) {
              for (const sm of m.subModules) {
                if (sm?.id && !modules.has(sm.id)) modules.set(sm.id, { ...sm, examId: e.id, parentModuleId: m.id });
                if (Array.isArray(sm.subExams)) {
                  for (const se of sm.subExams) {
                    if (se?.id && !subExams.has(se.id)) subExams.set(se.id, { ...se, moduleId: sm.id });
                  }
                }
              }
            }
          }
        }
        if (Array.isArray(e.questions)) {
          for (const q of e.questions) {
            if (q?.id && !questions.has(q.id)) questions.set(q.id, { ...q, examId: e.id });
          }
        }
      }

      for (const m of backupModules) {
        if (m?.id && !modules.has(m.id)) modules.set(m.id, m);
        if (Array.isArray(m.subExams)) {
          for (const se of m.subExams) {
            if (se?.id && !subExams.has(se.id)) subExams.set(se.id, { ...se, moduleId: m.id });
          }
        }
        if (Array.isArray(m.subModules)) {
          for (const sm of m.subModules) {
            if (sm?.id && !modules.has(sm.id)) modules.set(sm.id, { ...sm, examId: m.examId, parentModuleId: m.id });
            if (Array.isArray(sm.subExams)) {
              for (const se of sm.subExams) {
                if (se?.id && !subExams.has(se.id)) subExams.set(se.id, { ...se, moduleId: sm.id });
              }
            }
          }
        }
      }
      for (const se of backupSubExams) {
        if (se?.id && !subExams.has(se.id)) subExams.set(se.id, se);
      }
      for (const q of backupQuestions) {
        if (q?.id && !questions.has(q.id)) questions.set(q.id, q);
      }

      process.stdout.write(`  [OK] ${name} - ${backupCourses.length} courses, ${backupLessons.length} lessons, ${backupExams.length} exams\n`);
    } catch (err: any) {
      console.warn(`  Warning: Skipped ${name}: ${err.message}`);
    }
  }

  return { courses, lessons, exams, modules, subExams, questions };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const backupDir = process.argv[2] || 'C:\\Users\\Administrator\\Downloads\\Compressed';

  console.log('\n ================================================');
  console.log('  FULL DATA RESTORE FROM LOCAL BACKUPS');
  console.log(' ================================================\n');
  console.log(` Backup directory: ${backupDir}\n`);

  // 1. Load and merge all backups
  const { courses: backupCourses, lessons: backupLessons, exams: backupExams, modules: backupModules, subExams: backupSubExams, questions: backupQuestions } = loadAndMergeBackups(backupDir);
  console.log(`\n Merged pool: ${backupCourses.size} unique courses, ${backupLessons.size} unique lessons, ${backupExams.size} unique exams\n`);

  // 2. Load current active DB state
  const [activeCourses, activeLessons] = await Promise.all([
    prisma.course.findMany({ select: { id: true, title: true } }),
    prisma.lesson.findMany({ select: { id: true, courseId: true, title: true, slides: true, questions: true, assignments: true, attachments: true } }),
  ]);

  const activeCourseIds = new Set(activeCourses.map(c => c.id));
  const activeLessonMap = new Map(activeLessons.map(l => [l.id, l]));

  console.log(` Active DB: ${activeCourses.length} courses, ${activeLessons.length} lessons\n`);

  let restoredCourses = 0;
  let updatedCourses = 0;
  let restoredLessons = 0;
  let updatedLessons = 0;
  let restoredExams = 0;
  let updatedExams = 0;
  let skipped = 0;
  const report: string[] = [];

  // 3. Restore / update courses
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' STEP 1: Restoring Courses');
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
        report.push(` Updated course: "${c.title}"`);
        console.log(`   Updated: "${c.title}"`);
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
        report.push(` Restored course: "${c.title}"`);
        console.log(`   Restored: "${c.title}"`);
      }
    } catch (err: any) {
      const msg = ` Course "${c.title}" (${courseId}): ${err.message}`;
      report.push(msg);
      console.warn(`   ${msg}`);
      skipped++;
    }
  }

  // 4. Restore / update lessons with Quizzes, Assignments, Slides
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' STEP 2: Restoring Lessons (with Q, A, Slides)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const [lessonId, l] of backupLessons) {
    if (!l.courseId) { skipped++; continue; }
    if (!activeCourseIds.has(l.courseId)) {
      console.warn(`   Skipping "${l.title}" — parent course ${l.courseId} not found`);
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
          report.push(`   Updated lesson: "${l.title}" [${changes}]`);
          console.log(`   Updated: "${l.title}" [${changes}]`);
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
        report.push(`   Restored lesson: "${l.title}" Q:${backupQ?.length||0} A:${backupA?.length||0} S:${backupS?.length||0}`);
        console.log(`   Restored: "${l.title}" | Q:${backupQ?.length||0} A:${backupA?.length||0} S:${backupS?.length||0}`);
      }
    } catch (err: any) {
      const msg = ` Lesson "${l.title}" (${lessonId}): ${err.message}`;
      report.push(msg);
      console.warn(`   ${msg}`);
      skipped++;
    }
  }

  // 5. Restore / update modular exams (with modules, sub-exams, and bilingual questions)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' STEP 3: Restoring Exams (Modular Hierarchy & Bilingual Questions)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const activeExams = await prisma.exam.findMany({ select: { id: true } });
  const activeExamIds = new Set(activeExams.map(e => e.id));

  for (const [examId, e] of backupExams) {
    try {
      const ePayload: any = {
        title: e.title ?? 'Untitled',
        description: e.description ?? null,
        type: e.type ?? 'Quiz',
        duration: typeof e.duration === 'number' ? e.duration : 30,
        passingScore: typeof e.passingScore === 'number' ? e.passingScore : 50,
        isCentral: e.isCentral ?? false,
        showAnswers: e.showAnswers !== false,
        resultVisibility: e.resultVisibility ?? 'SHOW_SCORE',
        password: e.password ?? null,
        startDate: safeDate(e.startDate),
        endDate: safeDate(e.endDate),
        attemptsAllowed: typeof e.attemptsAllowed === 'number' ? e.attemptsAllowed : 1,
        status: e.status ?? 'PUBLISHED',
        category: e.category ?? null,
        grade: e.grade ?? null,
        grades: e.grades ?? null,
        subjects: e.subjects ?? null,
        schoolId: e.schoolId ?? null,
        courseId: (e.courseId && activeCourseIds.has(e.courseId)) ? e.courseId : null,
        skill: e.skill ?? null,
        level: e.level ?? 'Medium',
        deletedAt: null,
        createdAt: safeDate(e.createdAt) ?? new Date(),
        updatedAt: new Date()
      };

      if (activeExamIds.has(examId)) {
        await prisma.exam.update({ where: { id: examId }, data: ePayload });
        updatedExams++;
      } else {
        await prisma.exam.create({ data: { id: examId, ...ePayload } });
        activeExamIds.add(examId);
        restoredExams++;
      }

      // Restore modules for this exam (parents first, then children)
      const examModules = Array.from(backupModules.values()).filter((m: any) => m.examId === examId);
      const parentMods = examModules.filter((m: any) => !m.parentModuleId);
      const childMods = examModules.filter((m: any) => !!m.parentModuleId);

      for (const m of [...parentMods, ...childMods]) {
        const mPayload = {
          examId,
          parentModuleId: m.parentModuleId ?? null,
          title: m.title || 'Untitled Module',
          description: m.description ?? null,
          order: typeof m.order === 'number' ? m.order : 0,
          duration: m.duration ? Number(m.duration) : null,
          passingScore: m.passingScore ? Number(m.passingScore) : null,
          gradeTarget: m.gradeTarget ?? null,
          publishDate: safeDate(m.publishDate),
          cutOffDate: safeDate(m.cutOffDate),
          createdAt: safeDate(m.createdAt) ?? new Date(),
          updatedAt: new Date()
        };
        await prisma.examModule.upsert({
          where: { id: m.id },
          update: mPayload,
          create: { id: m.id, ...mPayload }
        });
      }

      // Restore sub-exams for this exam's modules
      const examModuleIds = new Set(examModules.map((m: any) => m.id));
      const examSubExams = Array.from(backupSubExams.values()).filter((se: any) => examModuleIds.has(se.moduleId));
      for (const se of examSubExams) {
        const sePayload = {
          moduleId: se.moduleId,
          title: se.title || 'Untitled SubExam',
          password: se.password ?? null,
          duration: se.duration ? Number(se.duration) : null,
          passingScore: se.passingScore ? Number(se.passingScore) : null,
          attemptsAllowed: typeof se.attemptsAllowed === 'number' ? se.attemptsAllowed : 1,
          order: typeof se.order === 'number' ? se.order : 0,
          publishDate: safeDate(se.publishDate),
          cutOffDate: safeDate(se.cutOffDate),
          createdAt: safeDate(se.createdAt) ?? new Date(),
          updatedAt: new Date()
        };
        await prisma.subExam.upsert({
          where: { id: se.id },
          update: sePayload,
          create: { id: se.id, ...sePayload }
        });
      }

      // Restore questions for this exam (including bilingual fields)
      const examQuestions = Array.from(backupQuestions.values()).filter((q: any) => q.examId === examId);
      for (const q of examQuestions) {
        const optionsStr = typeof q.options === 'string'
          ? q.options
          : JSON.stringify(Array.isArray(q.options) ? q.options : []);

        const optionsEnStr = q.optionsEn
          ? (typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(Array.isArray(q.optionsEn) ? q.optionsEn : []))
          : null;

        const correctAnswerStr = Array.isArray(q.correctAnswer)
          ? JSON.stringify(q.correctAnswer)
          : String(q.correctAnswer ?? '');

        const qPayload: any = {
          examId,
          text: q.text ?? q.content ?? '',
          textEn: q.textEn ?? null,
          type: q.type || q.questionType || 'MCQ',
          options: optionsStr,
          optionsEn: optionsEnStr,
          correctAnswer: correctAnswerStr,
          points: Number(q.points) || 1,
          xpPoints: Number(q.xpPoints) || 10,
          skill: q.skill ?? null,
          learningOutcome: q.learningOutcome ?? null,
          indicator: q.indicator ?? null,
          videoUrl: q.videoUrl ?? null,
          level: q.level ?? 'Medium',
          dok: q.dok ?? null,
          cognitive: q.cognitive ?? null,
          course: q.course ?? null,
          section: q.section ?? null,
          domain: q.domain ?? null,
          standard: q.standard ?? null,
          subskill: q.subskill ?? null,
          microSkill: q.microSkill ?? null,
          gradeTarget: q.gradeTarget ?? null,
          errorPattern: q.errorPattern ?? null,
          estimatedTime: q.estimatedTime ? String(q.estimatedTime) : null,
          explanation: q.explanation ?? null,
          explanationEn: q.explanationEn ?? null,
          imageUrl: q.imageUrl ?? null,
          order: Number(q.order) || 0,
          deletedAt: null,
          moduleId: (q.moduleId && examModuleIds.has(q.moduleId)) ? q.moduleId : null,
          subExamId: q.subExamId ?? null,
          createdAt: safeDate(q.createdAt) ?? new Date(),
          updatedAt: new Date()
        };

        await prisma.question.upsert({
          where: { id: q.id },
          update: qPayload,
          create: { id: q.id, ...qPayload }
        });
      }

      report.push(`  Exam: "${e.title}" (Q: ${examQuestions.length}, M: ${examModules.length})`);
      console.log(`  Exam: "${e.title}" | Q: ${examQuestions.length}, M: ${examModules.length}`);
    } catch (err: any) {
      const msg = `Exam "${e.title}" (${examId}): ${err.message}`;
      report.push(msg);
      console.warn(`  Warning: ${msg}`);
      skipped++;
    }
  }

  // 6. Final report
  console.log('\n ================================================');
  console.log('  RESTORE COMPLETE — SUMMARY');
  console.log(' ================================================');
  console.log(`   Courses restored : ${restoredCourses}`);
  console.log(`   Courses updated  : ${updatedCourses}`);
  console.log(`   Lessons restored : ${restoredLessons}`);
  console.log(`   Lessons updated  : ${updatedLessons}`);
  console.log(`   Exams restored   : ${restoredExams}`);
  console.log(`   Exams updated    : ${updatedExams}`);
  console.log(`  ⏭  Items skipped   : ${skipped}`);
  console.log(' ================================================\n');

  // Save report to file
  const reportPath = path.join(process.cwd(), `restore-report-${Date.now()}.txt`);
  fs.writeFileSync(reportPath, report.join('\n'), 'utf-8');
  console.log(` Full report saved to: ${reportPath}\n`);
}

main()
  .catch(err => {
    console.error('\n CRITICAL ERROR during restore:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(' Database connection closed.');
  });
