import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const removeArabic = (text: string | null) => {
  if (!text) return text;
  // This regex matches any Arabic characters (including letters, numbers, and common diacritics/symbols)
  return text.replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, '').trim();
};

async function main() {
  console.log('Starting metadata cleanup...');
  
  // 1. Fetch all questions that have standard, indicator, or learningOutcome containing Arabic characters
  const questionsToUpdate = await prisma.question.findMany({
    where: {
      OR: [
        { standard: { contains: 'ا' } }, // Simple heuristic, we'll check properly in JS
        { indicator: { contains: 'ا' } },
        { learningOutcome: { contains: 'ا' } }
      ]
    }
  });
  
  // Actually, we should just fetch everything that has any of these fields and check them
  const allQuestions = await prisma.question.findMany({
    where: {
      OR: [
        { standard: { not: null, not: '' } },
        { indicator: { not: null, not: '' } },
        { learningOutcome: { not: null, not: '' } }
      ]
    },
    select: {
      id: true,
      standard: true,
      indicator: true,
      learningOutcome: true
    }
  });

  let updatedCount = 0;

  for (const q of allQuestions) {
    const cleanedStandard = removeArabic(q.standard);
    const cleanedIndicator = removeArabic(q.indicator);
    const cleanedOutcome = removeArabic(q.learningOutcome);

    // If any of them changed, we update the record
    if (
      cleanedStandard !== q.standard ||
      cleanedIndicator !== q.indicator ||
      cleanedOutcome !== q.learningOutcome
    ) {
      await prisma.question.update({
        where: { id: q.id },
        data: {
          standard: cleanedStandard,
          indicator: cleanedIndicator,
          learningOutcome: cleanedOutcome
        }
      });
      updatedCount++;
    }
  }

  console.log(`Finished metadata cleanup! Updated ${updatedCount} questions.`);
}

main()
  .catch(e => {
    console.error('Error during cleanup:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
