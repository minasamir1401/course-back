import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Starting duplicate questions cleanup...");
  
  // Get all exams that might have duplicates
  const exams = await prisma.exam.findMany({
    select: { id: true, title: true }
  });

  let totalDeleted = 0;

  for (const exam of exams) {
    const questions = await prisma.question.findMany({
      where: { examId: exam.id },
      orderBy: { createdAt: 'asc' }
    });

    const seenText = new Set<string>();
    const duplicatesIds: string[] = [];

    for (const q of questions) {
      // Normalize text to detect duplicates (remove whitespace, html tags if necessary)
      const normalized = q.text.trim().toLowerCase();
      
      // We will also use 'options' as part of the signature in case some questions have the same text but different options
      const signature = `${normalized}::${q.options}`;

      if (seenText.has(signature)) {
        duplicatesIds.push(q.id);
      } else {
        seenText.add(signature);
      }
    }

    if (duplicatesIds.length > 0) {
      console.log(`Exam: ${exam.title} - Found ${duplicatesIds.length} duplicate questions. Deleting...`);
      const deleted = await prisma.question.deleteMany({
        where: {
          id: { in: duplicatesIds }
        }
      });
      totalDeleted += deleted.count;
      console.log(`Deleted ${deleted.count} duplicate questions for this exam.`);
    }
  }

  console.log(`\nCleanup complete! Total duplicates removed: ${totalDeleted}`);
}

main()
  .catch(e => {
    console.error("Error running script:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
