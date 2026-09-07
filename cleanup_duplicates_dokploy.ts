/**
 * =========================================================================
 * 🛠️ MANUAL ADMINISTRATIVE MAINTENANCE TOOL: DUPLICATE CLEANUP
 * =========================================================================
 * ⚠️  IMPORTANT ARCHITECTURAL NOTES:
 * 1. This script is strictly a MANUAL administrative CLI tool.
 * 2. It is NOT invoked by Dokploy, Dockerfile, package.json scripts, or any CI/CD hook.
 * 3. All operations perform SAFE SOFT-DELETE (setting `deletedAt = new Date()`).
 *    NO DATA IS PERMANENTLY REMOVED; items remain safely recoverable in Recycle Bin.
 * 4. Usage:
 *    - Dry run / preview: npx tsx cleanup_duplicates_dokploy.ts --preview
 *    - Interactive apply: npx tsx cleanup_duplicates_dokploy.ts (requires typing DELETE_DUPLICATES)
 *    - Non-interactive apply: npx tsx cleanup_duplicates_dokploy.ts --apply
 * =========================================================================
 */
import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--preview');
const hasApplyFlag = process.argv.includes('--apply') || process.argv.includes('--force');

async function requireConfirmation(): Promise<void> {
  if (isDryRun) {
    console.log('🔍 Running in PREVIEW / DRY-RUN mode. No changes will be made.');
    return;
  }

  if (hasApplyFlag) {
    console.log('⚡ Running with --apply flag. Proceeding with safe soft-delete...');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      '\n⚠️  WARNING: This script will SOFT-DELETE (move to Recycle Bin) duplicate exams and questions.\n' +
      '   Type exactly "DELETE_DUPLICATES" to proceed, or run with --preview for dry run:\n> ',
      (answer) => {
        rl.close();
        if (answer.trim() !== 'DELETE_DUPLICATES') {
          console.log('❌ Cancelled. No data was modified.');
          process.exit(0);
        }
        resolve();
      }
    );
  });
}

async function main() {
  console.log("=========================================");
  console.log(`Starting Duplicates Cleanup [${isDryRun ? 'DRY-RUN / PREVIEW' : 'SAFE SOFT-DELETE'}]...`);
  console.log("=========================================\n");

  let totalExamsSoftDeleted = 0;
  let totalQuestionsSoftDeleted = 0;

  // 1. Cleanup Duplicate Exams
  console.log("--- Phase 1: Scanning duplicate Exams ---");
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
    const signature = `${exam.title.trim().toLowerCase()}::${exam.courseId || 'no-course'}::${exam.folderId || 'no-folder'}::${exam.schoolId || 'no-school'}`;
    
    if (seenExams.has(signature)) {
      duplicateExamIds.push(exam.id);
    } else {
      seenExams.add(signature);
    }
  }

  if (duplicateExamIds.length > 0) {
    console.log(`Found ${duplicateExamIds.length} duplicate active exams.`);
    if (!isDryRun) {
      for (let i = 0; i < duplicateExamIds.length; i += 50) {
        const batch = duplicateExamIds.slice(i, i + 50);
        const updated = await prisma.exam.updateMany({
          where: { id: { in: batch }, deletedAt: null },
          data: { deletedAt: new Date() }
        });
        totalExamsSoftDeleted += updated.count;
      }
      console.log(`Successfully soft-deleted ${totalExamsSoftDeleted} duplicate exams (moved to recycle bin).`);
    } else {
      console.log(`[Preview] Would soft-delete ${duplicateExamIds.length} duplicate exams.`);
    }
  } else {
    console.log("No duplicate exams found.");
  }

  // 2. Cleanup Duplicate Questions in remaining active exams
  console.log("\n--- Phase 2: Scanning duplicate Questions ---");
  const remainingExams = await prisma.exam.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true }
  });

  for (const exam of remainingExams) {
    const questions = await prisma.question.findMany({
      where: { examId: exam.id, deletedAt: null },
      orderBy: { createdAt: 'asc' }
    });

    const seenText = new Set<string>();
    const duplicateQuestionIds: string[] = [];

    for (const q of questions) {
      const normalized = q.text.trim().toLowerCase();
      const signature = `${normalized}::${q.options}`;

      if (seenText.has(signature)) {
        duplicateQuestionIds.push(q.id);
      } else {
        seenText.add(signature);
      }
    }

    if (duplicateQuestionIds.length > 0) {
      if (!isDryRun) {
        const updated = await prisma.question.updateMany({
          where: { id: { in: duplicateQuestionIds }, deletedAt: null },
          data: { deletedAt: new Date() }
        });
        totalQuestionsSoftDeleted += updated.count;
        console.log(`Exam: "${exam.title}" - Soft-deleted ${updated.count} duplicate questions.`);
      } else {
        console.log(`[Preview] Exam: "${exam.title}" - Would soft-delete ${duplicateQuestionIds.length} duplicate questions.`);
        totalQuestionsSoftDeleted += duplicateQuestionIds.length;
      }
    }
  }

  if (totalQuestionsSoftDeleted === 0) {
    console.log("No duplicate questions found.");
  } else if (!isDryRun) {
    console.log(`Successfully soft-deleted a total of ${totalQuestionsSoftDeleted} duplicate questions.`);
  }

  console.log("\n=========================================");
  console.log(`Cleanup Scan Complete!`);
  console.log(`Total Exams ${isDryRun ? 'Identified' : 'Soft-Deleted'}: ${duplicateExamIds.length}`);
  console.log(`Total Questions ${isDryRun ? 'Identified' : 'Soft-Deleted'}: ${totalQuestionsSoftDeleted}`);
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
