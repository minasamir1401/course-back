// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const PORT = process.env.PORT || 3001;
const baseUrl = process.env.BASE_URL || `https://api.klevro.tech`;

async function processString(str: any): Promise<any> {
  if (!str || typeof str !== 'string') return str;
  const regex = /data:image\/([a-zA-Z0-9+.\-]+);base64,([^"'\s\\]+)/g;
  const matches = [...str.matchAll(regex)];
  
  if (matches.length === 0 && (!process.env.BASE_URL || !str.includes('http://localhost:'))) {
    return str;
  }
  
  let newStr = str;
  for (const match of matches) {
    const fullMatch = match[0];
    const ext = match[1];
    const base64Data = match[2];
    
    const filename = `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const destPath = path.join(UPLOADS_DIR, filename);
    
    try {
      fs.writeFileSync(destPath, Buffer.from(base64Data, 'base64'));
      const newUrl = `${baseUrl}/uploads/${filename}`;
      newStr = newStr.replace(fullMatch, newUrl);
      console.log(`    [+] Migrated image: ${filename}`);
    } catch (e) {
      console.error(`    [-] Error saving image:`, e);
    }
  }

  // Also replace any accidentally saved localhost URLs if we have a real BASE_URL
  const finalBaseUrl = process.env.BASE_URL || `https://api.klevro.tech`;
  const localHostRegex = /http:\/\/localhost:\d+/g;
  newStr = newStr.replace(localHostRegex, finalBaseUrl);

  return newStr;
}

async function processValue(value: any): Promise<any> {
  if (typeof value === 'string') {
    return processString(value);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map(item => processValue(item)));
  }

  if (value && typeof value === 'object') {
    const output: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = await processValue(nested);
    }
    return output;
  }

  return value;
}

export async function runBase64AutoMigration() {
  console.log("🚀 [Auto-Migration] Starting Base64 to Server File Migration...");

  // 1. Courses
  console.log("[Auto-Migration] Checking Courses...");
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
  console.log("[Auto-Migration] Checking Lessons...");
  const lessons = await prisma.lesson.findMany();
  for (const lesson of lessons) {
    const updatedContent = await processString(lesson.content);
    const updatedQuestions = await processValue(lesson.questions);
    const updatedSlides = await processValue(lesson.slides);
    const updatedAssignments = await processValue(lesson.assignments);
    const updatedAttachments = await processValue(lesson.attachments);
    
    if (updatedContent !== lesson.content || updatedQuestions !== lesson.questions || 
        updatedSlides !== lesson.slides || updatedAssignments !== lesson.assignments ||
        updatedAttachments !== lesson.attachments) {
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { 
          content: updatedContent, 
          questions: updatedQuestions, 
          slides: updatedSlides, 
          assignments: updatedAssignments,
          attachments: updatedAttachments
        }
      });
      console.log(`  -> Updated Lesson: ${lesson.id}`);
    }
  }

  // 3. Exams
  console.log("[Auto-Migration] Checking Exams...");
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
  console.log("[Auto-Migration] Checking Questions...");
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
  console.log("[Auto-Migration] Checking LessonBlocks...");
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
  console.log("[Auto-Migration] Checking DynamicSections...");
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

  console.log("✅ [Auto-Migration] Base64 image migration check completed.");
}

if (require.main === module) {
  runBase64AutoMigration()
    .catch(e => {
      console.error("Migration failed:", e);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
