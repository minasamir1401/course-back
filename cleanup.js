require('dotenv').config();
const { Pool } = require('pg');

const BACKUP_DB_URL = process.env.BACKUP_DB_URL || 'postgresql://postgres:uhaocsw57ovciofr@course-ba-ztcmbo:5432/postgres';

const pool = new Pool({
  connectionString: BACKUP_DB_URL,
});

async function cleanup() {
  try {
    console.log('🧹 [Backup DB] Starting cleanup of old backups...');
    const result = await pool.query('SELECT id, created_at FROM cloud_backups ORDER BY created_at DESC');
    const rows = result.rows;
    
    const toKeep = rows.slice(0, 100).map(r => r.id);
    const toDelete = rows.slice(100).map(r => r.id);
    
    if (toDelete.length > 0) {
      console.log(`🧹 [Backup DB] Keeping ${toKeep.length} backups. Deleting ${toDelete.length} backups...`);
      for (let i = 0; i < toDelete.length; i += 100) {
        const chunk = toDelete.slice(i, i + 100);
        const placeholders = chunk.map((_, idx) => '$' + (idx + 1)).join(',');
        await pool.query(`DELETE FROM cloud_backups WHERE id IN (${placeholders})`, chunk);
      }
      console.log('✅ [Backup DB] Cleanup complete!');
    } else {
      console.log('✅ [Backup DB] No backups needed cleanup.');
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  } finally {
    await pool.end();
  }
}

cleanup();
