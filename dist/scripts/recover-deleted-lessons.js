"use strict";
/**
 * ============================================================
 * 🛟 RECOVER-DELETED-LESSONS — Startup Auto-Recovery Script
 * ============================================================
 * Runs automatically at every Dokploy deployment (npm start).
 * Scans ALL local backup files + Cloud Backup DB and restores
 * any lessons that are missing from the active PostgreSQL DB.
 *
 * Strategy:
 *  1. Load all lessons currently in the active DB.
 *  2. Load all courses currently in the active DB.
 *  3. Scan every local backup file in /app/uploads/backups and /app.
 *  4. Scan the cloud backup DB for REALTIME_SYNC records.
 *  5. For each lesson found in backups that is NOT in the active DB,
 *     insert it back (upsert by ID). Never overwrites existing data.
 *  6. For each course found in backups that has 0 lessons in active DB
 *     but has lessons in backup, restore those lessons.
 *  7. Print a full recovery report.
 * ============================================================
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const prisma = new client_1.PrismaClient();
const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
const cloudPool = new pg_1.Pool({
    connectionString: BACKUP_DB_URL,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
});
// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function safeDate(value) {
    if (!value)
        return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}
function parseSafe(value) {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch (_a) {
            return value;
        }
    }
    return value;
}
/** Scan all local backup files and return a merged list of lessons */
function collectLessonsFromLocalBackups() {
    return __awaiter(this, void 0, void 0, function* () {
        const searchDirs = [
            process.cwd(),
            path.join(process.cwd(), 'uploads', 'backups'),
            '/app',
            '/app/uploads/backups',
        ];
        const seenFiles = new Set();
        const allBackupFiles = [];
        for (const dir of searchDirs) {
            try {
                if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
                    continue;
                for (const file of fs.readdirSync(dir)) {
                    if (!file.endsWith('.json'))
                        continue;
                    if (file.startsWith('backup-') ||
                        file.startsWith('backup_') ||
                        file === 'recovery.json' ||
                        file === 'courses_dump.json') {
                        const fullPath = path.join(dir, file);
                        if (!seenFiles.has(fullPath)) {
                            seenFiles.add(fullPath);
                            allBackupFiles.push(fullPath);
                        }
                    }
                }
            }
            catch (_a) {
                // skip inaccessible directories
            }
        }
        console.log(`🗂️  [Recovery] Found ${allBackupFiles.length} local backup file(s) to scan.`);
        // Sort newest first by mtime so we always prefer the most recent data
        const withStats = allBackupFiles.map(f => ({
            path: f,
            mtime: (() => { try {
                return fs.statSync(f).mtime.getTime();
            }
            catch (_a) {
                return 0;
            } })()
        })).sort((a, b) => b.mtime - a.mtime);
        const mergedLessons = new Map(); // id → lesson (newest wins)
        const mergedCourses = new Map(); // id → course (newest wins)
        for (const { path: filePath } of withStats) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                const data = parsed.data || parsed;
                const lessons = Array.isArray(data.lesson) ? data.lesson : [];
                const courses = Array.isArray(data.course) ? data.course : [];
                for (const c of courses) {
                    if ((c === null || c === void 0 ? void 0 : c.id) && !mergedCourses.has(c.id)) {
                        mergedCourses.set(c.id, c);
                    }
                }
                for (const l of lessons) {
                    if ((l === null || l === void 0 ? void 0 : l.id) && !mergedLessons.has(l.id)) {
                        mergedLessons.set(l.id, l);
                    }
                }
            }
            catch (_b) {
                // skip malformed files silently
            }
        }
        return {
            lessons: Array.from(mergedLessons.values()),
            courses: Array.from(mergedCourses.values()),
        };
    });
}
/** Scan cloud backup DB for the most recent REALTIME_SYNC records */
function collectLessonsFromCloudBackups() {
    return __awaiter(this, void 0, void 0, function* () {
        const mergedLessons = new Map();
        const mergedCourses = new Map();
        try {
            const result = yield cloudPool.query(`
      SELECT data, created_at
      FROM cloud_backups
      WHERE type IN ('REALTIME_SYNC', 'AUTO_HOURLY', 'MANUAL')
      ORDER BY created_at DESC
      LIMIT 20;
    `);
            console.log(`☁️  [Recovery] Found ${result.rows.length} cloud backup record(s) to scan.`);
            for (const row of result.rows) {
                try {
                    const payload = row.data;
                    const data = (payload === null || payload === void 0 ? void 0 : payload.data) || payload;
                    const courses = Array.isArray(data === null || data === void 0 ? void 0 : data.course) ? data.course : [];
                    const lessons = Array.isArray(data === null || data === void 0 ? void 0 : data.lesson) ? data.lesson : [];
                    for (const c of courses) {
                        if ((c === null || c === void 0 ? void 0 : c.id) && !mergedCourses.has(c.id)) {
                            mergedCourses.set(c.id, c);
                            // Also extract lessons embedded in course records (REALTIME_SYNC format)
                            if (Array.isArray(c.lessons)) {
                                for (const l of c.lessons) {
                                    if ((l === null || l === void 0 ? void 0 : l.id) && !mergedLessons.has(l.id)) {
                                        mergedLessons.set(l.id, Object.assign(Object.assign({}, l), { courseId: l.courseId || c.id }));
                                    }
                                }
                            }
                        }
                    }
                    for (const l of lessons) {
                        if ((l === null || l === void 0 ? void 0 : l.id) && !mergedLessons.has(l.id)) {
                            mergedLessons.set(l.id, l);
                        }
                    }
                }
                catch (_a) {
                    // skip malformed cloud record
                }
            }
        }
        catch (err) {
            console.warn(`⚠️  [Recovery] Could not reach cloud backup DB: ${err.message} — will rely on local backups only.`);
        }
        return {
            lessons: Array.from(mergedLessons.values()),
            courses: Array.from(mergedCourses.values()),
        };
    });
}
// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2;
        console.log('\n🛟  ==========================================');
        console.log('🛟  [Recover-Deleted-Lessons] Starting...');
        console.log('🛟  ==========================================\n');
        // 1. Load active DB state
        const [activeLessons, activeCourses] = yield Promise.all([
            prisma.lesson.findMany({ select: { id: true, courseId: true, title: true } }),
            prisma.course.findMany({ select: { id: true, title: true, _count: { select: { lessons: true } } } }),
        ]);
        const activeLessonIds = new Set(activeLessons.map(l => l.id));
        const activeCourseIds = new Set(activeCourses.map(c => c.id));
        const courseToLessonCount = new Map(activeCourses.map(c => [c.id, c._count.lessons]));
        console.log(`📊  [Recovery] Active DB: ${activeCourses.length} courses, ${activeLessons.length} lessons.`);
        // 2. Collect from all backup sources (local + cloud) in parallel
        const [local, cloud] = yield Promise.all([
            collectLessonsFromLocalBackups(),
            collectLessonsFromCloudBackups(),
        ]);
        // Merge: local takes priority (newer files sorted first already), cloud fills gaps
        const allBackupLessons = new Map();
        const allBackupCourses = new Map();
        for (const c of [...cloud.courses, ...local.courses]) {
            if ((c === null || c === void 0 ? void 0 : c.id) && !allBackupCourses.has(c.id))
                allBackupCourses.set(c.id, c);
        }
        for (const l of [...cloud.lessons, ...local.lessons]) {
            if ((l === null || l === void 0 ? void 0 : l.id) && !allBackupLessons.has(l.id))
                allBackupLessons.set(l.id, l);
        }
        console.log(`📦  [Recovery] Total unique backup pool: ${allBackupCourses.size} courses, ${allBackupLessons.size} lessons.\n`);
        const { isLessonDeleted, isCourseDeleted } = yield Promise.resolve().then(() => __importStar(require('../lib/tombstones')));
        let restoredLessons = 0;
        let restoredCourses = 0;
        let skippedLessons = 0;
        // 3. Restore missing courses first (so we can attach lessons to them)
        for (const [courseId, backupCourse] of allBackupCourses) {
            if (activeCourseIds.has(courseId))
                continue;
            if (!(backupCourse === null || backupCourse === void 0 ? void 0 : backupCourse.id) || !(backupCourse === null || backupCourse === void 0 ? void 0 : backupCourse.title))
                continue;
            // 🔒 Skip courses explicitly deleted by user
            if (yield isCourseDeleted(courseId)) {
                console.log(`🔒  [Recovery] Skipping course "${backupCourse.title}" (${courseId}) — marked as EXPLICITLY DELETED by user.`);
                continue;
            }
            try {
                yield prisma.course.create({
                    data: {
                        id: backupCourse.id,
                        title: backupCourse.title,
                        description: (_a = backupCourse.description) !== null && _a !== void 0 ? _a : null,
                        coverImage: (_b = backupCourse.coverImage) !== null && _b !== void 0 ? _b : null,
                        grade: (_c = backupCourse.grade) !== null && _c !== void 0 ? _c : null,
                        grades: (_d = backupCourse.grades) !== null && _d !== void 0 ? _d : null,
                        subject: (_e = backupCourse.subject) !== null && _e !== void 0 ? _e : null,
                        country: backupCourse.country || 'مصر',
                        isCentral: (_f = backupCourse.isCentral) !== null && _f !== void 0 ? _f : false,
                        schoolId: (_g = backupCourse.schoolId) !== null && _g !== void 0 ? _g : null,
                        createdAt: (_h = safeDate(backupCourse.createdAt)) !== null && _h !== void 0 ? _h : new Date(),
                        updatedAt: (_j = safeDate(backupCourse.updatedAt)) !== null && _j !== void 0 ? _j : new Date(),
                    }
                });
                activeCourseIds.add(courseId);
                courseToLessonCount.set(courseId, 0);
                restoredCourses++;
                console.log(`✅  [Recovery] Restored missing course: "${backupCourse.title}" (${courseId})`);
            }
            catch (err) {
                console.warn(`⚠️  [Recovery] Could not restore course "${backupCourse.title}": ${err.message}`);
            }
        }
        // 4. Restore missing lessons
        const lessonsToRestore = Array.from(allBackupLessons.values()).filter(l => (l === null || l === void 0 ? void 0 : l.id) && !activeLessonIds.has(l.id));
        console.log(`🔍  [Recovery] Found ${lessonsToRestore.length} lesson(s) to check for restoration.\n`);
        for (const lesson of lessonsToRestore) {
            if (!(lesson === null || lesson === void 0 ? void 0 : lesson.id) || !(lesson === null || lesson === void 0 ? void 0 : lesson.courseId)) {
                skippedLessons++;
                continue;
            }
            // 🔒 Skip lessons explicitly deleted by user
            if (yield isLessonDeleted(lesson.id)) {
                console.log(`🔒  [Recovery] Skipping lesson "${lesson.title}" (${lesson.id}) — marked as EXPLICITLY DELETED by user.`);
                skippedLessons++;
                continue;
            }
            // Parent course must exist in DB
            if (!activeCourseIds.has(lesson.courseId)) {
                console.warn(`⚠️  [Recovery] Skipping lesson "${lesson.title}" — parent course ${lesson.courseId} not in DB.`);
                skippedLessons++;
                continue;
            }
            try {
                yield prisma.lesson.create({
                    data: {
                        id: lesson.id,
                        courseId: lesson.courseId,
                        title: lesson.title || 'Untitled Lesson',
                        domain: (_k = lesson.domain) !== null && _k !== void 0 ? _k : null,
                        content: (_l = lesson.content) !== null && _l !== void 0 ? _l : null,
                        videoUrl: (_m = lesson.videoUrl) !== null && _m !== void 0 ? _m : null,
                        duration: (_o = lesson.duration) !== null && _o !== void 0 ? _o : 0,
                        summary: (_p = lesson.summary) !== null && _p !== void 0 ? _p : null,
                        notes: (_q = lesson.notes) !== null && _q !== void 0 ? _q : null,
                        questions: (_r = parseSafe(lesson.questions)) !== null && _r !== void 0 ? _r : null,
                        assignments: (_s = parseSafe(lesson.assignments)) !== null && _s !== void 0 ? _s : null,
                        attachments: (_t = parseSafe(lesson.attachments)) !== null && _t !== void 0 ? _t : null,
                        slides: (_u = parseSafe(lesson.slides)) !== null && _u !== void 0 ? _u : null,
                        standards: (_v = lesson.standards) !== null && _v !== void 0 ? _v : null,
                        indicators: (_w = lesson.indicators) !== null && _w !== void 0 ? _w : null,
                        learningOutcomes: (_x = lesson.learningOutcomes) !== null && _x !== void 0 ? _x : null,
                        isCentral: (_y = lesson.isCentral) !== null && _y !== void 0 ? _y : false,
                        isVisible: lesson.isVisible !== undefined ? !!lesson.isVisible : true,
                        publishDate: safeDate(lesson.publishDate),
                        cutOffDate: safeDate(lesson.cutOffDate),
                        order: (_z = lesson.order) !== null && _z !== void 0 ? _z : 0,
                        createdAt: (_0 = safeDate(lesson.createdAt)) !== null && _0 !== void 0 ? _0 : new Date(),
                        updatedAt: (_1 = safeDate(lesson.updatedAt)) !== null && _1 !== void 0 ? _1 : new Date(),
                    }
                });
                restoredLessons++;
                const currentCount = courseToLessonCount.get(lesson.courseId) || 0;
                courseToLessonCount.set(lesson.courseId, currentCount + 1);
                console.log(`✅  [Recovery] Restored lesson: "${lesson.title}" → course ${lesson.courseId}`);
            }
            catch (err) {
                if (err.code === 'P2002' || ((_2 = err.message) === null || _2 === void 0 ? void 0 : _2.includes('Unique constraint'))) {
                    skippedLessons++;
                    // Already exists (race condition) — safe to skip
                }
                else {
                    console.warn(`⚠️  [Recovery] Failed to restore "${lesson.title}" (${lesson.id}): ${err.message}`);
                    skippedLessons++;
                }
            }
        }
        // 5. Final report
        console.log('\n🛟  ==========================================');
        console.log(`🛟  [Recovery] COMPLETE`);
        console.log(`   ✅  Courses restored : ${restoredCourses}`);
        console.log(`   ✅  Lessons restored : ${restoredLessons}`);
        console.log(`   ⏭️   Lessons skipped  : ${skippedLessons}`);
        console.log('🛟  ==========================================\n');
    });
}
main()
    .catch(err => {
    console.error('❌  [Recovery] Critical error:', err);
    // Do NOT exit(1) — a recovery failure must never block server startup
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    try {
        yield cloudPool.end();
    }
    catch ( /* ignore */_a) { /* ignore */ }
}));
