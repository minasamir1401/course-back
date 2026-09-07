import cron from 'node-cron';
import { CLOUD_BACKUP_ENABLED } from '../lib/db-backup';
import { performBackupAndPruning } from '../controllers/backups.controller';

let isRunningHourlyCron = false;

/** Hourly and manual backups use the same consistent, complete, paginated snapshot. */
export async function runHourlyCloudBackupJob() {
  if (isRunningHourlyCron) return;
  isRunningHourlyCron = true;
  try {
    const result = await performBackupAndPruning();
    console.log(`[Cron Service] Full snapshot saved: ${result.filename}`);
  } catch (error) {
    console.error('[Cron Service] Full backup failed:', error);
  } finally { isRunningHourlyCron = false; }
}

export function initCronJobs() {
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') return;
  cron.schedule('0 * * * *', runHourlyCloudBackupJob);
  console.log('[Cron Service] Hourly full backup scheduler initialized.');
  if (!CLOUD_BACKUP_ENABLED) console.log('[Cron Service] Cloud backup disabled; snapshots are local only.');
}
