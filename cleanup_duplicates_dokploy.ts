import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

async function requireConfirmation(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(
      '\n⚠️  WARNING: This script will PERMANENTLY DELETE duplicate exams and questions.\n' +
      '   Type exactly "DELETE_DUPLICATES" to proceed, or anything else to cancel:\n> ',
      (answer) => {
        rl.close();
        if (answer.trim() !== 'DELETE_DUPLICATES') {
          console.log('❌ Cancelled. No data was deleted.');
          process.exit(0);
        }
        resolve();
      }
    );
  });
}

async function main() {
  console.log("=========================================");
  console.log("Starting Automatic Duplicates Cleanup...");
  console.log("=========================================\n");

  let totalExamsDeleted = 0;
  let totalQuestionsDeleted = 0;

  // 1. Cleanup Duplicate Exams
  console.log("--- Phase 1: Cleaning up duplicate Exams ---");
  const exams = await prisma.exam.findMany({
    where: {
      deletedAt: null // Only consider active exams
    },
    orderBy: {
      createdAt: 'asc' // Keep the oldest ones
    },
    select: {
      id: true,
      title: true,
      courseId: true,
      folderId: true,
      schoolId: true
    }
  });

  const seenExams = new Set<string>();
  const duplicateExamIds: string[] = [];

  for (const exam of exams) {
    // Generate a unique signature for an exam
    const signature = `${exam.title.trim().toLowerCase()}::${exam.courseId || 'no-course'}::${exam.folderId || 'no-folder'}::${exam.schoolId || 'no-school'}`;
    
    if (seenExams.has(signature)) {
      duplicateExamIds.push(exam.id);
    } else {
      seenExams.add(signature);
    }
  }

  if (duplicateExamIds.length > 0) {
    console.log(`Found ${duplicateExamIds.length} duplicate exams. Deleting...`);
    // Delete in batches to avoid overwhelming the database
    for (let i = 0; i < duplicateExamIds.length; i += 50) {
      const batch = duplicateExamIds.slice(i, i + 50);
      const deletedExams = await prisma.exam.deleteMany({
        where: {
          id: { in: batch }
        }
      });
      totalExamsDeleted += deletedExams.count;
    }
    console.log(`Successfully deleted ${totalExamsDeleted} duplicate exams.`);
  } else {
    console.log("No duplicate exams found.");
  }

  // 2. Cleanup Duplicate Questions in remaining exams
  console.log("\n--- Phase 2: Cleaning up duplicate Questions ---");
  const remainingExams = await prisma.exam.findMany({
    select: { id: true, title: true }
  });

  for (const exam of remainingExams) {
    const questions = await prisma.question.findMany({
      where: { examId: exam.id },
      orderBy: { createdAt: 'asc' }
    });

    const seenText = new Set<string>();
    const duplicateQuestionIds: string[] = [];

    for (const q of questions) {
      // Normalize text to detect duplicates
      const normalized = q.text.trim().toLowerCase();
      // We will also use 'options' as part of the signature in case some questions have the same text but different options
      const signature = `${normalized}::${q.options}`;

      if (seenText.has(signature)) {
        duplicateQuestionIds.push(q.id);
      } else {
        seenText.add(signature);
      }
    }

    if (duplicateQuestionIds.length > 0) {
      const deletedQuestions = await prisma.question.deleteMany({
        where: {
          id: { in: duplicateQuestionIds }
        }
      });
      totalQuestionsDeleted += deletedQuestions.count;
      console.log(`Exam: "${exam.title}" - Deleted ${deletedQuestions.count} duplicate questions.`);
    }
  }

  if (totalQuestionsDeleted === 0) {
    console.log("No duplicate questions found.");
  } else {
    console.log(`Successfully deleted a total of ${totalQuestionsDeleted} duplicate questions.`);
  }

  console.log("\n=========================================");
  console.log(`Cleanup Complete!`);
  console.log(`Total Exams Deleted: ${totalExamsDeleted}`);
  console.log(`Total Questions Deleted: ${totalQuestionsDeleted}`);
  console.log("=========================================\n");
}

requireConfirmation()
  .then(() => main())
  .catch(e => {
    console.error("Error running script:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
