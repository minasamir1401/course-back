// @ts-ignore
import { Pool } from 'pg';
import prisma from './prisma';
import * as archiverLib from 'archiver';
import * as dotenv from 'dotenv';

dotenv.config();

const archiverObj = (archiverLib as any).default || archiverLib;

function createArchive(format: any, options?: any) {
  const archiver = require('archiver');
  if (format === 'zip' && archiver.ZipArchive) {
    return new archiver.ZipArchive(options);
  }
  // Fallback for older archiver versions if applicable
  if (typeof archiver === 'function') {
    return archiver(format, options);
  } else if (archiver && typeof archiver.create === 'function') {
    return archiver.create(format, options);
  } else if (typeof archiver.default === 'function') {
    return archiver.default(format, options);
  }
  throw new Error('Could not instantiate archiver.');
};

const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
if (!BACKUP_DB_URL && process.env.ENABLE_CLOUD_BACKUP === 'true') {
  console.error("❌ BACKUP_DB_URL is not set in environment variables");
}

// Cloud backup is opt-in so a secondary database outage cannot affect LMS availability.
export const CLOUD_BACKUP_ENABLED = process.env.ENABLE_CLOUD_BACKUP === 'true' && Boolean(BACKUP_DB_URL);

const pool = CLOUD_BACKUP_ENABLED ? new Pool({
  connectionString: BACKUP_DB_URL,
  // Increase connection limits and timeouts to prevent exhaustion and crashes
  max: 20,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000, // Increased from 2000 to 15000 (15 seconds) to handle slow cloud DB handshakes
}) : ({
  query: async () => ({ rows: [], rowCount: 0 }),
  on: () => {},
  end: async () => {}
} as any);

pool.on('error', (err: Error) => {
  console.error('❌ [Backup DB] Unexpected error on idle client', err);
});

export interface CloudBackupRecord {
  id?: string;
  name: string;
  type: string;
  data: any;
  created_at?: string;
}

/**
 * Ensures the cloud_backups table exists
 */
async function ensureTableExists() {
  if (!BACKUP_DB_URL) return;
  const query = `
    CREATE TABLE IF NOT EXISTS cloud_backups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(query);
  } catch (err) {
    console.error('❌ [Backup DB] Error ensuring table exists:', err);
  }
}

let isArchivingInProgress = false;

async function performCloudBackupCleanup() {
  if (!BACKUP_DB_URL) return;
  if (isArchivingInProgress) return;
  isArchivingInProgress = true;
  try {
    console.log('🧹 [Backup DB] Checking if we need to archive backups...');
    
    // Fetch all backups that are not ARCHIVE and not REALTIME_SYNC, ordered by oldest first
    const result = await pool.query(`SELECT id, name, created_at FROM cloud_backups WHERE type != 'ARCHIVE' AND type != 'REALTIME_SYNC' ORDER BY created_at ASC`);
    const rows = result.rows;

    if (rows.length >= 50) {
      console.log(`📦 [Backup DB] Found ${rows.length} unarchived backups. Archiving the oldest 50...`);
      
      const chunk = rows.slice(0, 50);
      const chunkIds = chunk.map((r: any) => r.id);
      
      // Get date range
      const startDate = new Date(chunk[0].created_at);
      const endDate = new Date(chunk[chunk.length - 1].created_at);
      
      const formatNum = (num: number) => num.toString().padStart(2, '0');
      const formatDate = (d: Date) => d.toLocaleString('en-CA', { timeZone: 'Africa/Cairo', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/,/, '');
      
      const archiveName = `مجمع اخر 50 ساعة من ${formatDate(startDate)} إلى ${formatDate(endDate)}`;
      
      // Create zip asynchronously without blocking the event loop
      const buffers: Buffer[] = [];
      const archive = createArchive('zip', {
        zlib: { level: 9 } // maximum compression
      });

      archive.on('data', (data: any) => {
        buffers.push(data);
      });

      archive.on('error', (err: any) => {
        console.error('❌ [Backup DB] Archiver error:', err);
        isArchivingInProgress = false;
      });

      archive.on('end', async () => {
        try {
          const zipBuffer = Buffer.concat(buffers);
          const base64Data = zipBuffer.toString('base64');
          
          // Save archive
          const insertQuery = `
            INSERT INTO cloud_backups (name, type, data)
            VALUES ($1, $2, $3)
            RETURNING id;
          `;
          const archiveJson = {
            isArchive: true,
            compression: 'zip',
            fileBase64: base64Data,
            count: 50
          };
          
          await pool.query(insertQuery, [archiveName, 'ARCHIVE', JSON.stringify(archiveJson)]);
          console.log(`✅ [Backup DB] Successfully created archive: ${archiveName}`);
          
          // Delete the 50 backups
          const placeholders = chunkIds.map((_: any, idx: number) => '$' + (idx + 1)).join(',');
          await pool.query(`DELETE FROM cloud_backups WHERE id IN (${placeholders})`, chunkIds);
          console.log(`🗑️ [Backup DB] Deleted the 50 archived individual backups.`);
          
          // Catch up if there are still more than 50 remaining, with a delay
          if (rows.length >= 100) {
             setTimeout(() => performCloudBackupCleanup(), 5000);
          } else {
             isArchivingInProgress = false;
          }
        } catch (e) {
          console.error('❌ [Backup DB] Error saving archive:', e);
          isArchivingInProgress = false;
        }
      });

      // Append files asynchronously
      for (const r of chunk) {
            try {
              const dataRes = await pool.query(`SELECT data FROM cloud_backups WHERE id = $1`, [r.id]);
              if (dataRes.rows.length > 0 && dataRes.rows[0].data) {
                archive.append(JSON.stringify(dataRes.rows[0].data), { name: r.name + '.json' });
              }
            } catch (err: any) {
              console.error(`❌ [Backup DB] Failed to fetch/append data for ${r.name}:`, err.message);
            }
          }
          archive.finalize();
    } else {
      console.log(`✅ [Backup DB] Only ${rows.length} unarchived backups found. Waiting for 50.`);
      isArchivingInProgress = false;
    }
  } catch (err) {
    console.error('❌ [Backup DB] Error during cleanup/archiving:', err);
    isArchivingInProgress = false;
  }
}

// Ensure table exists on startup, then cleanup
if (CLOUD_BACKUP_ENABLED) {
  ensureTableExists().then(() => {
    performCloudBackupCleanup();
  });
}

export async function saveToCloudBackup(name: string, type: string, data: any) {
  if (!CLOUD_BACKUP_ENABLED) return null;
  try {
    const query = `
      INSERT INTO cloud_backups (name, type, data)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const result = await pool.query(query, [name, type, JSON.stringify(data)]);
    // Trigger cleanup asynchronously after save
    performCloudBackupCleanup().catch(console.error);
    return result.rows[0];
  } catch (err) {
    console.error('[Backup DB] Exception during saveToCloudBackup:', err);
    return null;
  }
}

export async function getCloudBackups(type?: string) {
  if (!CLOUD_BACKUP_ENABLED) return [];
  try {
    let query = `
      SELECT id, name, type, created_at, pg_column_size(data) as size 
      FROM cloud_backups 
    `;
    const values: any[] = [];
    
    if (type) {
      query += ` WHERE type = $1 `;
      values.push(type);
    }
    
    query += ` ORDER BY created_at ASC;`;
    
    const result = await pool.query(query, values);
    return result.rows || [];
  } catch (err) {
    console.error('[Backup DB] Exception during getCloudBackups:', err);
    return [];
  }
}

export async function getCloudBackupById(id: string) {
  if (!CLOUD_BACKUP_ENABLED) return null;
  try {
    const query = `SELECT * FROM cloud_backups WHERE id = $1 LIMIT 1;`;
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  } catch (err) {
    console.error('[Backup DB] Exception during getCloudBackupById:', err);
    return null;
  }
}

export async function deleteCloudBackups(ids: string[]) {
  if (!CLOUD_BACKUP_ENABLED) return false;
  if (!ids || ids.length === 0) return true;
  try {
    // Generate placeholders $1, $2, etc.
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const query = `DELETE FROM cloud_backups WHERE id IN (${placeholders});`;
    await pool.query(query, ids);
    return true;
  } catch (err) {
    console.error('[Backup DB] Exception during deleteCloudBackups:', err);
    return false;
  }
}

// In-memory cache for cloud courses
let _cloudCoursesCacheRef: { data: any[]; timestamp: number } | null = null;
const CLOUD_COURSES_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export async function getLatestCloudCourses(): Promise<any[]> {
  if (!CLOUD_BACKUP_ENABLED) return [];
  if (_cloudCoursesCacheRef && (Date.now() - _cloudCoursesCacheRef.timestamp) < CLOUD_COURSES_CACHE_TTL) {
    return _cloudCoursesCacheRef.data;
  }

  try {
    const query = `
      SELECT data, created_at, type 
      FROM cloud_backups 
      WHERE type = 'REALTIME_SYNC' 
      ORDER BY created_at DESC 
      LIMIT 5;
    `;
    const result = await pool.query(query);
    const data = result.rows;

    if (!data || data.length === 0) {
      _cloudCoursesCacheRef = { data: [], timestamp: Date.now() };
      return [];
    }

    for (const record of data) {
      const payload = record.data;
      if (payload && payload.data && Array.isArray(payload.data.course) && payload.data.course.length > 0) {
        _cloudCoursesCacheRef = { data: payload.data.course, timestamp: Date.now() };
        return payload.data.course;
      }
      if (payload && Array.isArray(payload.course) && payload.course.length > 0) {
        _cloudCoursesCacheRef = { data: payload.course, timestamp: Date.now() };
        return payload.course;
      }
    }

    const latest = data[0].data;
    if (latest && latest.data && Array.isArray(latest.data.course)) {
      _cloudCoursesCacheRef = { data: latest.data.course, timestamp: Date.now() };
      return latest.data.course;
    }
    if (latest && Array.isArray(latest.course)) {
      _cloudCoursesCacheRef = { data: latest.course, timestamp: Date.now() };
      return latest.course;
    }
    
    _cloudCoursesCacheRef = { data: [], timestamp: Date.now() };
    return [];
  } catch (err) {
    console.error('[Backup DB] Exception during getLatestCloudCourses:', err);
    _cloudCoursesCacheRef = { data: [], timestamp: Date.now() };
    return [];
  }
}

export function invalidateCloudCoursesCache() {
  _cloudCoursesCacheRef = null;
}

export function getCloudCoursesIfCached(): any[] | null {
  if (_cloudCoursesCacheRef && (Date.now() - _cloudCoursesCacheRef.timestamp) < CLOUD_COURSES_CACHE_TTL) {
    return _cloudCoursesCacheRef.data;
  }
  return null;
}

export function prefetchCloudCoursesInBackground(): void {
  getLatestCloudCourses().catch(() => {});
}

// No longer needed, but keeping signature so imports don't break
export async function keepCloudBackupAlive(): Promise<void> {
  if (!CLOUD_BACKUP_ENABLED) return;
  // Ping our own PostgreSQL database to keep connection pool fresh
  try {
    await pool.query('SELECT 1;');
  } catch (err) {
    console.error(`❌ [Backup DB] Keep-alive ping failed:`, err);
  }
}

export async function syncCourseToCloud(courseId: string) {
  // Disabled per user request: Prevent creating backup entries every few minutes on course edit.
  // The automated hourly backup system handles full system snapshots cleanly every 60 minutes.
  return;
}

export async function syncAllCoursesToCloud(reason: string = "Manual Sync") {
  // Disabled per user request: Prevent creating backup entries every few minutes.
  return;
}

export async function syncMissingCloudCourses() {
  try {
    const cloudCourses = await getLatestCloudCourses();
    if (!cloudCourses || cloudCourses.length === 0) return;

    for (const c of cloudCourses) {
      if (!c || !c.id) continue;
      
      const localCourse = await prisma.course.findUnique({ where: { id: c.id } });
      if (localCourse) continue; 

      console.log(`[Backup DB Sync] Restoring missing course from backup: ${c.title}`);
      
      await prisma.course.create({
        data: {
          id: c.id,
          title: c.title,
          description: c.description ?? null,
          coverImage: c.coverImage ?? null,
          grade: c.grade ?? null,
          grades: c.grades ?? null,
          subject: c.subject ?? null,
          country: c.country || 'مصر',
          isCentral: c.isCentral ?? true,
          schoolId: c.schoolId ?? null,
          createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
          updatedAt: c.updatedAt ? new Date(c.updatedAt) : new Date(),
          
          lessons: c.lessons && c.lessons.length > 0 ? {
            create: c.lessons.map((l: any) => ({
              id: l.id,
              title: l.title,
              content: l.content ?? '',
              videoUrl: l.videoUrl ?? null,
              duration: l.duration ?? null,
              slides: l.slides ?? null,
              assignments: l.assignments ?? null,
              questions: l.questions ?? null,
              learningOutcomes: l.learningOutcomes ?? null,
              isCentral: l.isCentral ?? true,
              isVisible: l.isVisible ?? true,
              order: l.order ?? 0,
              createdAt: l.createdAt ? new Date(l.createdAt) : new Date(),
              updatedAt: l.updatedAt ? new Date(l.updatedAt) : new Date(),
            }))
          } : undefined,
          
          exams: c.exams && c.exams.length > 0 ? {
             create: c.exams.map((e: any) => ({
               id: e.id,
               title: e.title,
               description: e.description ?? null,
               durationMinutes: e.durationMinutes ?? 60,
               passingScore: e.passingScore ?? 50,
               isCentral: e.isCentral ?? true,
               isActive: e.isActive ?? true,
               questions: e.questions && e.questions.length > 0 ? {
                 create: e.questions.map((q: any) => ({
                   id: q.id,
                   questionText: q.questionText,
                   type: q.type ?? 'MULTIPLE_CHOICE',
                   options: q.options ?? null,
                   correctAnswer: q.correctAnswer ?? '',
                   points: q.points ?? 1
                 }))
               } : undefined
             }))
          } : undefined
        }
      });
      console.log(`✅ [Backup DB Sync] Successfully imported missing course: ${c.title}`);
    }
  } catch (err: any) {
    console.error(`❌ [Backup DB Sync] Error importing missing courses: ${err.message}`);
  }
}

export async function createManualBundle() {
  await ensureTableExists();
  
  // Fetch ALL unarchived non-sync backups (no limit)
  const result = await pool.query(`SELECT id, name, created_at FROM cloud_backups WHERE type != 'ARCHIVE' AND type != 'REALTIME_SYNC' ORDER BY created_at ASC`);
  const rows = result.rows;

  if (rows.length === 0) {
    throw new Error("لا يوجد نسخ فردية لجمعها");
  }

  const startDate = new Date(rows[0].created_at);
  const endDate = new Date(rows[rows.length - 1].created_at);
  
  const formatNum = (num: number) => num.toString().padStart(2, '0');
  const formatDate = (d: Date) => d.toLocaleString('en-CA', { timeZone: 'Africa/Cairo', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/,/, '');
  
  const archiveName = `مجمع يدوي من ${formatDate(startDate)} إلى ${formatDate(endDate)}`;
  
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];
    const archive = createArchive('zip', {
      zlib: { level: 9 }
    });

    archive.on('data', (data: any) => {
      buffers.push(data);
    });

    archive.on('error', (err: any) => {
      reject(err);
    });

    archive.on('end', async () => {
      try {
        const zipBuffer = Buffer.concat(buffers);
        const base64Data = zipBuffer.toString('base64');
        
        const insertQuery = `
          INSERT INTO cloud_backups (name, type, data)
          VALUES ($1, $2, $3)
          RETURNING id;
        `;
        const archiveJson = {
          isArchive: true,
          compression: 'zip',
          fileBase64: base64Data,
          count: rows.length
        };
        
        await pool.query(insertQuery, [archiveName, 'ARCHIVE', archiveJson]);
        resolve({ success: true, archiveName });
      } catch (err) {
        reject(err);
      }
    });

    let idx = 0;
    async function processNext() {
      if (idx < rows.length) {
        const r = rows[idx];
        try {
          const dataRes = await pool.query(`SELECT data FROM cloud_backups WHERE id = $1`, [r.id]);
          if (dataRes.rows.length > 0 && dataRes.rows[0].data) {
            const dataObj = dataRes.rows[0].data;
            const stringified = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj);
            archive.append(stringified, { name: r.name.endsWith('.json') ? r.name : `${r.name}.json` });
          }
        } catch (err: any) {
          console.error(`❌ [Backup DB] Failed to fetch/append data for ${r.name}:`, err.message);
        }
        idx++;
        setImmediate(processNext);
      } else {
        archive.finalize();
      }
    }
    processNext();
  });
}
