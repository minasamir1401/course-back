// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const PORT = process.env.PORT || 3001;
const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

async function processString(str: any): Promise<any> {
  if (!str || typeof str !== 'string') return str;
  const regex = /<img[^>]*src="data:image\/[^"]+"[^>]*>/g;
  const matches = [...str.matchAll(regex)];
  
  if (matches.length === 0) {
    return str;
  }
  
  let newStr = str;
  for (const match of matches) {
    const fullMatch = match[0];
    newStr = newStr.replace(fullMatch, "");
    console.log(`    [-] Deleted base64 image completely.`);
  }

  return newStr;
}

async function migrate() {
  console.log("🚀 Starting Base64 to Server File Migration...");

  // 1. Courses
  console.log("\nMigrating Courses...");
  const courses = await prisma.course.findMany();
  for (const course of courses) {
    const updatedCover = await processString(course.coverImage);
    const updatedDesc = await processString(course.description);
    if (updatedCover !== course.coverImage || updatedDesc !== course.description) {
      await prisma.course.update({
        where: { id: course.id },
        data: { coverImage: updatedCover, description: updatedDesc }
      });
      console.log(`  -> Updated Course: ${course.id}`);
    }
  }

  // 2. Lessons
  console.log("\nMigrating Lessons...");
  const lessons = await prisma.lesson.findMany();
  for (const lesson of lessons) {
    const updatedContent = await processString(lesson.content);
    const updatedQuestions = await processString(lesson.questions);
    const updatedSlides = await processString(lesson.slides);
    const updatedAssignments = await processString(lesson.assignments);
    
    if (updatedContent !== lesson.content || updatedQuestions !== lesson.questions || 
        updatedSlides !== lesson.slides || updatedAssignments !== lesson.assignments) {
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { 
          content: updatedContent, 
          questions: updatedQuestions, 
          slides: updatedSlides, 
          assignments: updatedAssignments 
        }
      });
      console.log(`  -> Updated Lesson: ${lesson.id}`);
    }
  }

  // 3. Exams
  console.log("\nMigrating Exams...");
  const exams = await prisma.exam.findMany();
  for (const exam of exams) {
    const updatedDesc = await processString(exam.description);
    if (updatedDesc !== exam.description) {
      await prisma.exam.update({
        where: { id: exam.id },
        data: { description: updatedDesc }
      });
      console.log(`  -> Updated Exam: ${exam.id}`);
    }
  }

  // 4. Questions
  console.log("\nMigrating Questions...");
  const questions = await prisma.question.findMany();
  for (const q of questions) {
    const updatedText = await processString(q.text);
    const updatedOptions = await processString(q.options);
    const updatedExplanation = await processString(q.explanation);
    const updatedImageUrl = await processString(q.imageUrl);
    
    if (updatedText !== q.text || updatedOptions !== q.options || 
        updatedExplanation !== q.explanation || updatedImageUrl !== q.imageUrl) {
      await prisma.question.update({
        where: { id: q.id },
        data: { 
          text: updatedText, 
          options: updatedOptions, 
          explanation: updatedExplanation, 
          imageUrl: updatedImageUrl 
        }
      });
      console.log(`  -> Updated Question: ${q.id}`);
    }
  }

  // 5. LessonBlocks
  console.log("\nMigrating LessonBlocks...");
  const blocks = await prisma.lessonBlock.findMany();
  for (const block of blocks) {
    const updatedContent = await processString(block.content);
    const updatedOptions = await processString(block.options);
    
    if (updatedContent !== block.content || updatedOptions !== block.options) {
      await prisma.lessonBlock.update({
        where: { id: block.id },
        data: { content: updatedContent, options: updatedOptions }
      });
      console.log(`  -> Updated LessonBlock: ${block.id}`);
    }
  }

  // 6. DynamicSections
  console.log("\nMigrating DynamicSections...");
  const sections = await prisma.dynamicSection.findMany();
  for (const sec of sections) {
    const updatedContent = await processString(sec.content);
    
    if (updatedContent !== sec.content) {
      await prisma.dynamicSection.update({
        where: { id: sec.id },
        data: { content: updatedContent }
      });
      console.log(`  -> Updated DynamicSection: ${sec.id}`);
    }
  }

  console.log("\n✅ Migration completed successfully!");
}

migrate()
  .catch(e => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
