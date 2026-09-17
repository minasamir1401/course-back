import prisma from '../lib/prisma';
import { translateSingleText } from '../services/translation.service';
import { buildEnglishExplanation } from '../utils/bilingualExplanation';

const applyChanges = process.argv.includes('--apply');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const parsedLimit = Number(limitArg?.split('=')[1] || 0);
const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

export async function backfillExplanationTranslations() {
  const questions = await prisma.question.findMany({
    where: {
      deletedAt: null,
      explanation: { not: null },
      OR: [{ explanationEn: null }, { explanationEn: '' }],
    },
    select: { id: true, explanation: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...(limit ? { take: limit } : {}),
  });

  let translated = 0;
  let skipped = 0;
  for (const question of questions) {
    const explanationEn = await buildEnglishExplanation(question.explanation || '', translateSingleText);
    if (!explanationEn) {
      skipped += 1;
      console.warn(`[translation-backfill] Skipped ${question.id}: translation provider returned no usable English result.`);
      continue;
    }
    translated += 1;
    if (applyChanges) {
      await prisma.question.update({ where: { id: question.id }, data: { explanationEn } });
    }
  }

  console.log(JSON.stringify({ mode: applyChanges ? 'apply' : 'preview', scanned: questions.length, translated, skipped }));
  return { scanned: questions.length, translated, skipped, applied: applyChanges ? translated : 0 };
}

if (require.main === module) {
  backfillExplanationTranslations()
    .catch((error) => {
      console.error('[translation-backfill] Failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
