import { archiveCloudBatch, ArchiveEntry } from './cloudBackupArchive';
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
  console.log("[Backup] Cloud backup not configured; local backups will be used instead.");
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

async function compressBackupEntries(entries: ArchiveEntry[]): Promise<Buffer> {
  const archive = createArchive('zip', { zlib: { level: 6 } });
  const buffers: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => buffers.push(chunk));
    archive.on('error', reject);
    archive.on('warning', reject);
    archive.on('end', () => resolve(Buffer.concat(buffers)));
  });
  for (const entry of entries) archive.append(JSON.stringify(entry.data), { name: entry.id + '.json' });
  try {
    await Promise.all([archive.finalize(), completed]);
    return await completed;
  } catch (error) { archive.abort(); throw error; }
}

async function performCloudBackupCleanup() {
  if (!CLOUD_BACKUP_ENABLED) return;
  try { await archiveCloudBatch(pool, compressBackupEntries); }
  catch (error) { console.error('[Backup DB] Archive aborted; original records retained:', error); }
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
  if (!CLOUD_BACKUP_ENABLED) throw new Error('Cloud backup is disabled');
  await ensureTableExists();
  const result = await archiveCloudBatch(pool, compressBackupEntries, { minimum: 1, all: true });
  if (!result) throw new Error('No unarchived backups available, or another archive is running');
  return result;
}
