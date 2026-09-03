import * as fs from 'fs';
import * as path from 'path';

const BACKUP_DIR = 'd:\\pj\\porj\\corse\\New folder';
const OUTPUT_FILE = path.join(process.cwd(), 'restored_exams_clean.json');

// Helper to count how many question marks are in an object (recursively or by JSON string)
function countQuestionMarks(obj: any): number {
  if (!obj) return 0;
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const matches = str.match(/\?/g);
  return matches ? matches.length : 0;
}

// Deep clean: replace 3 or more ? with an empty string, or some pattern
function cleanQuestionMarks(str: string): string {
  if (!str) return str;
  // Replace 3 or more question marks with a space
  return str.replace(/\?{3,}/g, ' ');
}

// Recursively clean object strings
function cleanObject(obj: any): any {
  if (typeof obj === 'string') {
    return cleanQuestionMarks(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanObject);
  }
  if (obj !== null && typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = cleanObject(obj[key]);
    }
    return newObj;
  }
  return obj;
}

async function generateCleanExams() {
  console.log(`📂 Scanning backup directory: ${BACKUP_DIR}`);
  if (!fs.existsSync(BACKUP_DIR)) {
    console.error(`❌ Directory not found: ${BACKUP_DIR}`);
    return;
  }

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      name: f,
      fullPath: path.join(BACKUP_DIR, f),
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
    }))
    .sort((a, b) => b.mtime - a.mtime); // Newest first

  console.log(`📄 Found ${files.length} backup files.`);

  const bestExams = new Map<string, any>();
  const examScores = new Map<string, number>();

  for (const file of files) {
    try {
      const raw = fs.readFileSync(file.fullPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const data = parsed.data || parsed;
      const backupExams: any[] = Array.isArray(data.exam) ? data.exam : [];

      for (const e of backupExams) {
        if (!e || !e.id) continue;

        const currentScore = countQuestionMarks(e);
        
        if (!bestExams.has(e.id)) {
          bestExams.set(e.id, e);
          examScores.set(e.id, currentScore);
        } else {
          // If this version has FEWER question marks, it means it's an older/cleaner version
          const previousBestScore = examScores.get(e.id)!;
          if (currentScore < previousBestScore) {
            bestExams.set(e.id, e);
            examScores.set(e.id, currentScore);
          }
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠ Skipped ${file.name}: ${err.message}`);
    }
  }

  console.log(`✅ Extracted ${bestExams.size} unique exams with best possible texts.`);

  // Clean remaining ?
  const cleanedExams = Array.from(bestExams.values()).map(e => cleanObject(e));

  // Save to output file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ exam: cleanedExams }, null, 2), 'utf-8');
  console.log(`🎉 Success! Saved clean exams to: ${OUTPUT_FILE}`);
}

generateCleanExams().catch(console.error);
