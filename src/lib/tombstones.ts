/**
 * ============================================================
 * 🔒 TOMBSTONES — Persistent Deletion Markers
 * ============================================================
 * Stores explicit user-deletion markers in PostgreSQL so that
 * the auto-recovery script (recover-deleted-lessons.ts) never
 * re-creates items that were intentionally deleted — even after
 * a Dokploy container redeploy (which would wipe local files).
 *
 * Falls back to a local JSON file ONLY if the DB is unreachable,
 * so startup is never blocked by a tombstone lookup failure.
 * ============================================================
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Re-use existing Prisma singleton when imported from the server context,
// but create a short-lived client when used from the standalone recovery script.
let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

// ── Local-file fallback (used only when DB is unreachable) ─────────────────
const FALLBACK_FILE = path.join(process.cwd(), 'uploads', 'deleted_tombstones.json');

interface TombstoneStore {
  lessons: Record<string, { deletedAt: string; title?: string }>;
  courses: Record<string, { deletedAt: string; title?: string }>;
}

function loadFallback(): TombstoneStore {
  try {
    if (fs.existsSync(FALLBACK_FILE)) {
      const raw = fs.readFileSync(FALLBACK_FILE, 'utf-8');
      const p = JSON.parse(raw);
      return { lessons: p.lessons || {}, courses: p.courses || {} };
    }
  } catch { /* ignore */ }
  return { lessons: {}, courses: {} };
}

function saveFallback(store: TombstoneStore) {
  try { fs.writeFileSync(FALLBACK_FILE, JSON.stringify(store, null, 2), 'utf-8'); } catch { /* ignore */ }
}

// ── DB helpers ─────────────────────────────────────────────────────────────

async function dbMarkDeleted(type: 'lesson' | 'course', id: string, title?: string) {
  await getPrisma().deletedTombstone.upsert({
    where: { entityType_entityId: { entityType: type, entityId: id } },
    create: { entityType: type, entityId: id, entityTitle: title },
    update: { entityTitle: title, deletedAt: new Date() },
  });
}

async function dbIsDeleted(type: 'lesson' | 'course', id: string): Promise<boolean> {
  const row = await getPrisma().deletedTombstone.findUnique({
    where: { entityType_entityId: { entityType: type, entityId: id } },
    select: { id: true },
  });
  return !!row;
}

async function dbUnmark(type: 'lesson' | 'course', id: string) {
  await getPrisma().deletedTombstone.deleteMany({
    where: { entityType: type, entityId: id },
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Record that a lesson was explicitly deleted by the user. */
export async function recordDeletedLesson(id: string, title?: string) {
  try {
    await dbMarkDeleted('lesson', id, title);
    console.log(`🔒 [Tombstone] Marked lesson "${title || id}" as EXPLICITLY DELETED (DB).`);
  } catch (err: any) {
    console.warn(`⚠️ [Tombstone] DB unavailable, using fallback file: ${err.message}`);
    const store = loadFallback();
    store.lessons[id] = { deletedAt: new Date().toISOString(), title };
    saveFallback(store);
  }
}

/** Record that a course was explicitly deleted by the user. */
export async function recordDeletedCourse(id: string, title?: string) {
  try {
    await dbMarkDeleted('course', id, title);
    console.log(`🔒 [Tombstone] Marked course "${title || id}" as EXPLICITLY DELETED (DB).`);
  } catch (err: any) {
    console.warn(`⚠️ [Tombstone] DB unavailable, using fallback file: ${err.message}`);
    const store = loadFallback();
    store.courses[id] = { deletedAt: new Date().toISOString(), title };
    saveFallback(store);
  }
}

/** Check if a lesson was explicitly deleted by the user. */
export async function isLessonDeleted(id: string): Promise<boolean> {
  try {
    return await dbIsDeleted('lesson', id);
  } catch (err: any) {
    console.warn(`⚠️ [Tombstone] DB unavailable, checking fallback: ${err.message}`);
    return !!loadFallback().lessons[id];
  }
}

/** Check if a course was explicitly deleted by the user. */
export async function isCourseDeleted(id: string): Promise<boolean> {
  try {
    return await dbIsDeleted('course', id);
  } catch (err: any) {
    console.warn(`⚠️ [Tombstone] DB unavailable, checking fallback: ${err.message}`);
    return !!loadFallback().courses[id];
  }
}

/** Remove lesson from tombstones (e.g. when user explicitly restores it). */
export async function unmarkLessonDeleted(id: string) {
  try {
    await dbUnmark('lesson', id);
    console.log(`🔓 [Tombstone] Unmarked lesson ${id} from deleted list.`);
  } catch (err: any) {
    console.warn(`⚠️ [Tombstone] DB unavailable for unmark: ${err.message}`);
    const store = loadFallback();
    delete store.lessons[id];
    saveFallback(store);
  }
}

/** Remove course from tombstones (e.g. when user explicitly restores it). */
export async function unmarkCourseDeleted(id: string) {
  try {
    await dbUnmark('course', id);
    console.log(`🔓 [Tombstone] Unmarked course ${id} from deleted list.`);
  } catch (err: any) {
    console.warn(`⚠️ [Tombstone] DB unavailable for unmark: ${err.message}`);
    const store = loadFallback();
    delete store.courses[id];
    saveFallback(store);
  }
}
