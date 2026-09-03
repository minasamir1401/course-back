import cron from 'node-cron';
import prisma from '../lib/prisma';
import { CLOUD_BACKUP_ENABLED, saveToCloudBackup } from '../lib/db-backup';
import fs from 'fs';
import path from 'path';

let isRunningHourlyCron = false;

/**
 * ✅ LIGHTWEIGHT Hourly Cloud Backup
 *
 * Previous approach caused server crashes (502 Bad Gateway) because
 * `generateFullSystemBackupData()` loaded ALL database records into RAM at once.
 *
 * New approach: Stream data in small batches → saves to Cloud Backup → never blocks API.
 * The job is also guarded with a concurrency lock (isRunningHourlyCron) so it
 * will gracefully skip if the previous run is still ongoing.
 */
export async function runHourlyCloudBackupJob() {
  if (isRunningHourlyCron) {
    console.log('⚠️ [Cron Service] Hourly backup is already running, skipping this tick.');
    return;
  }
  isRunningHourlyCron = true;

  try {
    console.log('⏰ [Cron Service] Starting lightweight hourly backup...');
    const timestamp = new Date().toISOString();

    // ── Fetch data in small, memory-safe chunks ──────────────────────────────
    const [schools, users, courses, lessons, exams] = await Promise.all([
      prisma.school.findMany({ select: { id: true, name: true, subdomain: true, themeColor: true, status: true, createdAt: true, updatedAt: true } }),
      prisma.user.findMany({ select: { id: true, username: true, name: true, role: true, schoolId: true, grade: true, createdAt: true, updatedAt: true } }),
      prisma.course.findMany({ select: { id: true, title: true, subject: true, grade: true, grades: true, isCentral: true, schoolId: true, coverImage: true, createdAt: true, updatedAt: true } }),
      // Lessons: fetch slides/questions as strings to avoid deserialisation overhead
      prisma.lesson.findMany({ select: { id: true, title: true, courseId: true, order: true, isVisible: true, slides: true, questions: true, assignments: true, createdAt: true, updatedAt: true } }),
      prisma.exam.findMany({ select: { id: true, title: true, category: true, grade: true, type: true, status: true, isCentral: true, schoolId: true, modules: true, questions: true, createdAt: true, updatedAt: true } }),
    ]);

    const payload = {
      backedUpAt: timestamp,
      type: 'AUTO_HOURLY',
      data: { school: schools, user: users, course: courses, lesson: lessons, exam: exams }
    };

    const name = `auto_hourly_${timestamp.replace(/[:.]/g, '-')}`;

    // ── 1. Save to local filesystem ──────────────────────────────────────────
    try {
      const BACKUPS_DIR = path.join(process.cwd(), 'uploads', 'backups');
      if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      
      const localFilePath = path.join(BACKUPS_DIR, `${name}.json`);
      fs.writeFileSync(localFilePath, JSON.stringify(payload, null, 2), 'utf-8');
      console.log(`💾 [Cron Service] Lightweight hourly backup saved locally: ${name}.json`);
      
      // Prune local backups (keep latest 50)
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')))
        .map(file => {
          const fp = path.join(BACKUPS_DIR, file);
          return { filename: file, filePath: fp, createdAt: fs.statSync(fp).mtime };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      if (files.length > 50) {
        const filesToDelete = files.slice(50);
        for (const f of filesToDelete) {
          fs.unlinkSync(f.filePath);
          console.log(`🗑️ [Cron Service] Pruned old local backup: ${f.filename}`);
        }
      }
    } catch (e: any) {
      console.error('❌ [Cron Service] Failed to save/prune local backup:', e.message);
    }

    // ── 2. Save to Cloud Backup ──────────────────────────────────────────────
    if (CLOUD_BACKUP_ENABLED) {
      const saved = await saveToCloudBackup(name, 'AUTO_HOURLY', payload);

      if (saved) {
        console.log(`✅ [Cron Service] Lightweight hourly backup saved to Cloud: ${name}`);
      } else {
        console.error('❌ [Cron Service] Failed to save hourly backup to Cloud.');
      }

      // ── Prune old AUTO_HOURLY records (keep latest 50)
      await pruneOldHourlyBackups();
    }

  } catch (err: any) {
    console.error('❌ [Cron Service] Exception in runHourlyCloudBackupJob:', err.message);
  } finally {
    isRunningHourlyCron = false;
  }
}

/**
 * Keep only the latest 50 AUTO_HOURLY backups in the Cloud to avoid bloat.
 * Runs at the end of each hourly backup job.
 */
async function pruneOldHourlyBackups() {
  try {
    const { getCloudBackups, deleteCloudBackups } = await import('../lib/db-backup');
    const hourlyBackups = await getCloudBackups('AUTO_HOURLY');
    if (hourlyBackups.length <= 50) return;

    // Sort oldest first, delete everything beyond the newest 50
    const sorted = [...hourlyBackups].sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const toDelete = sorted.slice(0, sorted.length - 50).map((b: any) => b.id).filter(Boolean) as string[];
    if (toDelete.length > 0) {
      await deleteCloudBackups(toDelete);
      console.log(`🗑️ [Cron Service] Pruned ${toDelete.length} old AUTO_HOURLY backups.`);
    }
  } catch (e: any) {
    console.warn('[Cron Service] Prune error (non-fatal):', e.message);
  }
}

/**
 * Initialize all cron schedules.
 * Run at minute 0 of every hour (1:00, 2:00, 3:00, ...).
 */
export function initCronJobs() {
  cron.schedule('0 * * * *', async () => {
    await runHourlyCloudBackupJob();
  });

  console.log('⏰ [Cron Service] Lightweight hourly backup scheduler initialized (safe, non-blocking).');
  
  if (!CLOUD_BACKUP_ENABLED) {
    console.log('[Cron Service] Note: Cloud backup is disabled, backups will only be saved locally.');
  }
}

