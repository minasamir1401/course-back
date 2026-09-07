import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function normalizeOptions(optionsRaw: string | null | undefined): string {
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
      .map((c) => normalizeText(c))
      .filter((c) => c.length > 0)
      .sort()
      .join('|');
  } catch {
    return normalizeText(optionsRaw);
  }
}

export async function runSafeDeduplicationAndEmptyCleanup(): Promise<{
  duplicatesDeleted: number;
  emptyQuestionsDeleted: number;
  preservedWithAnswers: number;
}> {
  console.log('===========================================================');
  console.log('🚀 Starting Safe Question Deduplication & Empty Cleanup');
  console.log('🔒 SAFETY RULE: Questions with student answers will NEVER be deleted.');
  console.log('===========================================================\n');

  let duplicatesDeleted = 0;
  let emptyQuestionsDeleted = 0;
  let preservedWithAnswers = 0;

  // ---------------------------------------------------------
  // PHASE 1: DEDUPLICATE QUESTIONS WITHIN EXAMS
  // ---------------------------------------------------------
  console.log('--- Phase 1: Checking for duplicate questions per exam ---');

  const exams = await prisma.exam.findMany({
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
        createdAt: true,
      },
    });

    if (questions.length <= 1) continue;

    // Group by subExam/module context + normalized text + normalized options
    const groups = new Map<string, typeof questions>();

    for (const q of questions) {
      const normText = normalizeText(q.text);
      // If question is completely empty, Phase 2 will handle it
      if (!normText && !q.imageUrl) continue;

      const normOpt = normalizeOptions(q.options);
      const subContext = q.subExamId || q.moduleId || 'root';
      const sig = `${subContext}:::${normText}:::${normOpt}`;

      const existing = groups.get(sig) || [];
      existing.push(q);
      groups.set(sig, existing);
    }

    for (const [sig, group] of groups.entries()) {
      if (group.length <= 1) continue;

      console.log(`\n🔎 Found ${group.length} duplicates in Exam "${exam.title}" (${exam.id})`);

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

      // Determine which single question to keep
      let questionToKeep = withAnswers[0] || withoutAnswers[0];

      // Questions safe to delete: any question in withoutAnswers that is not questionToKeep
      const toDelete = withoutAnswers.filter((q) => q.id !== questionToKeep.id);

      for (const item of toDelete) {
        try {
          // Clean XPHistory first if any
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

  const allQuestions = await prisma.question.findMany({
    select: {
      id: true,
      text: true,
      imageUrl: true,
      videoUrl: true,
      exam: { select: { title: true } },
    },
  });

  for (const q of allQuestions) {
    const normText = normalizeText(q.text);
    const hasImage = Boolean(q.imageUrl && q.imageUrl.trim().length > 0);
    const hasVideo = Boolean(q.videoUrl && q.videoUrl.trim().length > 0);

    // If completely empty of content
    if (!normText && !hasImage && !hasVideo) {
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

  console.log('===========================================================');
  console.log('🎉 Cleanup Summary:');
  console.log(`   - Duplicate Questions Removed: ${duplicatesDeleted}`);
  console.log(`   - Empty Questions Removed:     ${emptyQuestionsDeleted}`);
  console.log(`   - Questions Protected/Answers: ${preservedWithAnswers}`);
  console.log('===========================================================\n');

  return {
    duplicatesDeleted,
    emptyQuestionsDeleted,
    preservedWithAnswers,
  };
}

// Execute if run directly from CLI
if (require.main === module) {
  runSafeDeduplicationAndEmptyCleanup()
    .then(() => {
      prisma.$disconnect();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error during cleanup:', err);
      prisma.$disconnect();
      process.exit(1);
    });
}
