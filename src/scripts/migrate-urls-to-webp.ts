import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Directory where uploads are stored on the server
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

/**
 * Extracts the filename from an upload URL and checks if its .webp version exists on disk.
 * SAFE: only returns true if the webp file actually exists.
 */
function webpExistsForUrl(url: string): boolean {
  try {
    // Extract filename from URL like https://api.klevro.tech/uploads/image.png
    const match = url.match(/\/uploads\/([^"'\s?]+)/);
    if (!match) return false;
    const filename = match[1];
    const ext = path.extname(filename).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) return false;
    const webpFilename = filename.substring(0, filename.lastIndexOf('.')) + '.webp';
    const webpPath = path.join(UPLOADS_DIR, webpFilename);
    return fs.existsSync(webpPath);
  } catch {
    return false;
  }
}

/**
 * Safely replaces a single URL string: only if the webp file exists.
 */
function safeReplaceUrl(url: string): string {
  if (webpExistsForUrl(url)) {
    return url.replace(/\.(png|jpg|jpeg)(?=["'<\s]|$)/i, '.webp');
  }
  return url;
}

/**
 * Scans a text (HTML / plain) and replaces all upload URLs that have a webp counterpart.
 */
function replaceInText(text: string | null | undefined): string | null {
  if (!text) return text as any;
  // Match any upload URL ending with an image extension
  return text.replace(
    /(https?:\/\/[^\s"'<]*\/uploads\/[^\s"'<]+\.(png|jpg|jpeg))/gi,
    (match) => safeReplaceUrl(match)
  );
}

/**
 * Recursively scans JSON objects/arrays and replaces upload URLs.
 */
function replaceInJSON(value: any): any {
  if (!value) return value;
  if (typeof value === 'string') return replaceInText(value);
  if (Array.isArray(value)) return value.map(replaceInJSON);
  if (typeof value === 'object') {
    const result: any = {};
    for (const key in value) result[key] = replaceInJSON(value[key]);
    return result;
  }
  return value;
}

async function migrateUrlsToWebP() {
  console.log('🚀 Starting SAFE DB migration to WebP URLs...');
  console.log(`📁 Checking WebP files in: ${UPLOADS_DIR}`);

  let stats = { courses: 0, users: 0, questions: 0, lessons: 0, blocks: 0, sections: 0 };

  // ── 1. Courses ──────────────────────────────────────────────
  const courses = await prisma.course.findMany({ select: { id: true, coverImage: true } });
  for (const c of courses) {
    const newVal = replaceInText(c.coverImage);
    if (newVal !== c.coverImage) {
      await prisma.course.update({ where: { id: c.id }, data: { coverImage: newVal } });
      stats.courses++;
    }
  }
  console.log(`✅ Courses updated: ${stats.courses}`);

  // ── 2. Users ─────────────────────────────────────────────────
  const users = await prisma.user.findMany({ select: { id: true, avatar: true } });
  for (const u of users) {
    const newVal = replaceInText(u.avatar);
    if (newVal !== u.avatar) {
      await prisma.user.update({ where: { id: u.id }, data: { avatar: newVal } });
      stats.users++;
    }
  }
  console.log(`✅ Users updated: ${stats.users}`);

  // ── 3. Questions ──────────────────────────────────────────────
  const questions = await prisma.question.findMany({
    select: { id: true, imageUrl: true, text: true, explanation: true }
  });
  for (const q of questions) {
    const newImageUrl = replaceInText(q.imageUrl);
    const newText = replaceInText(q.text);
    const newExplanation = replaceInText(q.explanation);
    if (newImageUrl !== q.imageUrl || newText !== q.text || newExplanation !== q.explanation) {
      await prisma.question.update({
        where: { id: q.id },
        data: {
          imageUrl: newImageUrl ?? undefined,
          text: newText ?? q.text,
          explanation: newExplanation ?? undefined
        }
      });
      stats.questions++;
    }
  }
  console.log(`✅ Questions updated: ${stats.questions}`);

  // ── 4. Lessons ────────────────────────────────────────────────
  const lessons = await prisma.lesson.findMany();
  for (const l of lessons) {
    let changed = false;
    const newContent = replaceInText(l.content);
    const newNotes = replaceInText(l.notes);
    const newSummary = replaceInText(l.summary);
    let newSlides = l.slides, newQuestions = l.questions;
    let newAttachments = l.attachments, newAssignments = l.assignments;

    if (newContent !== l.content) changed = true;
    if (newNotes !== l.notes) changed = true;
    if (newSummary !== l.summary) changed = true;

    if (l.slides) {
      const p = replaceInJSON(l.slides);
      if (JSON.stringify(p) !== JSON.stringify(l.slides)) { newSlides = p; changed = true; }
    }
    if (l.questions) {
      const p = replaceInJSON(l.questions);
      if (JSON.stringify(p) !== JSON.stringify(l.questions)) { newQuestions = p; changed = true; }
    }
    if (l.attachments) {
      const p = replaceInJSON(l.attachments);
      if (JSON.stringify(p) !== JSON.stringify(l.attachments)) { newAttachments = p; changed = true; }
    }
    if (l.assignments) {
      const p = replaceInJSON(l.assignments);
      if (JSON.stringify(p) !== JSON.stringify(l.assignments)) { newAssignments = p; changed = true; }
    }

    if (changed) {
      await prisma.lesson.update({
        where: { id: l.id },
        data: {
          content: newContent, notes: newNotes, summary: newSummary,
          slides: newSlides ?? undefined, questions: newQuestions ?? undefined,
          attachments: newAttachments ?? undefined, assignments: newAssignments ?? undefined
        }
      });
      stats.lessons++;
    }
  }
  console.log(`✅ Lessons updated: ${stats.lessons}`);

  // ── 5. Lesson Blocks ──────────────────────────────────────────
  const blocks = await prisma.lessonBlock.findMany({ select: { id: true, content: true, options: true } });
  for (const b of blocks) {
    let changed = false;
    const newContent = replaceInText(b.content);
    let newOptions = b.options;

    if (newContent !== b.content) changed = true;
    if (b.options) {
      try {
        const opts = replaceInJSON(JSON.parse(b.options));
        const strOpts = JSON.stringify(opts);
        if (strOpts !== b.options) { newOptions = strOpts; changed = true; }
      } catch {
        const direct = replaceInText(b.options);
        if (direct !== b.options) { newOptions = direct; changed = true; }
      }
    }

    if (changed) {
      await prisma.lessonBlock.update({
        where: { id: b.id },
        data: { content: newContent, options: newOptions }
      });
      stats.blocks++;
    }
  }
  console.log(`✅ Lesson blocks updated: ${stats.blocks}`);

  // ── 6. Dynamic Sections ───────────────────────────────────────
  const sections = await prisma.dynamicSection.findMany({ select: { id: true, content: true } });
  for (const s of sections) {
    const newContent = replaceInText(s.content);
    if (newContent !== null && newContent !== undefined && newContent !== s.content) {
      await prisma.dynamicSection.update({ where: { id: s.id }, data: { content: newContent } });
      stats.sections++;
    }
  }
  console.log(`✅ Dynamic sections updated: ${stats.sections}`);

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  console.log(`\n🎉 Migration complete! Total records updated: ${total}`);
  console.log(`   Breakdown:`, stats);
}

migrateUrlsToWebP()
  .catch((e) => { console.error('❌ Migration failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
