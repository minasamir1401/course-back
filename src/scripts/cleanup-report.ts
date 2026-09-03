import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaClient();
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const REPORT_PATH = path.join(UPLOADS_DIR, 'cleanup-report.txt');

// ── Hash file for duplicate detection ────────────────────────────────────────
function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

// ── Collect all referenced filenames from DB ─────────────────────────────────
function extractFilenames(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(/\/uploads\/([^\s"'<>?]+)/g) || [];
  return matches.map(m => path.basename(m.split('?')[0]));
}

function extractFromJSON(value: any): string[] {
  if (!value) return [];
  if (typeof value === 'string') return extractFilenames(value);
  if (Array.isArray(value)) return value.flatMap(extractFromJSON);
  if (typeof value === 'object') return Object.values(value).flatMap(extractFromJSON);
  return [];
}

async function collectUsedFilenames(): Promise<Set<string>> {
  const used = new Set<string>();

  const courses = await prisma.course.findMany({ select: { coverImage: true } });
  courses.forEach(c => extractFilenames(c.coverImage).forEach(f => used.add(f)));

  const users = await prisma.user.findMany({ select: { avatar: true } });
  users.forEach(u => extractFilenames(u.avatar).forEach(f => used.add(f)));

  const questions = await prisma.question.findMany({ select: { imageUrl: true, text: true, explanation: true } });
  questions.forEach(q => {
    extractFilenames(q.imageUrl).forEach(f => used.add(f));
    extractFilenames(q.text).forEach(f => used.add(f));
    extractFilenames(q.explanation).forEach(f => used.add(f));
  });

  const lessons = await prisma.lesson.findMany({
    select: { content: true, notes: true, summary: true, slides: true, questions: true, attachments: true, assignments: true }
  });
  lessons.forEach(l => {
    extractFilenames(l.content).forEach(f => used.add(f));
    extractFilenames(l.notes).forEach(f => used.add(f));
    extractFilenames(l.summary).forEach(f => used.add(f));
    extractFromJSON(l.slides).forEach(f => used.add(f));
    extractFromJSON(l.questions).forEach(f => used.add(f));
    extractFromJSON(l.attachments).forEach(f => used.add(f));
    extractFromJSON(l.assignments).forEach(f => used.add(f));
  });

  const blocks = await prisma.lessonBlock.findMany({ select: { content: true, options: true } });
  blocks.forEach(b => {
    extractFilenames(b.content).forEach(f => used.add(f));
    try { extractFromJSON(JSON.parse(b.options || '{}')).forEach(f => used.add(f)); } catch {}
  });

  const sections = await prisma.dynamicSection.findMany({ select: { content: true } });
  sections.forEach(s => extractFilenames(s.content).forEach(f => used.add(f)));

  return used;
}

async function generateReport() {
  console.log('🔍 Scanning uploads folder and database...');
  const usedFilenames = await collectUsedFilenames();
  console.log(`📊 Found ${usedFilenames.size} unique filenames referenced in DB`);

  const allFiles = fs.readdirSync(UPLOADS_DIR).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.mp4', '.gif'].includes(ext);
  });
  console.log(`📁 Found ${allFiles.length} files in uploads folder`);

  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg'];

  // ── Hash all files for duplicate detection ───────────────────────────────────
  console.log('🔄 Hashing files for duplicate detection...');
  const hashMap = new Map<string, string[]>(); // hash → [filenames]
  for (const filename of allFiles) {
    const filepath = path.join(UPLOADS_DIR, filename);
    try {
      const hash = hashFile(filepath);
      if (!hashMap.has(hash)) hashMap.set(hash, []);
      hashMap.get(hash)!.push(filename);
    } catch {}
  }

  // Files that are duplicates (same content, different names)
  const duplicateGroups: string[][] = [];
  const duplicateFiles = new Set<string>(); // all files that are duplicates of something
  for (const [, group] of hashMap.entries()) {
    if (group.length > 1) {
      duplicateGroups.push(group);
      group.forEach(f => duplicateFiles.add(f));
    }
  }

  type FileEntry = { filename: string; size: number; sizeKB: string; status: string; reason: string; dupGroup?: string };

  const toDelete: FileEntry[] = [];
  const toKeep: FileEntry[] = [];
  const processedDupGroups = new Set<string>();

  for (const filename of allFiles) {
    const filepath = path.join(UPLOADS_DIR, filename);
    const stat = fs.statSync(filepath);
    const sizeKB = (stat.size / 1024).toFixed(1) + ' KB';
    const ext = path.extname(filename).toLowerCase();
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    const webpPath = path.join(UPLOADS_DIR, nameWithoutExt + '.webp');
    const isImage = IMAGE_EXTS.includes(ext);
    const hasWebP = isImage && fs.existsSync(webpPath);
    const isUsed = usedFilenames.has(filename);
    const isWebP = ext === '.webp';

    // Check if this file is a duplicate
    let hash = '';
    try { hash = hashFile(filepath); } catch {}
    const dupGroup = hash ? hashMap.get(hash) || [] : [];
    const isDupOf = dupGroup.length > 1 ? dupGroup : null;

    if (isWebP) {
      toKeep.push({ filename, size: stat.size, sizeKB, status: 'KEEP', reason: 'WebP - ملف أساسي' });
    } else if (isImage && hasWebP && !isUsed) {
      toDelete.push({ filename, size: stat.size, sizeKB, status: 'DELETE_OLD', reason: 'تحول لـ WebP وتحدث الرابط في DB' });
    } else if (isImage && hasWebP && isUsed) {
      toKeep.push({ filename, size: stat.size, sizeKB, status: 'KEEP', reason: 'رابطه لا زال في DB' });
    } else if (!isUsed) {
      toDelete.push({ filename, size: stat.size, sizeKB, status: 'DELETE_UNUSED', reason: 'غير مستخدم في قاعدة البيانات' });
    } else {
      toKeep.push({ filename, size: stat.size, sizeKB, status: 'KEEP', reason: 'مستخدم في DB' });
    }
  }

  // ── Identify duplicates among the files to KEEP (used WebP files) ─────────
  // Find duplicate WebP files that are referenced in DB
  const webpHashMap = new Map<string, string[]>();
  for (const f of toKeep.filter(f => path.extname(f.filename).toLowerCase() === '.webp')) {
    const filepath = path.join(UPLOADS_DIR, f.filename);
    try {
      const hash = hashFile(filepath);
      if (!webpHashMap.has(hash)) webpHashMap.set(hash, []);
      webpHashMap.get(hash)!.push(f.filename);
    } catch {}
  }
  const duplicateWebpGroups: string[][] = [];
  for (const [, group] of webpHashMap.entries()) {
    if (group.length > 1) duplicateWebpGroups.push(group);
  }

  // ── Calculate sizes ───────────────────────────────────────────────────────
  const totalSizeToFree = toDelete.reduce((sum, f) => sum + f.size, 0);
  const totalSizeMB = (totalSizeToFree / 1024 / 1024).toFixed(2);
  const dupSizeMB = (duplicateWebpGroups.reduce((sum, g) => {
    return sum + g.slice(1).reduce((s, f) => {
      try { return s + fs.statSync(path.join(UPLOADS_DIR, f)).size; } catch { return s; }
    }, 0);
  }, 0) / 1024 / 1024).toFixed(2);

  const oldPng = toDelete.filter(f => f.status === 'DELETE_OLD');
  const unused = toDelete.filter(f => f.status === 'DELETE_UNUSED');

  // ── Build Report ─────────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push('📊 تقرير تنظيف الصور - Cleanup Report');
  lines.push(`📅 التاريخ: ${new Date().toLocaleString('ar-EG')}`);
  lines.push('='.repeat(80));
  lines.push('');
  lines.push(`📁 إجمالي الملفات في uploads:       ${allFiles.length}`);
  lines.push(`🗑️  ملفات يمكن حذفها (قديمة/غير مستخدمة): ${toDelete.length}`);
  lines.push(`♊  مجموعات ملفات مكررة (WebP):      ${duplicateWebpGroups.length}`);
  lines.push(`✅ ملفات يجب الاحتفاظ بها:           ${toKeep.length}`);
  lines.push(`💾 مساحة ستتحرر من الحذف:            ${totalSizeMB} MB`);
  lines.push(`💾 مساحة إضافية من حذف المكررات:     ${dupSizeMB} MB`);
  lines.push(`💾 إجمالي المساحة الممكن توفيرها:    ${(parseFloat(totalSizeMB) + parseFloat(dupSizeMB)).toFixed(2)} MB`);
  lines.push('');

  // Section 1: Old PNG/JPG
  lines.push('─'.repeat(80));
  lines.push(`🗑️  [${oldPng.length}] صور PNG/JPG قديمة تحولت لـ WebP:`);
  lines.push('─'.repeat(80));
  oldPng.forEach((f, i) => {
    lines.push(`  ${String(i + 1).padStart(4, '0')}. ${f.filename.padEnd(58, ' ')} ${f.sizeKB}`);
  });

  // Section 2: Unused
  lines.push('');
  lines.push('─'.repeat(80));
  lines.push(`🗑️  [${unused.length}] ملفات غير مستخدمة في قاعدة البيانات:`);
  lines.push('─'.repeat(80));
  unused.forEach((f, i) => {
    lines.push(`  ${String(i + 1).padStart(4, '0')}. ${f.filename.padEnd(58, ' ')} ${f.sizeKB}`);
  });

  // Section 3: Duplicates
  lines.push('');
  lines.push('─'.repeat(80));
  lines.push(`♊  [${duplicateWebpGroups.length}] مجموعات ملفات مكررة تماماً (نفس المحتوى):`);
  lines.push('─'.repeat(80));
  lines.push('   (يمكن الاحتفاظ بواحد فقط من كل مجموعة وحذف الباقي)');
  lines.push('');
  duplicateWebpGroups.forEach((group, i) => {
    const groupSizeKB = group.slice(1).reduce((s, f) => {
      try { return s + fs.statSync(path.join(UPLOADS_DIR, f)).size / 1024; } catch { return s; }
    }, 0).toFixed(1);
    lines.push(`  مجموعة ${i + 1} (توفير ${groupSizeKB} KB بحذف النسخ الزائدة):`);
    group.forEach((f, fi) => {
      const sizeKB = (() => { try { return (fs.statSync(path.join(UPLOADS_DIR, f)).size / 1024).toFixed(1) + ' KB'; } catch { return '?'; } })();
      const tag = fi === 0 ? '  ✅ KEEP  ' : '  🗑️ DUP   ';
      lines.push(`    ${tag} ${f.padEnd(55, ' ')} ${sizeKB}`);
    });
    lines.push('');
  });

  lines.push('='.repeat(80));
  lines.push('⚠️  لتنفيذ الحذف الفعلي، شغّل: npm run cleanup:delete');
  lines.push('='.repeat(80));

  const reportContent = lines.join('\n');
  fs.writeFileSync(REPORT_PATH, reportContent, 'utf-8');

  console.log('\n' + reportContent);
  console.log(`\n✅ تم حفظ التقرير في: ${REPORT_PATH}`);
  console.log(`🌐 يمكنك رؤيته على: https://api.klevro.tech/uploads/cleanup-report.txt`);
}

generateReport()
  .catch(e => { console.error('❌ خطأ:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
