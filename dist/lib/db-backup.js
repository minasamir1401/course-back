"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOUD_BACKUP_ENABLED = void 0;
exports.saveToCloudBackup = saveToCloudBackup;
exports.getCloudBackups = getCloudBackups;
exports.getCloudBackupById = getCloudBackupById;
exports.deleteCloudBackups = deleteCloudBackups;
exports.getLatestCloudCourses = getLatestCloudCourses;
exports.invalidateCloudCoursesCache = invalidateCloudCoursesCache;
exports.getCloudCoursesIfCached = getCloudCoursesIfCached;
exports.prefetchCloudCoursesInBackground = prefetchCloudCoursesInBackground;
exports.keepCloudBackupAlive = keepCloudBackupAlive;
exports.syncCourseToCloud = syncCourseToCloud;
exports.syncAllCoursesToCloud = syncAllCoursesToCloud;
exports.syncMissingCloudCourses = syncMissingCloudCourses;
exports.createManualBundle = createManualBundle;
const cloudBackupArchive_1 = require("./cloudBackupArchive");
// @ts-ignore
const pg_1 = require("pg");
const prisma_1 = __importDefault(require("./prisma"));
const archiverLib = __importStar(require("archiver"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const archiverObj = archiverLib.default || archiverLib;
function createArchive(format, options) {
    const archiver = require('archiver');
    if (format === 'zip' && archiver.ZipArchive) {
        return new archiver.ZipArchive(options);
    }
    // Fallback for older archiver versions if applicable
    if (typeof archiver === 'function') {
        return archiver(format, options);
    }
    else if (archiver && typeof archiver.create === 'function') {
        return archiver.create(format, options);
    }
    else if (typeof archiver.default === 'function') {
        return archiver.default(format, options);
    }
    throw new Error('Could not instantiate archiver.');
}
;
const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
if (!BACKUP_DB_URL && process.env.ENABLE_CLOUD_BACKUP === 'true') {
    console.log("[Backup] Cloud backup not configured; local backups will be used instead.");
}
// Cloud backup is opt-in so a secondary database outage cannot affect LMS availability.
exports.CLOUD_BACKUP_ENABLED = process.env.ENABLE_CLOUD_BACKUP === 'true' && Boolean(BACKUP_DB_URL);
const pool = exports.CLOUD_BACKUP_ENABLED ? new pg_1.Pool({
    connectionString: BACKUP_DB_URL,
    // Increase connection limits and timeouts to prevent exhaustion and crashes
    max: 20,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 15000, // Increased from 2000 to 15000 (15 seconds) to handle slow cloud DB handshakes
}) : {
    query: () => __awaiter(void 0, void 0, void 0, function* () { return ({ rows: [], rowCount: 0 }); }),
    on: () => { },
    end: () => __awaiter(void 0, void 0, void 0, function* () { })
};
pool.on('error', (err) => {
    console.error('❌ [Backup DB] Unexpected error on idle client', err);
});
/**
 * Ensures the cloud_backups table exists
 */
function ensureTableExists() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!BACKUP_DB_URL)
            return;
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
            yield pool.query(query);
        }
        catch (err) {
            console.error('❌ [Backup DB] Error ensuring table exists:', err);
        }
    });
}
function compressBackupEntries(entries) {
    return __awaiter(this, void 0, void 0, function* () {
        const archive = createArchive('zip', { zlib: { level: 6 } });
        const buffers = [];
        const completed = new Promise((resolve, reject) => {
            archive.on('data', (chunk) => buffers.push(chunk));
            archive.on('error', reject);
            archive.on('warning', reject);
            archive.on('end', () => resolve(Buffer.concat(buffers)));
        });
        for (const entry of entries)
            archive.append(JSON.stringify(entry.data), { name: entry.id + '.json' });
        try {
            yield Promise.all([archive.finalize(), completed]);
            return yield completed;
        }
        catch (error) {
            archive.abort();
            throw error;
        }
    });
}
function performCloudBackupCleanup() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!exports.CLOUD_BACKUP_ENABLED)
            return;
        try {
            yield (0, cloudBackupArchive_1.archiveCloudBatch)(pool, compressBackupEntries);
        }
        catch (error) {
            console.error('[Backup DB] Archive aborted; original records retained:', error);
        }
    });
}
// Ensure table exists on startup, then cleanup
if (exports.CLOUD_BACKUP_ENABLED) {
    ensureTableExists().then(() => {
        performCloudBackupCleanup();
    });
}
function saveToCloudBackup(name, type, data) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!exports.CLOUD_BACKUP_ENABLED)
            return null;
        try {
            const query = `
      INSERT INTO cloud_backups (name, type, data)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
            const result = yield pool.query(query, [name, type, JSON.stringify(data)]);
            // Trigger cleanup asynchronously after save
            performCloudBackupCleanup().catch(console.error);
            return result.rows[0];
        }
        catch (err) {
            console.error('[Backup DB] Exception during saveToCloudBackup:', err);
            return null;
        }
    });
}
function getCloudBackups(type) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!exports.CLOUD_BACKUP_ENABLED)
            return [];
        try {
            let query = `
      SELECT id, name, type, created_at, pg_column_size(data) as size 
      FROM cloud_backups 
    `;
            const values = [];
            if (type) {
                query += ` WHERE type = $1 `;
                values.push(type);
            }
            query += ` ORDER BY created_at ASC;`;
            const result = yield pool.query(query, values);
            return result.rows || [];
        }
        catch (err) {
            console.error('[Backup DB] Exception during getCloudBackups:', err);
            return [];
        }
    });
}
function getCloudBackupById(id) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!exports.CLOUD_BACKUP_ENABLED)
            return null;
        try {
            const query = `SELECT * FROM cloud_backups WHERE id = $1 LIMIT 1;`;
            const result = yield pool.query(query, [id]);
            return result.rows[0] || null;
        }
        catch (err) {
            console.error('[Backup DB] Exception during getCloudBackupById:', err);
            return null;
        }
    });
}
function deleteCloudBackups(ids) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!exports.CLOUD_BACKUP_ENABLED)
            return false;
        if (!ids || ids.length === 0)
            return true;
        try {
            // Generate placeholders $1, $2, etc.
            const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
            const query = `DELETE FROM cloud_backups WHERE id IN (${placeholders});`;
            yield pool.query(query, ids);
            return true;
        }
        catch (err) {
            console.error('[Backup DB] Exception during deleteCloudBackups:', err);
            return false;
        }
    });
}
// In-memory cache for cloud courses
let _cloudCoursesCacheRef = null;
const CLOUD_COURSES_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
function getLatestCloudCourses() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!exports.CLOUD_BACKUP_ENABLED)
            return [];
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
            const result = yield pool.query(query);
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
        }
        catch (err) {
            console.error('[Backup DB] Exception during getLatestCloudCourses:', err);
            _cloudCoursesCacheRef = { data: [], timestamp: Date.now() };
            return [];
        }
    });
}
function invalidateCloudCoursesCache() {
    _cloudCoursesCacheRef = null;
}
function getCloudCoursesIfCached() {
    if (_cloudCoursesCacheRef && (Date.now() - _cloudCoursesCacheRef.timestamp) < CLOUD_COURSES_CACHE_TTL) {
        return _cloudCoursesCacheRef.data;
    }
    return null;
}
function prefetchCloudCoursesInBackground() {
    getLatestCloudCourses().catch(() => { });
}
// No longer needed, but keeping signature so imports don't break
function keepCloudBackupAlive() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!exports.CLOUD_BACKUP_ENABLED)
            return;
        // Ping our own PostgreSQL database to keep connection pool fresh
        try {
            yield pool.query('SELECT 1;');
        }
        catch (err) {
            console.error(`❌ [Backup DB] Keep-alive ping failed:`, err);
        }
    });
}
function syncCourseToCloud(courseId) {
    return __awaiter(this, void 0, void 0, function* () {
        // Disabled per user request: Prevent creating backup entries every few minutes on course edit.
        // The automated hourly backup system handles full system snapshots cleanly every 60 minutes.
        return;
    });
}
function syncAllCoursesToCloud() {
    return __awaiter(this, arguments, void 0, function* (reason = "Manual Sync") {
        // Disabled per user request: Prevent creating backup entries every few minutes.
        return;
    });
}
function syncMissingCloudCourses() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        try {
            const cloudCourses = yield getLatestCloudCourses();
            if (!cloudCourses || cloudCourses.length === 0)
                return;
            for (const c of cloudCourses) {
                if (!c || !c.id)
                    continue;
                const localCourse = yield prisma_1.default.course.findUnique({ where: { id: c.id } });
                if (localCourse)
                    continue;
                console.log(`[Backup DB Sync] Restoring missing course from backup: ${c.title}`);
                yield prisma_1.default.course.create({
                    data: {
                        id: c.id,
                        title: c.title,
                        description: (_a = c.description) !== null && _a !== void 0 ? _a : null,
                        coverImage: (_b = c.coverImage) !== null && _b !== void 0 ? _b : null,
                        grade: (_c = c.grade) !== null && _c !== void 0 ? _c : null,
                        grades: (_d = c.grades) !== null && _d !== void 0 ? _d : null,
                        subject: (_e = c.subject) !== null && _e !== void 0 ? _e : null,
                        country: c.country || 'مصر',
                        isCentral: (_f = c.isCentral) !== null && _f !== void 0 ? _f : true,
                        schoolId: (_g = c.schoolId) !== null && _g !== void 0 ? _g : null,
                        createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
                        updatedAt: c.updatedAt ? new Date(c.updatedAt) : new Date(),
                        lessons: c.lessons && c.lessons.length > 0 ? {
                            create: c.lessons.map((l) => {
                                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                                return ({
                                    id: l.id,
                                    title: l.title,
                                    content: (_a = l.content) !== null && _a !== void 0 ? _a : '',
                                    videoUrl: (_b = l.videoUrl) !== null && _b !== void 0 ? _b : null,
                                    duration: (_c = l.duration) !== null && _c !== void 0 ? _c : null,
                                    slides: (_d = l.slides) !== null && _d !== void 0 ? _d : null,
                                    assignments: (_e = l.assignments) !== null && _e !== void 0 ? _e : null,
                                    questions: (_f = l.questions) !== null && _f !== void 0 ? _f : null,
                                    learningOutcomes: (_g = l.learningOutcomes) !== null && _g !== void 0 ? _g : null,
                                    isCentral: (_h = l.isCentral) !== null && _h !== void 0 ? _h : true,
                                    isVisible: (_j = l.isVisible) !== null && _j !== void 0 ? _j : true,
                                    order: (_k = l.order) !== null && _k !== void 0 ? _k : 0,
                                    createdAt: l.createdAt ? new Date(l.createdAt) : new Date(),
                                    updatedAt: l.updatedAt ? new Date(l.updatedAt) : new Date(),
                                });
                            })
                        } : undefined,
                        exams: c.exams && c.exams.length > 0 ? {
                            create: c.exams.map((e) => {
                                var _a, _b, _c, _d, _e;
                                return ({
                                    id: e.id,
                                    title: e.title,
                                    description: (_a = e.description) !== null && _a !== void 0 ? _a : null,
                                    durationMinutes: (_b = e.durationMinutes) !== null && _b !== void 0 ? _b : 60,
                                    passingScore: (_c = e.passingScore) !== null && _c !== void 0 ? _c : 50,
                                    isCentral: (_d = e.isCentral) !== null && _d !== void 0 ? _d : true,
                                    isActive: (_e = e.isActive) !== null && _e !== void 0 ? _e : true,
                                    questions: e.questions && e.questions.length > 0 ? {
                                        create: e.questions.map((q) => {
                                            var _a, _b, _c, _d;
                                            return ({
                                                id: q.id,
                                                questionText: q.questionText,
                                                type: (_a = q.type) !== null && _a !== void 0 ? _a : 'MULTIPLE_CHOICE',
                                                options: (_b = q.options) !== null && _b !== void 0 ? _b : null,
                                                correctAnswer: (_c = q.correctAnswer) !== null && _c !== void 0 ? _c : '',
                                                points: (_d = q.points) !== null && _d !== void 0 ? _d : 1
                                            });
                                        })
                                    } : undefined
                                });
                            })
                        } : undefined
                    }
                });
                console.log(`✅ [Backup DB Sync] Successfully imported missing course: ${c.title}`);
            }
        }
        catch (err) {
            console.error(`❌ [Backup DB Sync] Error importing missing courses: ${err.message}`);
        }
    });
}
function createManualBundle() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!exports.CLOUD_BACKUP_ENABLED)
            throw new Error('Cloud backup is disabled');
        yield ensureTableExists();
        const result = yield (0, cloudBackupArchive_1.archiveCloudBatch)(pool, compressBackupEntries, { minimum: 1, all: true });
        if (!result)
            throw new Error('No unarchived backups available, or another archive is running');
        return result;
    });
}
