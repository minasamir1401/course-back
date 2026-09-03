import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const jsonPath = process.argv[2];
  
  if (!jsonPath) {
    console.error('❌ Please provide the path to final_cleaned_website_backup.json as an argument.');
    console.error('Usage: npx ts-node src/scripts/apply-cleaned-data.ts <path-to-json>');
    process.exit(1);
  }

  const fullPath = path.resolve(jsonPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`🧹 APPLYING CLEANED DATABASE BACKUP`);
  console.log(`======================================================\n`);
  
  console.log(`📂 Loading data from: ${fullPath}...`);
  const fileData = fs.readFileSync(fullPath, 'utf8');
  const backup = JSON.parse(fileData);
  
  const questions = backup.data?.question || [];
  const lessonBlocks = backup.data?.lessonBlock || [];

  console.log(`✅ Loaded ${questions.length} questions and ${lessonBlocks.length} slides.`);
  console.log(`\n⏳ Updating database...\n`);

  let qUpdated = 0;
  for (const q of questions) {
    if (!q.id) continue;
    try {
      await prisma.question.update({
        where: { id: q.id },
        data: {
          text: q.text,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          skill: q.skill,
          level: q.level,
          indicator: q.indicator,
          standard: q.standard,
          learningOutcome: q.learningOutcome,
          dok: q.dok
        }
      });
      qUpdated++;
      if (qUpdated % 100 === 0) console.log(`   ...Updated ${qUpdated} questions`);
    } catch (err: any) {
      if (err.code !== 'P2025') { // Ignore RecordNotFound
        console.error(`   ❌ Failed to update question ${q.id}: ${err.message}`);
      }
    }
  }
  
  console.log(`✅ Successfully updated ${qUpdated} questions.`);

  let sUpdated = 0;
  for (const slide of lessonBlocks) {
    if (!slide.id) continue;
    try {
      await prisma.lessonBlock.update({
        where: { id: slide.id },
        data: {
          title: slide.title,
          content: slide.content,
          type: slide.type,
          order: slide.order
        }
      });
      sUpdated++;
      if (sUpdated % 50 === 0) console.log(`   ...Updated ${sUpdated} slides`);
    } catch (err: any) {
      if (err.code !== 'P2025') {
        console.error(`   ❌ Failed to update slide ${slide.id}: ${err.message}`);
      }
    }
  }

  console.log(`✅ Successfully updated ${sUpdated} slides.`);

  console.log(`\n======================================================`);
  console.log(`🎉 ALL DONE! Your database is now cleaned and updated.`);
  console.log(`======================================================\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
