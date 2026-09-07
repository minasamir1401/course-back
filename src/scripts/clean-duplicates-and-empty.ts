import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function normalizeQuestionText(text: string | null | undefined): string {
  if (!text) return '';
  let clean = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // Strip leading question labels like "Question 1 (College Board):" or "سؤال 1:"
  clean = clean.replace(/^(question|سؤال|q)\s*\d+(\s*\([^)]*\))?[:.\s-]*/i, '').trim();
  return clean;
}

export function getQuestionCoreSignature(text: string | null | undefined, optionsRaw?: string | null | undefined): string {
  const clean = normalizeQuestionText(text);
  const alphaCore = clean.replace(/[^a-z0-9\u0600-\u06FF]/gi, '');
  if (alphaCore.length >= 15) {
    // 35 chars of alphanumeric text is overwhelmingly unique and ignores end-of-string differences
    return `core:${alphaCore.substring(0, 35)}`;
  }
  if (clean.length > 0) {
    return `text:${clean}`;
  }
  return '';
}

export function normalizeOptions(optionsRaw: string | null | undefined): string {
  if (!optionsRaw) return '';
  try {
    let parsed: any = optionsRaw;
    if (typeof optionsRaw === 'string') {
      try {
        parsed = JSON.parse(optionsRaw);
      } catch {
        parsed = optionsRaw.split(',').map((s) => s.trim());
      }
    }
    let choices: string[] = [];
    if (Array.isArray(parsed)) {
      choices = parsed.map((c) => String(c || ''));
    } else if (parsed && typeof parsed === 'object') {
      choices = Object.values(parsed).map((c) => String(c || ''));
    } else if (typeof parsed === 'string') {
      choices = [parsed];
    }
    return choices
      .map((c) => normalizeQuestionText(c))
      .filter((c) => c.length > 0)
      .sort()
      .join('|');
  } catch {
    return normalizeQuestionText(optionsRaw);
  }
}

export async function runSafeDeduplicationAndEmptyCleanup(targetExamId?: string): Promise<{
  duplicatesDeleted: number;
  emptyQuestionsDeleted: number;
  preservedWithAnswers: number;
  remainingQuestions: number;
}> {
  console.log('===========================================================');
  console.log(`🚀 Starting Safe Question Deduplication & Empty Cleanup ${targetExamId ? `for Exam ${targetExamId}` : '(All Exams)'}`);
  console.log('🔒 SAFETY RULE: Questions with student answers will NEVER be deleted.');
  console.log('===========================================================\n');

  let duplicatesDeleted = 0;
  let emptyQuestionsDeleted = 0;
  let preservedWithAnswers = 0;

  // ---------------------------------------------------------
  // PHASE 1: DEDUPLICATE QUESTIONS WITHIN EXAMS
  // ---------------------------------------------------------
  console.log('--- Phase 1: Checking for duplicate questions ---');

  const examWhere = targetExamId ? { id: targetExamId } : {};
  const exams = await prisma.exam.findMany({
    where: examWhere,
    select: { id: true, title: true },
  });

  for (const exam of exams) {
    const questions = await prisma.question.findMany({
      where: { examId: exam.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        text: true,
        options: true,
        subExamId: true,
        moduleId: true,
        imageUrl: true,
        videoUrl: true,
        createdAt: true,
      },
    });

    if (questions.length <= 1) continue;

    // Group by core signature
    const groups = new Map<string, typeof questions>();

    for (const q of questions) {
      const sig = getQuestionCoreSignature(q.text, q.options);
      // Empty questions will be handled in Phase 2
      if (!sig && !q.imageUrl && !q.videoUrl) continue;

      const groupKey = sig || `img:${q.imageUrl || q.id}`;
      const existing = groups.get(groupKey) || [];
      existing.push(q);
      groups.set(groupKey, existing);
    }

    for (const [sig, group] of groups.entries()) {
      if (group.length <= 1) continue;

      console.log(`\n🔎 Found ${group.length} duplicate questions in Exam "${exam.title}" (${exam.id}) [Sig: ${sig}]`);

      // Check student answers for all questions in this duplicate group
      const questionsWithAnswerCounts = await Promise.all(
        group.map(async (q) => {
          const answersCount = await prisma.studentAnswer.count({
            where: { questionId: q.id },
          });
          return { ...q, answersCount };
        })
      );

      // Separate into those with answers and those without
      const withAnswers = questionsWithAnswerCounts.filter((q) => q.answersCount > 0);
      const withoutAnswers = questionsWithAnswerCounts.filter((q) => q.answersCount === 0);

      if (withAnswers.length > 1) {
        console.warn(
          `   ⚠️ [PRESERVED] Multiple duplicates have student answers (${withAnswers.length} items). Preserving all of them for safety.`
        );
        preservedWithAnswers += withAnswers.length;
      }

      // Determine which question to keep (prefer one with student answers, or the earliest created)
      const questionToKeep = withAnswers[0] || withoutAnswers[0];

      // Safe to delete: questions with 0 answers that are not questionToKeep
      const toDelete = withoutAnswers.filter((q) => q.id !== questionToKeep.id);

      for (const item of toDelete) {
        try {
          await prisma.xPHistory.deleteMany({ where: { questionId: item.id } }).catch(() => {});
          await prisma.question.delete({ where: { id: item.id } });
          duplicatesDeleted++;
          console.log(`   ✅ [DELETED DUPLICATE] Question ${item.id} (0 answers) - kept ${questionToKeep.id}`);
        } catch (delErr: any) {
          console.error(`   ❌ Failed to delete duplicate question ${item.id}:`, delErr.message);
        }
      }
    }
  }

  console.log(`\nPhase 1 Complete: Deleted ${duplicatesDeleted} duplicate questions.`);

  // ---------------------------------------------------------
  // PHASE 2: CLEANUP EMPTY QUESTIONS
  // ---------------------------------------------------------
  console.log('\n--- Phase 2: Checking for empty questions with 0 answers ---');

  const questionWhere = targetExamId ? { examId: targetExamId } : {};
  const allQuestions = await prisma.question.findMany({
    where: questionWhere,
    select: {
      id: true,
      text: true,
      imageUrl: true,
      videoUrl: true,
      exam: { select: { title: true } },
    },
  });

  for (const q of allQuestions) {
    const cleanText = normalizeQuestionText(q.text);
    const hasImage = Boolean(q.imageUrl && q.imageUrl.trim().length > 0);
    const hasVideo = Boolean(q.videoUrl && q.videoUrl.trim().length > 0);

    // If completely empty text (< 2 non-whitespace characters) and no image/video
    if (cleanText.length < 2 && !hasImage && !hasVideo) {
      // Check for student answers
      const answersCount = await prisma.studentAnswer.count({
        where: { questionId: q.id },
      });

      if (answersCount > 0) {
        console.warn(
          `   ⚠️ [PRESERVED EMPTY] Empty question ${q.id} in Exam "${q.exam?.title}" has ${answersCount} student answers. Preserved for safety.`
        );
        preservedWithAnswers++;
        continue;
      }

      try {
        await prisma.xPHistory.deleteMany({ where: { questionId: q.id } }).catch(() => {});
        await prisma.question.delete({ where: { id: q.id } });
        emptyQuestionsDeleted++;
        console.log(`   ✅ [DELETED EMPTY] Removed blank question ${q.id} (0 answers).`);
      } catch (delErr: any) {
        console.error(`   ❌ Failed to delete empty question ${q.id}:`, delErr.message);
      }
    }
  }

  console.log(`Phase 2 Complete: Deleted ${emptyQuestionsDeleted} empty questions.\n`);

  const remainingQuestions = targetExamId
    ? await prisma.question.count({ where: { examId: targetExamId } })
    : await prisma.question.count();

  console.log('===========================================================');
  console.log('🎉 Cleanup Summary:');
  console.log(`   - Duplicate Questions Removed: ${duplicatesDeleted}`);
  console.log(`   - Empty Questions Removed:     ${emptyQuestionsDeleted}`);
  console.log(`   - Questions Protected/Answers: ${preservedWithAnswers}`);
  console.log(`   - Remaining Questions:         ${remainingQuestions}`);
  console.log('===========================================================\n');

  return {
    duplicatesDeleted,
    emptyQuestionsDeleted,
    preservedWithAnswers,
    remainingQuestions,
  };
}

// Execute if run directly from CLI
if (require.main === module) {
  runSafeDeduplicationAndEmptyCleanup()
    .then(() => {
      prisma.$disconnect();
    })
    .catch((err) => {
      console.error('Fatal cleanup error:', err);
      prisma.$disconnect();
      process.exit(1);
    });
}
