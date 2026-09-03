import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🤖 [Auto-Recover] Starting automatic slide recovery script...');

  // 1. Fetch all lessons currently in the database
  console.log('🤖 [Auto-Recover] Fetching active lessons from database...');
  const activeLessons = await prisma.lesson.findMany({
    select: { id: true, title: true, slides: true, courseId: true }
  });
  console.log(`🤖 [Auto-Recover] Found ${activeLessons.length} lessons in the active database.`);

  const activeLessonsMap = new Map(activeLessons.map(l => [l.id, l]));

  // 2. Identify potential backup files to scan
  const searchDirs = [
    process.cwd(), // Root directory
    path.join(process.cwd(), 'uploads', 'backups'), // backups subdirectory
    '/app', // Docker container root
    '/app/uploads/backups' // Docker backups directory
  ];

  const backupFiles: string[] = [];

  searchDirs.forEach(dir => {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          if (file.endsWith('.json') && (file.startsWith('backup-') || file.includes('backup'))) {
            const fullPath = path.join(dir, file);
            if (!backupFiles.includes(fullPath)) {
              backupFiles.push(fullPath);
            }
          }
        });
      }
    } catch (e) {
      // Skip directories that can't be read
    }
  });

  console.log(`🤖 [Auto-Recover] Found ${backupFiles.length} backup files to scan:`);
  backupFiles.forEach(f => console.log(`   - ${f}`));

  if (backupFiles.length === 0) {
    console.log('🤖 [Auto-Recover] No backup files found. Skipping recovery.');
    return;
  }

  let recoveryCount = 0;

  // 3. Scan each backup file for slides data
  for (const backupPath of backupFiles) {
    console.log(`\n🔍 [Auto-Recover] Scanning backup: ${backupPath}`);
    try {
      const content = fs.readFileSync(backupPath, 'utf8');
      const backupObj = JSON.parse(content);
      
      if (!backupObj || !backupObj.data || !Array.isArray(backupObj.data.lesson)) {
        console.log(`   ⚠️ Invalid backup format in ${backupPath}. Skipping.`);
        continue;
      }

      const backupLessons = backupObj.data.lesson;
      console.log(`   Found ${backupLessons.length} lessons in this backup.`);

      for (const backupLesson of backupLessons) {
        const activeLesson = activeLessonsMap.get(backupLesson.id);
        if (!activeLesson) {
          // If the lesson doesn't exist in the active database, we don't restore it automatically
          continue;
        }

        const fields = ['slides', 'questions', 'assignments', 'attachments'] as const;
        let lessonUpdated = false;
        let updatePayload: any = {};

        for (const field of fields) {
          // Parse active
          let activeCount = 0;
          try {
            const activeData = (typeof (activeLesson as any)[field] === 'string' ? JSON.parse((activeLesson as any)[field]) : (activeLesson as any)[field]) || [];
            activeCount = Array.isArray(activeData) ? activeData.length : 0;
          } catch (e) {}

          // Parse backup
          let backupCount = 0;
          let backupData: any = [];
          try {
            if (backupLesson[field]) {
              const parsedBackup = typeof backupLesson[field] === 'string' ? JSON.parse(backupLesson[field]) : backupLesson[field];
              backupCount = Array.isArray(parsedBackup) ? parsedBackup.length : 0;
              backupData = parsedBackup;
            }
          } catch (e) {}

          // Compare
          if (backupCount > activeCount) {
            console.log(`   ✨ [RECOVERABLE] Lesson "${activeLesson.title}" (${activeLesson.id}) - ${field}:`);
            console.log(`      Active: ${activeCount} | Backup: ${backupCount} (in ${path.basename(backupPath)})`);
            updatePayload[field] = backupData;
            (activeLesson as any)[field] = backupData;
            lessonUpdated = true;
          }
        }

        if (lessonUpdated) {
          console.log(`      💾 Restoring ${Object.keys(updatePayload).join(', ')} in database...`);
          await prisma.lesson.update({
            where: { id: activeLesson.id },
            data: updatePayload
          });
          recoveryCount++;
          console.log(`      ✅ Restored successfully!`);
        }
      }
    } catch (err: any) {
      console.error(`   ❌ Error reading/parsing backup ${backupPath}:`, err.message);
    }
  }

  console.log(`\n🤖 [Auto-Recover] Completed. Recovered/restored ${recoveryCount} lessons.`);
}

// ─── ENTRY POINT GUARD ───────────────────────────────────────────────────────
// Run manually ONLY: npx tsx src/scripts/auto-recover.ts
// Must NEVER run automatically on server startup or when imported.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  main()
    .catch((err) => console.error('🤖 [Auto-Recover] Critical Error:', err))
    .finally(async () => {
      await prisma.$disconnect();
      console.log('🤖 [Auto-Recover] Disconnected from database.\n');
    });
}
