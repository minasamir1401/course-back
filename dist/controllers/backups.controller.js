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
exports.normalizeRestoredValue = exports.BACKUPS_DIR = exports.postBackupHandler20 = exports.postBackupHandler19 = exports.getBackupHandler18 = exports.postBackupHandler17 = exports.postBackupHandler16 = exports.getBackupHandler15 = exports.postBackupHandler14 = exports.postBackupHandler13 = exports.deleteBackupHandler12 = exports.postBackupHandler11 = exports.postBackupHandler10 = exports.getBackupHandler9 = exports.getBackupHandler8 = exports.getBackupHandler7 = exports.postBackupHandler6 = exports.postBackupHandler5 = exports.postBackupHandler4 = exports.getBackupHandler3 = exports.getBackupHandler2 = exports.postBackupHandler1 = void 0;
exports.parseBackupBuffer = parseBackupBuffer;
exports.generateFullSystemBackupData = generateFullSystemBackupData;
exports.performBackupAndPruning = performBackupAndPruning;
exports.readLocalBackupFile = readLocalBackupFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const shared_1 = require("../shared");
const db_backup_1 = require("../lib/db-backup");
const runtimeSecurity_1 = require("../lib/runtimeSecurity");
const postBackupHandler1 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield performBackupAndPruning();
        res.json({
            message: 'Backup created successfully',
            filename: result.filename,
            size: result.size,
            createdAt: result.createdAt
        });
    }
    catch (error) {
        console.error('❌ Backup creation error:', error);
        res.status(500).json({ error: 'Failed to create backup', details: error.message });
    }
});
exports.postBackupHandler1 = postBackupHandler1;
const getBackupHandler2 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const files = fs_1.default.readdirSync(exports.BACKUPS_DIR)
            .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')))
            .map(file => {
            const filePath = path_1.default.join(exports.BACKUPS_DIR, file);
            const stats = fs_1.default.statSync(filePath);
            return {
                filename: file,
                size: stats.size,
                createdAt: stats.birthtime || stats.mtime,
                isCloud: false
            };
        });
        // Merge cloud backups (excluding Realtime Sync noise)
        let cloudFiles = [];
        try {
            const cloudBackups = yield (0, db_backup_1.getCloudBackups)();
            cloudFiles = cloudBackups
                .filter((cb) => cb.type !== 'REALTIME_SYNC')
                .map((cb) => ({
                filename: `cloud_${cb.id}_${cb.name || 'backup'}.json`,
                size: cb.size || 0,
                createdAt: cb.created_at,
                isCloud: true,
                type: cb.type
            }));
        }
        catch (err) {
            console.error('Failed to merge cloud backups:', err);
        }
        const allFiles = [...files, ...cloudFiles].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        res.json(allFiles);
    }
    catch (error) {
        console.error('❌ Backup list error:', error);
        res.status(500).json({ error: 'Failed to list backups', details: error.message });
    }
});
exports.getBackupHandler2 = getBackupHandler2;
const getBackupHandler3 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cloudBackups = yield (0, db_backup_1.getCloudBackups)();
        const filtered = cloudBackups.filter((cb) => cb.type !== 'REALTIME_SYNC');
        res.json(filtered);
    }
    catch (error) {
        console.error('❌ Cloud backup list error:', error);
        res.status(500).json({ error: 'Failed to list cloud backups', details: error.message });
    }
});
exports.getBackupHandler3 = getBackupHandler3;
const postBackupHandler4 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fullData = yield generateFullSystemBackupData();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup_manual_cloud_${timestamp}`;
        const saved = yield (0, db_backup_1.saveToCloudBackup)(backupName, 'MANUAL', fullData);
        if (!saved) {
            return res.status(500).json({ error: 'Failed to save cloud backup to Cloud Backup' });
        }
        res.json({ message: 'Cloud backup created successfully on Cloud Backup', filename: backupName });
    }
    catch (error) {
        console.error('❌ Cloud backup create error:', error);
        res.status(500).json({ error: 'Failed to create cloud backup', details: error.message });
    }
});
exports.postBackupHandler4 = postBackupHandler4;
const postBackupHandler5 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const allCourses = yield prisma_1.default.course.findMany({
            include: {
                lessons: { include: { blocks: true } },
                exams: { include: { questions: true } },
                schools: true,
                school: true
            }
        });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup_forced_sync_${timestamp}`;
        const saved = yield (0, db_backup_1.saveToCloudBackup)(backupName, 'REALTIME_SYNC', {
            data: { course: allCourses }
        });
        if (!saved) {
            return res.status(500).json({ error: 'Failed to sync courses to Cloud Backup' });
        }
        console.log(`☁️ [Force Sync] Synced ${allCourses.length} courses to Cloud Backup as REALTIME_SYNC`);
        res.json({
            message: `تمت مزامنة ${allCourses.length} كورس بنجاح إلى Cloud Backup`,
            coursesCount: allCourses.length,
            backupName
        });
    }
    catch (error) {
        console.error('❌ Cloud sync-all error:', error);
        res.status(500).json({ error: 'Failed to sync all courses', details: error.message });
    }
});
exports.postBackupHandler5 = postBackupHandler5;
const postBackupHandler6 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1;
    try {
        const { Pool } = require('pg');
        const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
        const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 3, connectionTimeoutMillis: 8000 });
        // 1. Fetch the most recent cloud backup records (prefer REALTIME_SYNC then AUTO_HOURLY)
        const result = yield cloudPool.query(`
      SELECT data, created_at, type
      FROM cloud_backups
      WHERE type IN ('REALTIME_SYNC', 'AUTO_HOURLY', 'MANUAL')
      ORDER BY created_at DESC
      LIMIT 30;
    `);
        yield cloudPool.end();
        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'No cloud backup records found' });
        }
        // 2. Merge all course + lesson data from cloud records (newest first)
        const mergedCourses = new Map();
        const mergedLessons = new Map();
        for (const row of result.rows) {
            try {
                const payload = row.data;
                const data = (payload === null || payload === void 0 ? void 0 : payload.data) || payload;
                const courses = Array.isArray(data === null || data === void 0 ? void 0 : data.course) ? data.course : [];
                const lessons = Array.isArray(data === null || data === void 0 ? void 0 : data.lesson) ? data.lesson : [];
                for (const c of courses) {
                    if ((c === null || c === void 0 ? void 0 : c.id) && !mergedCourses.has(c.id)) {
                        mergedCourses.set(c.id, c);
                        // Also extract lessons embedded inside course objects (REALTIME_SYNC format)
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
            catch ( /* skip malformed records */_2) { /* skip malformed records */ }
        }
        console.log(`☁️ [Cloud Restore] Found ${mergedCourses.size} courses and ${mergedLessons.size} lessons in cloud backup pool`);
        // 3. Load current primary DB state
        const [activeCourses, activeLessons] = yield Promise.all([
            prisma_1.default.course.findMany({ select: { id: true } }),
            prisma_1.default.lesson.findMany({ select: { id: true } }),
        ]);
        const activeCourseIds = new Set(activeCourses.map((c) => c.id));
        const activeLessonIds = new Set(activeLessons.map((l) => l.id));
        const toDate = (v) => v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null;
        let restoredCourses = 0;
        let restoredLessons = 0;
        let skippedCourses = 0;
        let skippedLessons = 0;
        const details = [];
        // 4. Restore missing courses
        for (const [courseId, c] of mergedCourses) {
            if (activeCourseIds.has(courseId)) {
                skippedCourses++;
                continue;
            }
            if (!(c === null || c === void 0 ? void 0 : c.title)) {
                skippedCourses++;
                continue;
            }
            try {
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
                        isCentral: (_f = c.isCentral) !== null && _f !== void 0 ? _f : false,
                        schoolId: (_g = c.schoolId) !== null && _g !== void 0 ? _g : null,
                        createdAt: (_h = toDate(c.createdAt)) !== null && _h !== void 0 ? _h : new Date(),
                        updatedAt: (_j = toDate(c.updatedAt)) !== null && _j !== void 0 ? _j : new Date(),
                    }
                });
                activeCourseIds.add(courseId);
                restoredCourses++;
                details.push(`✅ Course: "${c.title}"`);
                console.log(`✅ [Cloud Restore] Restored course: "${c.title}" (${courseId})`);
            }
            catch (err) {
                if (err.code === 'P2002') {
                    skippedCourses++;
                    activeCourseIds.add(courseId);
                }
                else {
                    details.push(`⚠️ Course "${c.title}": ${err.message}`);
                    skippedCourses++;
                }
            }
        }
        // 5. Restore missing lessons
        for (const [lessonId, l] of mergedLessons) {
            if (activeLessonIds.has(lessonId)) {
                skippedLessons++;
                continue;
            }
            if (!(l === null || l === void 0 ? void 0 : l.courseId) || !activeCourseIds.has(l.courseId)) {
                skippedLessons++;
                continue;
            }
            try {
                const parseSafe = (v) => {
                    if (!v)
                        return null;
                    if (typeof v === 'string') {
                        try {
                            return JSON.parse(v);
                        }
                        catch (_a) {
                            return v;
                        }
                    }
                    return v;
                };
                yield prisma_1.default.lesson.create({
                    data: {
                        id: l.id,
                        courseId: l.courseId,
                        title: l.title || 'Untitled Lesson',
                        domain: (_k = l.domain) !== null && _k !== void 0 ? _k : null,
                        content: (_l = l.content) !== null && _l !== void 0 ? _l : null,
                        videoUrl: (_m = l.videoUrl) !== null && _m !== void 0 ? _m : null,
                        duration: (_o = l.duration) !== null && _o !== void 0 ? _o : 0,
                        summary: (_p = l.summary) !== null && _p !== void 0 ? _p : null,
                        notes: (_q = l.notes) !== null && _q !== void 0 ? _q : null,
                        questions: (_r = parseSafe(l.questions)) !== null && _r !== void 0 ? _r : null,
                        assignments: (_s = parseSafe(l.assignments)) !== null && _s !== void 0 ? _s : null,
                        attachments: (_t = parseSafe(l.attachments)) !== null && _t !== void 0 ? _t : null,
                        slides: (_u = parseSafe(l.slides)) !== null && _u !== void 0 ? _u : null,
                        standards: (_v = l.standards) !== null && _v !== void 0 ? _v : null,
                        indicators: (_w = l.indicators) !== null && _w !== void 0 ? _w : null,
                        learningOutcomes: (_x = l.learningOutcomes) !== null && _x !== void 0 ? _x : null,
                        isCentral: (_y = l.isCentral) !== null && _y !== void 0 ? _y : false,
                        isVisible: l.isVisible !== undefined ? !!l.isVisible : true,
                        publishDate: toDate(l.publishDate),
                        cutOffDate: toDate(l.cutOffDate),
                        order: (_z = l.order) !== null && _z !== void 0 ? _z : 0,
                        createdAt: (_0 = toDate(l.createdAt)) !== null && _0 !== void 0 ? _0 : new Date(),
                        updatedAt: (_1 = toDate(l.updatedAt)) !== null && _1 !== void 0 ? _1 : new Date(),
                    }
                });
                activeLessonIds.add(lessonId);
                restoredLessons++;
                details.push(`  📚 Lesson: "${l.title}"`);
                console.log(`✅ [Cloud Restore] Restored lesson: "${l.title}" → course ${l.courseId}`);
            }
            catch (err) {
                if (err.code === 'P2002') {
                    skippedLessons++;
                }
                else {
                    details.push(`  ⚠️ Lesson "${l.title}": ${err.message}`);
                    skippedLessons++;
                }
            }
        }
        const summary = {
            success: true,
            message: `تم استعادة ${restoredCourses} كورس و ${restoredLessons} درس من Cloud Backup إلى قاعدة البيانات الأساسية`,
            restoredCourses,
            restoredLessons,
            skippedCourses,
            skippedLessons,
            cloudRecordsScanned: result.rows.length,
            details: details.slice(0, 100) // limit details output
        };
        console.log(`\n☁️ [Cloud Restore] COMPLETE — Courses: ${restoredCourses} restored, ${skippedCourses} skipped | Lessons: ${restoredLessons} restored, ${skippedLessons} skipped`);
        res.json(summary);
    }
    catch (error) {
        console.error('❌ Cloud restore error:', error);
        res.status(500).json({ error: 'Failed to restore from cloud backup', details: error.message });
    }
});
exports.postBackupHandler6 = postBackupHandler6;
const getBackupHandler7 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { filename } = req.params;
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        if (filename.startsWith('cloud_')) {
            const match = filename.match(/^cloud_([0-9a-fA-F-]+)_/);
            if (match && match[1]) {
                const cloudId = match[1];
                const { Pool } = require('pg');
                const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
                const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 1 });
                try {
                    const result = yield cloudPool.query('SELECT data FROM cloud_backups WHERE id = $1', [cloudId]);
                    if (result.rows.length === 0) {
                        return res.status(404).json({ error: 'Cloud backup not found' });
                    }
                    const data = result.rows[0].data;
                    if (data && data.isArchive && data.compression === 'zip' && data.fileBase64) {
                        const buffer = Buffer.from(data.fileBase64, 'base64');
                        const zipFilename = filename.replace('.json', '.zip');
                        res.setHeader('Content-Type', 'application/zip');
                        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename)}`);
                        return res.send(buffer);
                    }
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
                    return res.send(JSON.stringify(data, null, 2));
                }
                finally {
                    yield cloudPool.end();
                }
            }
        }
        const filePath = path_1.default.join(exports.BACKUPS_DIR, filename);
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({ error: 'Backup file not found' });
        }
        res.download(filePath, filename);
    }
    catch (error) {
        console.error('❌ Backup download error:', error);
        res.status(500).json({ error: 'Failed to download backup', details: error.message });
    }
});
exports.getBackupHandler7 = getBackupHandler7;
const getBackupHandler8 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.attachment(`full-backup-with-media-${timestamp}.zip`);
        const archiver = require('archiver');
        let archive;
        if (archiver.ZipArchive) {
            archive = new archiver.ZipArchive({ zlib: { level: 9 } });
        }
        else if (typeof archiver === 'function')
            archive = archiver('zip', { zlib: { level: 9 } });
        else if (archiver.create)
            archive = archiver.create('zip', { zlib: { level: 9 } });
        else if (archiver.default)
            archive = archiver.default('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            if (!res.headersSent)
                res.status(500).send({ error: err.message });
        });
        archive.pipe(res);
        // 1. Generate full database JSON backup
        const backupData = yield generateFullSystemBackupData();
        const backupJson = JSON.stringify(backupData, null, 2);
        archive.append(backupJson, { name: `database_backup_${timestamp}.json` });
        // 2. Add uploads directory if it exists and has files
        const UPLOADS_DIR = path_1.default.join(process.cwd(), 'uploads');
        if (fs_1.default.existsSync(UPLOADS_DIR)) {
            archive.directory(UPLOADS_DIR, 'uploads');
        }
        archive.finalize();
    }
    catch (error) {
        console.error('❌ Download full backup with media error:', error);
        if (!res.headersSent)
            res.status(500).json({ error: 'Failed to create full backup zip', details: error.message });
    }
});
exports.getBackupHandler8 = getBackupHandler8;
const getBackupHandler9 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const files = fs_1.default.readdirSync(exports.BACKUPS_DIR)
            .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')));
        if (files.length === 0) {
            return res.status(404).json({ error: 'No backups available to download' });
        }
        res.attachment(`all-backups-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
        const archiver = require('archiver');
        let archive;
        if (archiver.ZipArchive) {
            archive = new archiver.ZipArchive({ zlib: { level: 9 } });
        }
        else if (typeof archiver === 'function')
            archive = archiver('zip', { zlib: { level: 9 } });
        else if (archiver.create)
            archive = archiver.create('zip', { zlib: { level: 9 } });
        else if (archiver.default)
            archive = archiver.default('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => {
            res.status(500).send({ error: err.message });
        });
        archive.pipe(res);
        for (const file of files) {
            archive.file(path_1.default.join(exports.BACKUPS_DIR, file), { name: file });
        }
        archive.finalize();
    }
    catch (error) {
        console.error('❌ Download all backups error:', error);
        res.status(500).json({ error: 'Failed to create zip for all backups', details: error.message });
    }
});
exports.getBackupHandler9 = getBackupHandler9;
const postBackupHandler10 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield (0, db_backup_1.createManualBundle)();
        res.json(result);
    }
    catch (error) {
        console.error('❌ Manual bundle backups error:', error);
        res.status(500).json({ error: error.message || 'Failed to create manual bundle' });
    }
});
exports.postBackupHandler10 = postBackupHandler10;
const resolveBackupUploadEntryPath = (entryName) => {
    const normalizedEntryName = entryName.replace(/\\/g, '/');
    if (!normalizedEntryName.startsWith('uploads/')) {
        throw new Error('ZIP entry is outside the uploads directory');
    }
    const relativePath = normalizedEntryName.slice('uploads/'.length);
    if (!relativePath || relativePath.includes('\0')) {
        throw new Error('ZIP entry has an invalid upload path');
    }
    const uploadsRoot = path_1.default.resolve(shared_1.UPLOADS_DIR);
    const targetPath = path_1.default.resolve(uploadsRoot, relativePath);
    if (!targetPath.startsWith(`${uploadsRoot}${path_1.default.sep}`)) {
        throw new Error('ZIP entry path escapes the uploads directory');
    }
    return targetPath;
};
const postBackupHandler11 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No backup file uploaded' });
        }
        const tempPath = req.file.path;
        const ext = path_1.default.extname(req.file.originalname || '').toLowerCase();
        if (ext !== '.json' && ext !== '.zip') {
            fs_1.default.unlinkSync(tempPath);
            return res.status(400).json({ error: 'Only JSON or ZIP backup files are allowed' });
        }
        const parsed = parseBackupBuffer(fs_1.default.readFileSync(tempPath), req.file.originalname || req.file.filename);
        if (!parsed.data) {
            fs_1.default.unlinkSync(tempPath);
            return res.status(400).json({ error: 'Invalid backup format' });
        }
        const filename = `backup-uploaded-${Date.now()}${ext}`;
        const destPath = path_1.default.join(exports.BACKUPS_DIR, filename);
        fs_1.default.copyFileSync(tempPath, destPath);
        fs_1.default.unlinkSync(tempPath);
        let extractedMediaCount = 0;
        if (ext === '.zip') {
            try {
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(destPath);
                const mediaEntries = zip.getEntries().filter((entry) => {
                    const entryName = String(entry.entryName || '').replace(/\\/g, '/');
                    return entryName.startsWith('uploads/') && !entry.isDirectory;
                });
                // Validate every path before writing any file from the archive.
                const safeMediaEntries = mediaEntries.map((entry) => ({
                    entry,
                    targetPath: resolveBackupUploadEntryPath(String(entry.entryName || '')),
                }));
                safeMediaEntries.forEach(({ entry, targetPath }) => {
                    const targetDir = path_1.default.dirname(targetPath);
                    if (!fs_1.default.existsSync(targetDir)) {
                        fs_1.default.mkdirSync(targetDir, { recursive: true });
                    }
                    fs_1.default.writeFileSync(targetPath, entry.getData());
                    extractedMediaCount++;
                });
                if (extractedMediaCount > 0) {
                    console.log(`✅ Extracted ${extractedMediaCount} media files from uploaded backup`);
                }
            }
            catch (err) {
                console.error('⚠️ Failed to extract media from ZIP:', err.message);
                if (fs_1.default.existsSync(destPath))
                    fs_1.default.unlinkSync(destPath);
                return res.status(400).json({ error: 'ZIP backup contains an unsafe or invalid media path' });
            }
        }
        res.json({
            message: extractedMediaCount > 0 ? `Backup uploaded successfully and ${extractedMediaCount} images/media extracted` : 'Backup uploaded successfully',
            filename,
            size: fs_1.default.statSync(destPath).size,
            createdAt: new Date(),
            extractedMediaCount
        });
    }
    catch (error) {
        console.error('❌ Backup upload error:', error);
        res.status(500).json({ error: 'Failed to upload backup', details: error.message });
    }
});
exports.postBackupHandler11 = postBackupHandler11;
const deleteBackupHandler12 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { filename } = req.params;
        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        if (filename.startsWith('cloud_')) {
            const match = filename.match(/^cloud_([0-9a-fA-F-]+)_/);
            if (match && match[1]) {
                const cloudId = match[1];
                const { Pool } = require('pg');
                const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
                const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 1 });
                try {
                    const result = yield cloudPool.query('DELETE FROM cloud_backups WHERE id = $1 RETURNING id', [cloudId]);
                    if (result.rowCount === 0) {
                        return res.status(404).json({ error: 'Cloud backup not found' });
                    }
                    return res.json({ success: true, message: 'Cloud backup deleted successfully' });
                }
                finally {
                    yield cloudPool.end();
                }
            }
        }
        else if (filename.includes('مجمع')) {
            // Special case for manual bundles or 50-hour archives
            const { Pool } = require('pg');
            const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
            const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 1 });
            try {
                const result = yield cloudPool.query('DELETE FROM cloud_backups WHERE name = $1 RETURNING id', [filename]);
                if (result.rowCount === 0) {
                    return res.status(404).json({ error: 'Archive not found' });
                }
                return res.json({ success: true, message: 'Archive deleted successfully' });
            }
            finally {
                yield cloudPool.end();
            }
        }
        const filePath = path_1.default.join(exports.BACKUPS_DIR, filename);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            return res.json({ success: true, message: 'Local backup deleted successfully' });
        }
        return res.status(404).json({ error: 'Backup not found' });
    }
    catch (error) {
        console.error('❌ Delete backup error:', error);
        res.status(500).json({ error: 'Failed to delete backup', details: error.message });
    }
});
exports.deleteBackupHandler12 = deleteBackupHandler12;
const postBackupHandler13 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { filename } = req.body;
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        let backupData = null;
        // --- Cloud backup: filename starts with 'cloud_' ---
        if (filename.startsWith('cloud_')) {
            const match = filename.match(/^cloud_([0-9a-fA-F-]+)_/);
            if (!match || !match[1]) {
                return res.status(400).json({ error: 'Invalid cloud backup filename' });
            }
            const cloudId = match[1];
            const { Pool } = require('pg');
            const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
            const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 1, connectionTimeoutMillis: 8000 });
            try {
                const result = yield cloudPool.query('SELECT data FROM cloud_backups WHERE id = $1 LIMIT 1', [cloudId]);
                if (result.rows.length === 0) {
                    return res.status(404).json({ error: 'Cloud backup record not found' });
                }
                backupData = result.rows[0].data;
            }
            finally {
                yield cloudPool.end().catch(() => { });
            }
        }
        else {
            // --- Local backup file ---
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                return res.status(400).json({ error: 'Invalid filename' });
            }
            const filePath = path_1.default.join(exports.BACKUPS_DIR, filename);
            if (!fs_1.default.existsSync(filePath)) {
                return res.status(404).json({ error: 'Backup file not found' });
            }
            backupData = readLocalBackupFile(filePath, filename);
        }
        const data = (backupData === null || backupData === void 0 ? void 0 : backupData.data) || backupData; // Handle both wrapper structure and plain object
        const backupCourses = Array.isArray(data.course) ? data.course : [];
        const backupLessons = Array.isArray(data.lesson) ? data.lesson : [];
        if (backupCourses.length === 0 || backupLessons.length === 0) {
            return res.status(400).json({
                error: 'Invalid backup content',
                details: 'A full restore requires both course and lesson arrays. Refusing to wipe current data with an incomplete backup.'
            });
        }
        // Preserve a safety snapshot before any restore attempt so we can roll back manually if needed.
        try {
            yield performBackupAndPruning();
        }
        catch (snapshotError) {
            console.warn('⚠️ Failed to create safety snapshot before restore:', snapshotError.message);
        }
        // Merge restore: update/create records instead of deleting the current database.
        // This prevents accidental data loss if the selected backup is incomplete or older than the current state.
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40, _41, _42, _43, _44, _45, _46, _47, _48, _49, _50, _51, _52, _53, _54, _55, _56, _57;
            const toDate = (value) => (value ? new Date(value) : value === null ? null : undefined);
            if (data.school && data.school.length > 0) {
                for (const school of data.school) {
                    if (!(school === null || school === void 0 ? void 0 : school.id))
                        continue;
                    const payload = {
                        name: school.name,
                        subdomain: (_a = school.subdomain) !== null && _a !== void 0 ? _a : null,
                        themeColor: (_b = school.themeColor) !== null && _b !== void 0 ? _b : null,
                        status: (_c = school.status) !== null && _c !== void 0 ? _c : 'ACTIVE',
                        createdAt: (_d = toDate(school.createdAt)) !== null && _d !== void 0 ? _d : new Date(),
                        updatedAt: (_e = toDate(school.updatedAt)) !== null && _e !== void 0 ? _e : new Date()
                    };
                    yield tx.school.upsert({
                        where: { id: school.id },
                        update: payload,
                        create: Object.assign({ id: school.id }, payload)
                    });
                }
            }
            if (data.user && data.user.length > 0) {
                for (const user of data.user) {
                    if (!(user === null || user === void 0 ? void 0 : user.id))
                        continue;
                    const payload = {
                        name: user.name,
                        username: user.username,
                        email: (_f = user.email) !== null && _f !== void 0 ? _f : null,
                        password: user.password,
                        role: (_g = user.role) !== null && _g !== void 0 ? _g : 'STUDENT',
                        avatar: (_h = user.avatar) !== null && _h !== void 0 ? _h : null,
                        phone: (_j = user.phone) !== null && _j !== void 0 ? _j : null,
                        status: (_k = user.status) !== null && _k !== void 0 ? _k : 'ACTIVE',
                        gender: (_l = user.gender) !== null && _l !== void 0 ? _l : null,
                        address: (_m = user.address) !== null && _m !== void 0 ? _m : null,
                        grade: (_o = user.grade) !== null && _o !== void 0 ? _o : null,
                        specialization: (_p = user.specialization) !== null && _p !== void 0 ? _p : null,
                        schoolId: (_q = user.schoolId) !== null && _q !== void 0 ? _q : null,
                        classroomId: (_r = user.classroomId) !== null && _r !== void 0 ? _r : null,
                        parentId: (_s = user.parentId) !== null && _s !== void 0 ? _s : null,
                        xp: (_t = user.xp) !== null && _t !== void 0 ? _t : 0,
                        createdAt: (_u = toDate(user.createdAt)) !== null && _u !== void 0 ? _u : new Date(),
                        updatedAt: (_v = toDate(user.updatedAt)) !== null && _v !== void 0 ? _v : new Date()
                    };
                    const orConditions = [{ username: user.username }];
                    if (user.email)
                        orConditions.push({ email: user.email });
                    const conflictingUser = yield tx.user.findFirst({ where: { OR: orConditions } });
                    if (conflictingUser && conflictingUser.id !== user.id) {
                        try {
                            yield tx.user.delete({ where: { id: conflictingUser.id } });
                        }
                        catch (e) {
                            console.warn("Could not delete conflicting user, skipping restore for this user.");
                            continue;
                        }
                    }
                    yield tx.user.upsert({
                        where: { id: user.id },
                        update: payload,
                        create: Object.assign({ id: user.id }, payload)
                    });
                }
            }
            if (data.classroom && data.classroom.length > 0) {
                for (const classroom of data.classroom) {
                    if (!(classroom === null || classroom === void 0 ? void 0 : classroom.id))
                        continue;
                    const payload = {
                        name: classroom.name,
                        grade: classroom.grade,
                        schoolId: classroom.schoolId,
                        teacherId: (_w = classroom.teacherId) !== null && _w !== void 0 ? _w : null,
                        createdAt: (_x = toDate(classroom.createdAt)) !== null && _x !== void 0 ? _x : new Date(),
                        updatedAt: (_y = toDate(classroom.updatedAt)) !== null && _y !== void 0 ? _y : new Date()
                    };
                    yield tx.classroom.upsert({
                        where: { id: classroom.id },
                        update: payload,
                        create: Object.assign({ id: classroom.id }, payload)
                    });
                }
            }
            if (data.course && data.course.length > 0) {
                for (const course of data.course) {
                    if (!(course === null || course === void 0 ? void 0 : course.id))
                        continue;
                    const payload = {
                        title: course.title,
                        description: (0, exports.normalizeRestoredValue)((_z = course.description) !== null && _z !== void 0 ? _z : null),
                        coverImage: (0, exports.normalizeRestoredValue)((_0 = course.coverImage) !== null && _0 !== void 0 ? _0 : null),
                        grade: (_1 = course.grade) !== null && _1 !== void 0 ? _1 : null,
                        grades: (_2 = course.grades) !== null && _2 !== void 0 ? _2 : null,
                        subject: (_3 = course.subject) !== null && _3 !== void 0 ? _3 : null,
                        country: (_4 = course.country) !== null && _4 !== void 0 ? _4 : 'مصر',
                        isCentral: (_5 = course.isCentral) !== null && _5 !== void 0 ? _5 : false,
                        schoolId: (_6 = course.schoolId) !== null && _6 !== void 0 ? _6 : null,
                        createdAt: (_7 = toDate(course.createdAt)) !== null && _7 !== void 0 ? _7 : new Date(),
                        updatedAt: (_8 = toDate(course.updatedAt)) !== null && _8 !== void 0 ? _8 : new Date()
                    };
                    yield tx.course.upsert({
                        where: { id: course.id },
                        update: payload,
                        create: Object.assign({ id: course.id }, payload)
                    });
                }
            }
            // Pre-fetch valid course IDs to prevent FK constraint failures on orphaned items
            const validCourseIds = new Set();
            const existingCourses = yield tx.course.findMany({ select: { id: true } });
            existingCourses.forEach(c => validCourseIds.add(c.id));
            if (data.studentEnrollment && data.studentEnrollment.length > 0) {
                yield tx.studentEnrollment.createMany({
                    data: data.studentEnrollment.filter((x) => validCourseIds.has(x.courseId)).map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.teacherCourse && data.teacherCourse.length > 0) {
                yield tx.teacherCourse.createMany({
                    data: data.teacherCourse.filter((x) => validCourseIds.has(x.courseId)).map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.lesson && data.lesson.length > 0) {
                for (const lesson of data.lesson) {
                    if (!(lesson === null || lesson === void 0 ? void 0 : lesson.id))
                        continue;
                    if (lesson.courseId && !validCourseIds.has(lesson.courseId)) {
                        console.warn(`Skipping lesson ${lesson.title} because courseId ${lesson.courseId} is missing.`);
                        continue;
                    }
                    const payload = {
                        courseId: lesson.courseId,
                        title: lesson.title,
                        domain: (_9 = lesson.domain) !== null && _9 !== void 0 ? _9 : null,
                        content: (0, exports.normalizeRestoredValue)((_10 = lesson.content) !== null && _10 !== void 0 ? _10 : null),
                        videoUrl: (_11 = lesson.videoUrl) !== null && _11 !== void 0 ? _11 : null,
                        summary: (0, exports.normalizeRestoredValue)((_12 = lesson.summary) !== null && _12 !== void 0 ? _12 : null),
                        notes: (0, exports.normalizeRestoredValue)((_13 = lesson.notes) !== null && _13 !== void 0 ? _13 : null),
                        questions: (0, exports.normalizeRestoredValue)((_14 = lesson.questions) !== null && _14 !== void 0 ? _14 : null),
                        attachments: (0, exports.normalizeRestoredValue)((_15 = lesson.attachments) !== null && _15 !== void 0 ? _15 : null),
                        slides: (0, exports.normalizeRestoredValue)((_16 = lesson.slides) !== null && _16 !== void 0 ? _16 : null),
                        assignments: (0, exports.normalizeRestoredValue)((_17 = lesson.assignments) !== null && _17 !== void 0 ? _17 : null),
                        standards: (_18 = lesson.standards) !== null && _18 !== void 0 ? _18 : null,
                        indicators: (_19 = lesson.indicators) !== null && _19 !== void 0 ? _19 : null,
                        learningOutcomes: (_20 = lesson.learningOutcomes) !== null && _20 !== void 0 ? _20 : null,
                        isCentral: (_21 = lesson.isCentral) !== null && _21 !== void 0 ? _21 : false,
                        isVisible: lesson.isVisible !== undefined ? !!lesson.isVisible : true,
                        publishDate: lesson.publishDate ? new Date(lesson.publishDate) : null,
                        cutOffDate: lesson.cutOffDate ? new Date(lesson.cutOffDate) : null,
                        order: (_22 = lesson.order) !== null && _22 !== void 0 ? _22 : 0,
                        duration: (_23 = lesson.duration) !== null && _23 !== void 0 ? _23 : 0,
                        createdAt: (_24 = toDate(lesson.createdAt)) !== null && _24 !== void 0 ? _24 : new Date(),
                        updatedAt: (_25 = toDate(lesson.updatedAt)) !== null && _25 !== void 0 ? _25 : new Date()
                    };
                    yield tx.lesson.upsert({
                        where: { id: lesson.id },
                        update: payload,
                        create: Object.assign({ id: lesson.id }, payload)
                    });
                }
            }
            if (data.lessonProgress && data.lessonProgress.length > 0) {
                yield tx.lessonProgress.createMany({
                    data: data.lessonProgress.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt), updatedAt: new Date(x.updatedAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.courseProgress && data.courseProgress.length > 0) {
                yield tx.courseProgress.createMany({
                    data: data.courseProgress.filter((x) => validCourseIds.has(x.courseId)).map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt), updatedAt: new Date(x.updatedAt), lastAccessedAt: new Date(x.lastAccessedAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.exam && data.exam.length > 0) {
                for (const exam of data.exam) {
                    if (!(exam === null || exam === void 0 ? void 0 : exam.id))
                        continue;
                    if (exam.courseId && !validCourseIds.has(exam.courseId)) {
                        console.warn(`Skipping exam ${exam.title} because courseId ${exam.courseId} is missing.`);
                        continue;
                    }
                    const payload = {
                        title: exam.title,
                        description: (0, exports.normalizeRestoredValue)((_26 = exam.description) !== null && _26 !== void 0 ? _26 : null),
                        type: (_27 = exam.type) !== null && _27 !== void 0 ? _27 : 'Quiz',
                        duration: (_28 = exam.duration) !== null && _28 !== void 0 ? _28 : 30,
                        passingScore: (_29 = exam.passingScore) !== null && _29 !== void 0 ? _29 : 50,
                        isCentral: (_30 = exam.isCentral) !== null && _30 !== void 0 ? _30 : false,
                        showAnswers: (_31 = exam.showAnswers) !== null && _31 !== void 0 ? _31 : true,
                        resultVisibility: (_32 = exam.resultVisibility) !== null && _32 !== void 0 ? _32 : 'SHOW_SCORE',
                        password: (_33 = exam.password) !== null && _33 !== void 0 ? _33 : null,
                        startDate: exam.startDate ? new Date(exam.startDate) : null,
                        endDate: exam.endDate ? new Date(exam.endDate) : null,
                        attemptsAllowed: (_34 = exam.attemptsAllowed) !== null && _34 !== void 0 ? _34 : 1,
                        status: (_35 = exam.status) !== null && _35 !== void 0 ? _35 : 'PUBLISHED',
                        category: (_36 = exam.category) !== null && _36 !== void 0 ? _36 : null,
                        grade: (_37 = exam.grade) !== null && _37 !== void 0 ? _37 : null,
                        grades: (_38 = exam.grades) !== null && _38 !== void 0 ? _38 : null,
                        subjects: (_39 = exam.subjects) !== null && _39 !== void 0 ? _39 : null,
                        schoolId: (_40 = exam.schoolId) !== null && _40 !== void 0 ? _40 : null,
                        courseId: (_41 = exam.courseId) !== null && _41 !== void 0 ? _41 : null,
                        skill: (_42 = exam.skill) !== null && _42 !== void 0 ? _42 : null,
                        level: (_43 = exam.level) !== null && _43 !== void 0 ? _43 : 'Medium',
                        createdAt: (_44 = toDate(exam.createdAt)) !== null && _44 !== void 0 ? _44 : new Date(),
                        updatedAt: (_45 = toDate(exam.updatedAt)) !== null && _45 !== void 0 ? _45 : new Date()
                    };
                    yield tx.exam.upsert({
                        where: { id: exam.id },
                        update: payload,
                        create: Object.assign({ id: exam.id }, payload)
                    });
                }
            }
            if (data.question && data.question.length > 0) {
                for (const question of data.question) {
                    if (!(question === null || question === void 0 ? void 0 : question.id))
                        continue;
                    const payload = {
                        examId: question.examId,
                        text: (0, exports.normalizeRestoredValue)(question.text),
                        type: (_46 = question.type) !== null && _46 !== void 0 ? _46 : 'MCQ',
                        options: (0, exports.normalizeRestoredValue)(question.options),
                        correctAnswer: (0, exports.normalizeRestoredValue)(question.correctAnswer),
                        points: (_47 = question.points) !== null && _47 !== void 0 ? _47 : 0,
                        skill: (_48 = question.skill) !== null && _48 !== void 0 ? _48 : null,
                        standard: (_49 = question.standard) !== null && _49 !== void 0 ? _49 : null,
                        learningOutcome: (_50 = question.learningOutcome) !== null && _50 !== void 0 ? _50 : null,
                        level: (_51 = question.level) !== null && _51 !== void 0 ? _51 : 'Medium',
                        order: (_52 = question.order) !== null && _52 !== void 0 ? _52 : 0,
                        explanation: (0, exports.normalizeRestoredValue)((_53 = question.explanation) !== null && _53 !== void 0 ? _53 : null),
                        createdAt: (_54 = toDate(question.createdAt)) !== null && _54 !== void 0 ? _54 : new Date(),
                        updatedAt: (_55 = toDate(question.updatedAt)) !== null && _55 !== void 0 ? _55 : new Date()
                    };
                    yield tx.question.upsert({
                        where: { id: question.id },
                        update: payload,
                        create: Object.assign({ id: question.id }, payload)
                    });
                }
            }
            if (data.examSubmission && data.examSubmission.length > 0) {
                yield tx.examSubmission.createMany({
                    data: data.examSubmission.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.studentAnswer && data.studentAnswer.length > 0) {
                yield tx.studentAnswer.createMany({
                    data: data.studentAnswer.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.activityLog && data.activityLog.length > 0) {
                yield tx.activityLog.createMany({
                    data: data.activityLog.map((x) => (Object.assign(Object.assign({}, x), { timestamp: new Date(x.timestamp) }))),
                    skipDuplicates: true
                });
            }
            if (data.lessonBlock && data.lessonBlock.length > 0) {
                for (const block of data.lessonBlock) {
                    if (!(block === null || block === void 0 ? void 0 : block.id))
                        continue;
                    const blockPayload = {
                        lessonId: block.lessonId,
                        type: block.type,
                        content: (_56 = block.content) !== null && _56 !== void 0 ? _56 : null,
                        order: (_57 = block.order) !== null && _57 !== void 0 ? _57 : 0,
                        createdAt: block.createdAt ? new Date(block.createdAt) : new Date(),
                        updatedAt: block.updatedAt ? new Date(block.updatedAt) : new Date()
                    };
                    yield tx.lessonBlock.upsert({
                        where: { id: block.id },
                        update: blockPayload,
                        create: Object.assign({ id: block.id }, blockPayload)
                    });
                }
            }
            if (data.dynamicSection && data.dynamicSection.length > 0) {
                yield tx.dynamicSection.createMany({
                    data: data.dynamicSection.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt), updatedAt: new Date(x.updatedAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.blockAnswer && data.blockAnswer.length > 0) {
                yield tx.blockAnswer.createMany({
                    data: data.blockAnswer.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt), updatedAt: new Date(x.updatedAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.skillCluster && data.skillCluster.length > 0) {
                yield tx.skillCluster.createMany({
                    data: data.skillCluster.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt), updatedAt: new Date(x.updatedAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.skillLesson && data.skillLesson.length > 0) {
                yield tx.skillLesson.createMany({
                    data: data.skillLesson.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt), updatedAt: new Date(x.updatedAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.interactiveActivity && data.interactiveActivity.length > 0) {
                yield tx.interactiveActivity.createMany({
                    data: data.interactiveActivity.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt), updatedAt: new Date(x.updatedAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.activityAttempt && data.activityAttempt.length > 0) {
                yield tx.activityAttempt.createMany({
                    data: data.activityAttempt.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt) }))),
                    skipDuplicates: true
                });
            }
            if (data.xpHistory && data.xpHistory.length > 0) {
                yield tx.xPHistory.createMany({
                    data: data.xpHistory.map((x) => (Object.assign(Object.assign({}, x), { createdAt: new Date(x.createdAt) }))),
                    skipDuplicates: true
                });
            }
            // 3. Connect implicit M:N relationships
            if (data.courseToSchool && data.courseToSchool.length > 0) {
                for (const item of data.courseToSchool) {
                    const validSchools = (item.schools || [])
                        .map((s) => (typeof s === "object" && s ? s.id : s))
                        .filter((id) => Boolean(id && typeof id === "string" && id !== "null" && id !== "undefined" && id.trim() !== ""))
                        .map((id) => ({ id: id.trim() }));
                    if (validSchools.length > 0) {
                        yield tx.course.update({
                            where: { id: item.id },
                            data: {
                                schools: {
                                    connect: validSchools
                                }
                            }
                        });
                    }
                }
            }
            if (data.examToSchool && data.examToSchool.length > 0) {
                for (const item of data.examToSchool) {
                    const validSchools = (item.schools || [])
                        .map((s) => (typeof s === "object" && s ? s.id : s))
                        .filter((id) => Boolean(id && typeof id === "string" && id !== "null" && id !== "undefined" && id.trim() !== ""))
                        .map((id) => ({ id: id.trim() }));
                    if (validSchools.length > 0) {
                        yield tx.exam.update({
                            where: { id: item.id },
                            data: {
                                schools: {
                                    connect: validSchools
                                }
                            }
                        });
                    }
                }
            }
        }), {
            timeout: 300000 // 5 minutes - needed for large datasets with many slides
        });
        res.json({ success: true, message: 'Database restored successfully from backup.' });
    }
    catch (error) {
        console.error('❌ Restore error:', error);
        res.status(500).json({ error: 'Failed to restore database', details: error.message });
    }
});
exports.postBackupHandler13 = postBackupHandler13;
const postBackupHandler14 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { filename, courseId } = req.body;
        if (!filename || !courseId) {
            return res.status(400).json({ error: 'filename and courseId are required' });
        }
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        // Search in backups dir AND root dir for the file
        const searchPaths = [
            path_1.default.join(exports.BACKUPS_DIR, filename),
            path_1.default.join(process.cwd(), filename)
        ];
        let filePath = searchPaths.find(p => fs_1.default.existsSync(p));
        if (!filePath) {
            return res.status(404).json({ error: 'Backup file not found' });
        }
        const backup = readLocalBackupFile(filePath, filename);
        const data = backup.data || backup;
        // Find the course in the backup
        const backupCourses = Array.isArray(data.course) ? data.course : [];
        const targetCourse = backupCourses.find((c) => c.id === courseId);
        if (!targetCourse) {
            return res.status(404).json({ error: `Course '${courseId}' not found in this backup file` });
        }
        // Find lessons for this course
        const backupLessons = (Array.isArray(data.lesson) ? data.lesson : [])
            .filter((l) => l.courseId === courseId);
        console.log(`[Partial Restore] Found ${backupLessons.length} lessons for course '${targetCourse.title}' in backup ${filename}`);
        // Check if course exists in current DB
        const existingCourse = yield prisma_1.default.course.findUnique({ where: { id: courseId } });
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Restore course if missing
            if (!existingCourse) {
                yield tx.course.create({
                    data: Object.assign(Object.assign({}, targetCourse), { createdAt: new Date(targetCourse.createdAt), updatedAt: new Date(targetCourse.updatedAt) })
                });
                console.log(`[Partial Restore] Restored missing course '${targetCourse.title}'`);
            }
            // For each lesson in backup: upsert (restore if missing, skip if exists)
            let restoredCount = 0;
            let skippedCount = 0;
            for (const lesson of backupLessons) {
                const existing = yield tx.lesson.findUnique({ where: { id: lesson.id } });
                if (!existing) {
                    yield tx.lesson.create({
                        data: Object.assign(Object.assign({}, lesson), { courseId, createdAt: new Date(lesson.createdAt), updatedAt: new Date(lesson.updatedAt), publishDate: lesson.publishDate ? new Date(lesson.publishDate) : null, cutOffDate: lesson.cutOffDate ? new Date(lesson.cutOffDate) : null })
                    });
                    restoredCount++;
                }
                else {
                    skippedCount++;
                }
            }
            console.log(`[Partial Restore] Restored: ${restoredCount}, Skipped (already exist): ${skippedCount}`);
        }), { timeout: 120000 });
        // Return fresh course data
        const freshCourse = yield prisma_1.default.course.findUnique({
            where: { id: courseId },
            include: { lessons: { orderBy: { order: 'asc' } } }
        });
        res.json({
            success: true,
            message: `Course lessons restored from backup. Backup date: ${backup.timestamp || 'unknown'}`,
            course: freshCourse
        });
    }
    catch (error) {
        console.error('❌ Partial restore error:', error);
        res.status(500).json({ error: 'Failed to restore course', details: error.message });
    }
});
exports.postBackupHandler14 = postBackupHandler14;
const getBackupHandler15 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { query } = req.query;
        if (!query || query.length < 2) {
            return res.status(400).json({ error: 'Query must be at least 2 characters long' });
        }
        const searchQuery = String(query).toLowerCase();
        const results = [];
        const foundLessonIds = new Set();
        // 1️⃣ Search in Current Active Database
        try {
            const dbLessons = yield prisma_1.default.lesson.findMany({
                where: {
                    OR: [
                        { title: { contains: query, mode: 'insensitive' } },
                        { domain: { contains: query, mode: 'insensitive' } },
                        { course: { title: { contains: query, mode: 'insensitive' } } }
                    ]
                },
                include: { course: true },
                take: 20
            });
            for (const lesson of dbLessons) {
                foundLessonIds.add(lesson.id);
                results.push({
                    lessonId: lesson.id,
                    lessonTitle: lesson.title,
                    courseId: lesson.courseId,
                    courseTitle: ((_a = lesson.course) === null || _a === void 0 ? void 0 : _a.title) || 'Unknown Course',
                    backupFilename: 'قاعدة البيانات الحالية (Active DB)',
                    backupDate: lesson.updatedAt,
                    isCurrentDB: true,
                    source: 'active'
                });
            }
        }
        catch (err) {
            console.error('Error searching active DB:', err.message);
        }
        // 2️⃣ Search in ALL Local Backup Files (backups/, root, recovery.json, etc.)
        const searchDirs = [
            exports.BACKUPS_DIR,
            process.cwd(),
            '/app',
            '/app/uploads/backups'
        ];
        const seenFiles = new Set();
        const localFiles = [];
        for (const dir of searchDirs) {
            try {
                if (!fs_1.default.existsSync(dir) || !fs_1.default.statSync(dir).isDirectory())
                    continue;
                for (const file of fs_1.default.readdirSync(dir)) {
                    if (!file.endsWith('.json') && !file.endsWith('.zip'))
                        continue;
                    if (file.startsWith('backup-') || file.startsWith('backup_') || file === 'recovery.json' || file === 'courses_dump.json') {
                        const fp = path_1.default.join(dir, file);
                        if (!seenFiles.has(fp)) {
                            seenFiles.add(fp);
                            localFiles.push({ filename: file, filePath: fp, mtime: fs_1.default.statSync(fp).mtime });
                        }
                    }
                }
            }
            catch ( /* skip */_d) { /* skip */ }
        }
        localFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        for (const bFile of localFiles) {
            try {
                const backup = readLocalBackupFile(bFile.filePath, bFile.filename);
                const data = backup.data || backup;
                const backupLessons = Array.isArray(data.lesson) ? data.lesson : [];
                const backupCourses = Array.isArray(data.course) ? data.course : [];
                const courseMap = new Map(backupCourses.map((c) => [c.id, c.title]));
                for (const lesson of backupLessons) {
                    if (!(lesson === null || lesson === void 0 ? void 0 : lesson.title) || !(lesson === null || lesson === void 0 ? void 0 : lesson.id))
                        continue;
                    const matchTitle = lesson.title.toLowerCase().includes(searchQuery);
                    const matchDomain = lesson.domain && lesson.domain.toLowerCase().includes(searchQuery);
                    const matchCourse = (_b = courseMap.get(lesson.courseId)) === null || _b === void 0 ? void 0 : _b.toLowerCase().includes(searchQuery);
                    if (matchTitle || matchDomain || matchCourse) {
                        if (!foundLessonIds.has(lesson.id)) {
                            foundLessonIds.add(lesson.id);
                            results.push({
                                lessonId: lesson.id,
                                lessonTitle: lesson.title,
                                courseId: lesson.courseId,
                                courseTitle: courseMap.get(lesson.courseId) || 'Unknown Course',
                                backupFilename: bFile.filename,
                                backupDate: bFile.mtime,
                                source: 'local'
                            });
                        }
                    }
                }
            }
            catch ( /* skip malformed */_e) { /* skip malformed */ }
        }
        // 3️⃣ Search in Cloud Backup DB (cloud_backups table)
        try {
            const { Pool } = require('pg');
            const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
            const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 2, connectionTimeoutMillis: 5000 });
            const cloudRes = yield cloudPool.query(`
        SELECT name, data, created_at
        FROM cloud_backups
        ORDER BY created_at DESC
        LIMIT 3;
      `);
            yield cloudPool.end();
            for (const row of cloudRes.rows) {
                try {
                    const data = ((_c = row.data) === null || _c === void 0 ? void 0 : _c.data) || row.data;
                    const courses = Array.isArray(data === null || data === void 0 ? void 0 : data.course) ? data.course : [];
                    const lessons = Array.isArray(data === null || data === void 0 ? void 0 : data.lesson) ? data.lesson : [];
                    const courseMap = new Map(courses.map((c) => [c.id, c.title]));
                    // Extract lessons embedded in courses array (REALTIME_SYNC format)
                    for (const c of courses) {
                        if (Array.isArray(c.lessons)) {
                            for (const l of c.lessons) {
                                if (!(l === null || l === void 0 ? void 0 : l.id) || !(l === null || l === void 0 ? void 0 : l.title))
                                    continue;
                                if (l.title.toLowerCase().includes(searchQuery) && !foundLessonIds.has(l.id)) {
                                    foundLessonIds.add(l.id);
                                    results.push({
                                        lessonId: l.id,
                                        lessonTitle: l.title,
                                        courseId: l.courseId || c.id,
                                        courseTitle: c.title || 'Unknown Course',
                                        backupFilename: `السحابة: ${row.name}`,
                                        backupDate: row.created_at,
                                        source: 'cloud'
                                    });
                                }
                            }
                        }
                    }
                    for (const l of lessons) {
                        if (!(l === null || l === void 0 ? void 0 : l.id) || !(l === null || l === void 0 ? void 0 : l.title))
                            continue;
                        if (l.title.toLowerCase().includes(searchQuery) && !foundLessonIds.has(l.id)) {
                            foundLessonIds.add(l.id);
                            results.push({
                                lessonId: l.id,
                                lessonTitle: l.title,
                                courseId: l.courseId,
                                courseTitle: courseMap.get(l.courseId) || 'Unknown Course',
                                backupFilename: `السحابة: ${row.name}`,
                                backupDate: row.created_at,
                                source: 'cloud'
                            });
                        }
                    }
                }
                catch ( /* skip */_f) { /* skip */ }
            }
        }
        catch (cloudErr) {
            console.warn('Warning: Cloud backup DB search skipped:', cloudErr.message);
        }
        res.json({ results, totalCount: results.length });
    }
    catch (error) {
        console.error('❌ Search lesson error:', error);
        res.status(500).json({ error: 'Failed to search for lesson', details: error.message });
    }
});
exports.getBackupHandler15 = getBackupHandler15;
const postBackupHandler16 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { filename, source } = req.body;
        let backupData = null;
        if (source === 'cloud' || (filename && filename.startsWith('السحابة:'))) {
            const { Pool } = require('pg');
            const cloudPool = new Pool({ connectionString: process.env.BACKUP_DB_URL, max: 2, connectionTimeoutMillis: 5000 });
            let actualName = filename ? filename.replace('السحابة:', '').trim() : '';
            let cloudRes;
            if (actualName) {
                cloudRes = yield cloudPool.query(`SELECT data FROM cloud_backups WHERE name = $1 LIMIT 1;`, [actualName]);
            }
            else {
                cloudRes = yield cloudPool.query(`SELECT data FROM cloud_backups ORDER BY created_at DESC LIMIT 1;`);
            }
            yield cloudPool.end();
            if (cloudRes.rows.length > 0) {
                backupData = ((_a = cloudRes.rows[0].data) === null || _a === void 0 ? void 0 : _a.data) || cloudRes.rows[0].data;
            }
        }
        else {
            const searchDirs = [exports.BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
            for (const dir of searchDirs) {
                if (backupData)
                    break;
                try {
                    if (!fs_1.default.existsSync(dir) || !fs_1.default.statSync(dir).isDirectory())
                        continue;
                    const fp = path_1.default.join(dir, filename);
                    if (fs_1.default.existsSync(fp)) {
                        const parsed = readLocalBackupFile(fp, filename);
                        backupData = parsed.data || parsed;
                    }
                }
                catch (_b) { }
            }
        }
        if (!backupData) {
            return res.status(404).json({ error: 'Backup not found or unable to parse.' });
        }
        const courses = Array.isArray(backupData.course) ? backupData.course : [];
        const lessons = Array.isArray(backupData.lesson) ? backupData.lesson : [];
        const exams = Array.isArray(backupData.exam) ? backupData.exam : [];
        const tree = [];
        for (const c of courses) {
            const courseNode = {
                id: c.id,
                type: 'course',
                title: c.title,
                children: []
            };
            const courseLessons = lessons.filter((l) => l.courseId === c.id);
            for (const l of courseLessons) {
                courseNode.children.push({ id: l.id, type: 'lesson', title: l.title });
            }
            const courseExams = exams.filter((e) => e.courseId === c.id);
            for (const e of courseExams) {
                courseNode.children.push({ id: e.id, type: 'exam', title: e.title });
            }
            tree.push(courseNode);
        }
        // Check for orphaned lessons/exams (just in case)
        const orphanedLessons = lessons.filter((l) => !courses.find((c) => c.id === l.courseId));
        if (orphanedLessons.length > 0) {
            const orphanNode = { id: 'orphans', type: 'course', title: 'Orphaned Items', children: [] };
            for (const l of orphanedLessons)
                orphanNode.children.push({ id: l.id, type: 'lesson', title: l.title });
            tree.push(orphanNode);
        }
        res.json({ tree });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to explore backup', details: error.message });
    }
});
exports.postBackupHandler16 = postBackupHandler16;
const postBackupHandler17 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { filename, source, selections } = req.body;
        if (!selections || !Array.isArray(selections) || selections.length === 0) {
            return res.status(400).json({ error: 'No items selected for restore.' });
        }
        let backupData = null;
        // ... Load backupData (same logic as explore)
        if (source === 'cloud' || (filename && filename.startsWith('السحابة:'))) {
            const { Pool } = require('pg');
            const cloudPool = new Pool({ connectionString: process.env.BACKUP_DB_URL, max: 2, connectionTimeoutMillis: 5000 });
            let actualName = filename ? filename.replace('السحابة:', '').trim() : '';
            let cloudRes;
            if (actualName) {
                cloudRes = yield cloudPool.query(`SELECT data FROM cloud_backups WHERE name = $1 LIMIT 1;`, [actualName]);
            }
            else {
                cloudRes = yield cloudPool.query(`SELECT data FROM cloud_backups ORDER BY created_at DESC LIMIT 1;`);
            }
            yield cloudPool.end();
            if (cloudRes.rows.length > 0) {
                backupData = ((_a = cloudRes.rows[0].data) === null || _a === void 0 ? void 0 : _a.data) || cloudRes.rows[0].data;
            }
        }
        else {
            const searchDirs = [exports.BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
            for (const dir of searchDirs) {
                if (backupData)
                    break;
                try {
                    const fp = path_1.default.join(dir, filename);
                    if (fs_1.default.existsSync(fp)) {
                        const parsed = readLocalBackupFile(fp, filename);
                        backupData = parsed.data || parsed;
                    }
                }
                catch (_b) { }
            }
        }
        if (!backupData)
            return res.status(404).json({ error: 'Backup not found.' });
        const bCourses = Array.isArray(backupData.course) ? backupData.course : [];
        const bLessons = Array.isArray(backupData.lesson) ? backupData.lesson : [];
        const bExams = Array.isArray(backupData.exam) ? backupData.exam : [];
        const parseSafe = (v) => { if (!v)
            return null; if (typeof v === 'string') {
            try {
                return JSON.parse(v);
            }
            catch (_a) {
                return v;
            }
        } return v; };
        const toDate = (v) => v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null;
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15;
            for (const sel of selections) {
                if (sel.type === 'course') {
                    const c = bCourses.find((x) => x.id === sel.id);
                    if (!c)
                        continue;
                    yield tx.course.upsert({
                        where: { id: c.id },
                        update: { title: c.title, description: c.description, coverImage: c.coverImage, grade: c.grade, grades: c.grades, subject: c.subject, country: c.country, isCentral: c.isCentral, schoolId: c.schoolId, updatedAt: new Date() },
                        create: { id: c.id, title: c.title, description: c.description, coverImage: c.coverImage, grade: c.grade, grades: c.grades, subject: c.subject, country: c.country || 'مصر', isCentral: c.isCentral || false, schoolId: c.schoolId, createdAt: toDate(c.createdAt) || new Date(), updatedAt: toDate(c.updatedAt) || new Date() }
                    });
                    // Restore all its lessons
                    const cLessons = bLessons.filter((l) => l.courseId === c.id);
                    for (const l of cLessons) {
                        yield tx.lesson.upsert({
                            where: { id: l.id },
                            update: { courseId: c.id, title: l.title, domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() },
                            create: { id: l.id, courseId: c.id, title: l.title || 'Untitled', domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() }
                        });
                    }
                    // Restore all its exams
                    const cExams = bExams.filter((e) => e.courseId === c.id);
                    for (const e of cExams) {
                        const ePayload = {
                            title: (_a = e.title) !== null && _a !== void 0 ? _a : 'Untitled',
                            description: (_b = e.description) !== null && _b !== void 0 ? _b : null,
                            type: (_c = e.type) !== null && _c !== void 0 ? _c : 'Quiz',
                            duration: (_d = e.duration) !== null && _d !== void 0 ? _d : 30,
                            passingScore: (_e = e.passingScore) !== null && _e !== void 0 ? _e : 50,
                            isCentral: (_f = e.isCentral) !== null && _f !== void 0 ? _f : false,
                            showAnswers: (_g = e.showAnswers) !== null && _g !== void 0 ? _g : true,
                            resultVisibility: (_h = e.resultVisibility) !== null && _h !== void 0 ? _h : 'SHOW_SCORE',
                            password: (_j = e.password) !== null && _j !== void 0 ? _j : null,
                            startDate: e.startDate ? new Date(e.startDate) : null,
                            endDate: e.endDate ? new Date(e.endDate) : null,
                            attemptsAllowed: (_k = e.attemptsAllowed) !== null && _k !== void 0 ? _k : 1,
                            status: (_l = e.status) !== null && _l !== void 0 ? _l : 'PUBLISHED',
                            category: (_m = e.category) !== null && _m !== void 0 ? _m : null,
                            grade: (_o = e.grade) !== null && _o !== void 0 ? _o : null,
                            grades: (_p = e.grades) !== null && _p !== void 0 ? _p : null,
                            subjects: (_q = e.subjects) !== null && _q !== void 0 ? _q : null,
                            schoolId: (_r = e.schoolId) !== null && _r !== void 0 ? _r : null,
                            courseId: c.id,
                            skill: (_s = e.skill) !== null && _s !== void 0 ? _s : null,
                            level: (_t = e.level) !== null && _t !== void 0 ? _t : 'Medium',
                            createdAt: (_u = toDate(e.createdAt)) !== null && _u !== void 0 ? _u : new Date(),
                            updatedAt: (_v = toDate(e.updatedAt)) !== null && _v !== void 0 ? _v : new Date()
                        };
                        yield tx.exam.upsert({
                            where: { id: e.id },
                            update: ePayload,
                            create: Object.assign({ id: e.id }, ePayload)
                        });
                    }
                }
                else if (sel.type === 'lesson') {
                    const l = bLessons.find((x) => x.id === sel.id);
                    if (!l)
                        continue;
                    const targetCourseId = sel.targetCourseId || l.courseId;
                    yield tx.lesson.upsert({
                        where: { id: l.id },
                        update: { courseId: targetCourseId, title: l.title, domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() },
                        create: { id: l.id, courseId: targetCourseId, title: l.title || 'Untitled', domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() }
                    });
                }
                else if (sel.type === 'exam') {
                    const e = bExams.find((x) => x.id === sel.id);
                    if (!e)
                        continue;
                    const targetCourseId = sel.targetCourseId || e.courseId;
                    const ePayload = {
                        title: (_w = e.title) !== null && _w !== void 0 ? _w : 'Untitled',
                        description: (_x = e.description) !== null && _x !== void 0 ? _x : null,
                        type: (_y = e.type) !== null && _y !== void 0 ? _y : 'Quiz',
                        duration: (_z = e.duration) !== null && _z !== void 0 ? _z : 30,
                        passingScore: (_0 = e.passingScore) !== null && _0 !== void 0 ? _0 : 50,
                        isCentral: (_1 = e.isCentral) !== null && _1 !== void 0 ? _1 : false,
                        showAnswers: (_2 = e.showAnswers) !== null && _2 !== void 0 ? _2 : true,
                        resultVisibility: (_3 = e.resultVisibility) !== null && _3 !== void 0 ? _3 : 'SHOW_SCORE',
                        password: (_4 = e.password) !== null && _4 !== void 0 ? _4 : null,
                        startDate: e.startDate ? new Date(e.startDate) : null,
                        endDate: e.endDate ? new Date(e.endDate) : null,
                        attemptsAllowed: (_5 = e.attemptsAllowed) !== null && _5 !== void 0 ? _5 : 1,
                        status: (_6 = e.status) !== null && _6 !== void 0 ? _6 : 'PUBLISHED',
                        category: (_7 = e.category) !== null && _7 !== void 0 ? _7 : null,
                        grade: (_8 = e.grade) !== null && _8 !== void 0 ? _8 : null,
                        grades: (_9 = e.grades) !== null && _9 !== void 0 ? _9 : null,
                        subjects: (_10 = e.subjects) !== null && _10 !== void 0 ? _10 : null,
                        schoolId: (_11 = e.schoolId) !== null && _11 !== void 0 ? _11 : null,
                        courseId: targetCourseId,
                        skill: (_12 = e.skill) !== null && _12 !== void 0 ? _12 : null,
                        level: (_13 = e.level) !== null && _13 !== void 0 ? _13 : 'Medium',
                        createdAt: (_14 = toDate(e.createdAt)) !== null && _14 !== void 0 ? _14 : new Date(),
                        updatedAt: (_15 = toDate(e.updatedAt)) !== null && _15 !== void 0 ? _15 : new Date()
                    };
                    yield tx.exam.upsert({
                        where: { id: e.id },
                        update: ePayload,
                        create: Object.assign({ id: e.id }, ePayload)
                    });
                }
            }
        }), { timeout: 60000 }); // 60s timeout for large restores
        res.json({ success: true, message: 'Selective restore completed successfully.' });
    }
    catch (error) {
        console.error('❌ Selective restore error:', error);
        res.status(500).json({ error: 'Failed to perform selective restore', details: error.message });
    }
});
exports.postBackupHandler17 = postBackupHandler17;
const getBackupHandler18 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8;
    try {
        const { Pool } = require('pg');
        const cloudPool = new Pool({ connectionString: process.env.BACKUP_DB_URL, max: 1 });
        // Fetch recent 10 backups
        const cloudRes = yield cloudPool.query(`SELECT data FROM cloud_backups WHERE type != 'ARCHIVE' AND type != 'REALTIME_SYNC' ORDER BY created_at DESC LIMIT 10;`);
        yield cloudPool.end();
        if (cloudRes.rows.length === 0) {
            return res.status(404).send('No recent backups found');
        }
        const lessonId = 'e4d57cff-cd8f-43bc-99dc-21687205ecd6';
        const targetCourseId = '7235296d-686b-4d4b-b77f-07343ffe9865';
        let targetLesson = null;
        for (const row of cloudRes.rows) {
            const data = ((_a = row.data) === null || _a === void 0 ? void 0 : _a.data) || row.data;
            const lessons = Array.isArray(data === null || data === void 0 ? void 0 : data.lesson) ? data.lesson : [];
            targetLesson = lessons.find((l) => l.id === lessonId);
            if (targetLesson)
                break;
        }
        if (!targetLesson) {
            // Fallback: search local files
            const fs = require('fs');
            const path = require('path');
            const searchDirs = [process.cwd(), '/app', '/app/uploads/backups'];
            for (const dir of searchDirs) {
                if (targetLesson)
                    break;
                try {
                    if (!fs.existsSync(dir))
                        continue;
                    for (const file of fs.readdirSync(dir)) {
                        if (!file.endsWith('.json'))
                            continue;
                        try {
                            const fileData = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
                            const payload = fileData.data || fileData;
                            const lessons = Array.isArray(payload.lesson) ? payload.lesson : [];
                            targetLesson = lessons.find((l) => l.id === lessonId);
                            if (targetLesson)
                                break;
                        }
                        catch (e) { }
                    }
                }
                catch (e) { }
            }
        }
        if (!targetLesson) {
            return res.status(404).send('Lesson not found in recent 10 backups or local files. Please try restoring normally from the UI once to trigger a local upload, then hitting this endpoint again!');
        }
        const parseSafe = (v) => {
            if (!v)
                return null;
            if (typeof v === 'string') {
                try {
                    return JSON.parse(v);
                }
                catch (_a) {
                    return v;
                }
            }
            return v;
        };
        const toDate = (v) => v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null;
        yield prisma_1.default.lesson.upsert({
            where: { id: lessonId },
            update: {
                courseId: targetCourseId,
                title: targetLesson.title,
                domain: (_b = targetLesson.domain) !== null && _b !== void 0 ? _b : null,
                content: (_c = targetLesson.content) !== null && _c !== void 0 ? _c : null,
                videoUrl: (_d = targetLesson.videoUrl) !== null && _d !== void 0 ? _d : null,
                duration: (_e = targetLesson.duration) !== null && _e !== void 0 ? _e : 0,
                summary: (_f = targetLesson.summary) !== null && _f !== void 0 ? _f : null,
                notes: (_g = targetLesson.notes) !== null && _g !== void 0 ? _g : null,
                questions: (_h = parseSafe(targetLesson.questions)) !== null && _h !== void 0 ? _h : null,
                assignments: (_j = parseSafe(targetLesson.assignments)) !== null && _j !== void 0 ? _j : null,
                attachments: (_k = parseSafe(targetLesson.attachments)) !== null && _k !== void 0 ? _k : null,
                slides: (_l = parseSafe(targetLesson.slides)) !== null && _l !== void 0 ? _l : null,
                standards: (_m = targetLesson.standards) !== null && _m !== void 0 ? _m : null,
                indicators: (_o = targetLesson.indicators) !== null && _o !== void 0 ? _o : null,
                learningOutcomes: (_p = targetLesson.learningOutcomes) !== null && _p !== void 0 ? _p : null,
                isCentral: (_q = targetLesson.isCentral) !== null && _q !== void 0 ? _q : false,
                isVisible: true,
                publishDate: toDate(targetLesson.publishDate),
                cutOffDate: toDate(targetLesson.cutOffDate),
                order: (_r = targetLesson.order) !== null && _r !== void 0 ? _r : 0,
                updatedAt: new Date(),
            },
            create: {
                id: lessonId,
                courseId: targetCourseId,
                title: targetLesson.title || 'Untitled Lesson',
                domain: (_s = targetLesson.domain) !== null && _s !== void 0 ? _s : null,
                content: (_t = targetLesson.content) !== null && _t !== void 0 ? _t : null,
                videoUrl: (_u = targetLesson.videoUrl) !== null && _u !== void 0 ? _u : null,
                duration: (_v = targetLesson.duration) !== null && _v !== void 0 ? _v : 0,
                summary: (_w = targetLesson.summary) !== null && _w !== void 0 ? _w : null,
                notes: (_x = targetLesson.notes) !== null && _x !== void 0 ? _x : null,
                questions: (_y = parseSafe(targetLesson.questions)) !== null && _y !== void 0 ? _y : null,
                assignments: (_z = parseSafe(targetLesson.assignments)) !== null && _z !== void 0 ? _z : null,
                attachments: (_0 = parseSafe(targetLesson.attachments)) !== null && _0 !== void 0 ? _0 : null,
                slides: (_1 = parseSafe(targetLesson.slides)) !== null && _1 !== void 0 ? _1 : null,
                standards: (_2 = targetLesson.standards) !== null && _2 !== void 0 ? _2 : null,
                indicators: (_3 = targetLesson.indicators) !== null && _3 !== void 0 ? _3 : null,
                learningOutcomes: (_4 = targetLesson.learningOutcomes) !== null && _4 !== void 0 ? _4 : null,
                isCentral: (_5 = targetLesson.isCentral) !== null && _5 !== void 0 ? _5 : false,
                isVisible: true,
                publishDate: toDate(targetLesson.publishDate),
                cutOffDate: toDate(targetLesson.cutOffDate),
                order: (_6 = targetLesson.order) !== null && _6 !== void 0 ? _6 : 0,
                createdAt: (_7 = toDate(targetLesson.createdAt)) !== null && _7 !== void 0 ? _7 : new Date(),
                updatedAt: (_8 = toDate(targetLesson.updatedAt)) !== null && _8 !== void 0 ? _8 : new Date(),
            }
        });
        res.send(`✅ تم إضافة الدرس بنجاح إلى الكورس المطلوب!`);
    }
    catch (err) {
        res.status(500).send(`Error: ${err.message}`);
    }
});
exports.getBackupHandler18 = getBackupHandler18;
const postBackupHandler19 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { filename, lessonId, source } = req.body;
        if (!lessonId) {
            return res.status(400).json({ error: 'lessonId is required' });
        }
        let targetLesson = null;
        let targetCourse = null;
        // A. If source is cloud or filename starts with 'السحابة:'
        if (source === 'cloud' || (filename && filename.startsWith('السحابة:'))) {
            const { Pool } = require('pg');
            const BACKUP_DB_URL = process.env.BACKUP_DB_URL;
            const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 2, connectionTimeoutMillis: 5000 });
            let actualName = filename ? filename.replace('السحابة:', '').trim() : '';
            let cloudRes;
            if (actualName) {
                cloudRes = yield cloudPool.query(`SELECT data FROM cloud_backups WHERE name = $1 LIMIT 1;`, [actualName]);
            }
            else {
                cloudRes = yield cloudPool.query(`SELECT data FROM cloud_backups ORDER BY created_at DESC LIMIT 3;`);
            }
            yield cloudPool.end();
            for (const row of cloudRes.rows) {
                const data = ((_a = row.data) === null || _a === void 0 ? void 0 : _a.data) || row.data;
                const courses = Array.isArray(data === null || data === void 0 ? void 0 : data.course) ? data.course : [];
                const lessons = Array.isArray(data === null || data === void 0 ? void 0 : data.lesson) ? data.lesson : [];
                for (const c of courses) {
                    if (Array.isArray(c.lessons)) {
                        const found = c.lessons.find((l) => l.id === lessonId);
                        if (found) {
                            targetLesson = Object.assign(Object.assign({}, found), { courseId: found.courseId || c.id });
                            targetCourse = c;
                            break;
                        }
                    }
                }
                if (!targetLesson) {
                    const found = lessons.find((l) => l.id === lessonId);
                    if (found) {
                        targetLesson = found;
                        targetCourse = courses.find((c) => c.id === found.courseId);
                    }
                }
                if (targetLesson)
                    break;
            }
        }
        else {
            // B. Search in local files
            const searchDirs = [exports.BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
            const seenFiles = new Set();
            for (const dir of searchDirs) {
                if (targetLesson)
                    break;
                try {
                    if (!fs_1.default.existsSync(dir) || !fs_1.default.statSync(dir).isDirectory())
                        continue;
                    for (const file of fs_1.default.readdirSync(dir)) {
                        if (!file.endsWith('.json') && !file.endsWith('.zip'))
                            continue;
                        const fp = path_1.default.join(dir, file);
                        if (seenFiles.has(fp))
                            continue;
                        seenFiles.add(fp);
                        try {
                            const backup = readLocalBackupFile(fp, file);
                            const data = backup.data || backup;
                            const lessons = Array.isArray(data.lesson) ? data.lesson : [];
                            const courses = Array.isArray(data.course) ? data.course : [];
                            const found = lessons.find((l) => l.id === lessonId);
                            if (found) {
                                targetLesson = found;
                                targetCourse = courses.find((c) => c.id === found.courseId);
                                break;
                            }
                        }
                        catch ( /* skip */_c) { /* skip */ }
                    }
                }
                catch ( /* skip */_d) { /* skip */ }
            }
        }
        if (!targetLesson) {
            return res.status(404).json({ error: `Lesson '${lessonId}' not found in any backup file or cloud record.` });
        }
        const parseSafe = (v) => {
            if (!v)
                return null;
            if (typeof v === 'string') {
                try {
                    return JSON.parse(v);
                }
                catch (_a) {
                    return v;
                }
            }
            return v;
        };
        const toDate = (v) => v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null;
        // Check if course exists in current primary DB
        const existingCourse = yield prisma_1.default.course.findUnique({ where: { id: targetLesson.courseId } });
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16;
            // Auto-restore parent course if missing!
            if (!existingCourse && targetCourse) {
                console.log(`[Lesson Restore] Auto-restoring missing parent course '${targetCourse.title}' (${targetCourse.id})`);
                yield tx.course.upsert({
                    where: { id: targetCourse.id },
                    update: { title: targetCourse.title },
                    create: {
                        id: targetCourse.id,
                        title: targetCourse.title,
                        description: (_a = targetCourse.description) !== null && _a !== void 0 ? _a : null,
                        coverImage: (_b = targetCourse.coverImage) !== null && _b !== void 0 ? _b : null,
                        grade: (_c = targetCourse.grade) !== null && _c !== void 0 ? _c : null,
                        grades: (_d = targetCourse.grades) !== null && _d !== void 0 ? _d : null,
                        subject: (_e = targetCourse.subject) !== null && _e !== void 0 ? _e : null,
                        country: targetCourse.country || 'مصر',
                        isCentral: (_f = targetCourse.isCentral) !== null && _f !== void 0 ? _f : false,
                        schoolId: (_g = targetCourse.schoolId) !== null && _g !== void 0 ? _g : null,
                        createdAt: (_h = toDate(targetCourse.createdAt)) !== null && _h !== void 0 ? _h : new Date(),
                        updatedAt: (_j = toDate(targetCourse.updatedAt)) !== null && _j !== void 0 ? _j : new Date(),
                    }
                });
            }
            // Upsert the lesson
            yield tx.lesson.upsert({
                where: { id: lessonId },
                update: {
                    title: targetLesson.title,
                    domain: (_k = targetLesson.domain) !== null && _k !== void 0 ? _k : null,
                    content: (_l = targetLesson.content) !== null && _l !== void 0 ? _l : null,
                    videoUrl: (_m = targetLesson.videoUrl) !== null && _m !== void 0 ? _m : null,
                    duration: (_o = targetLesson.duration) !== null && _o !== void 0 ? _o : 0,
                    summary: (_p = targetLesson.summary) !== null && _p !== void 0 ? _p : null,
                    notes: (_q = targetLesson.notes) !== null && _q !== void 0 ? _q : null,
                    questions: (_r = parseSafe(targetLesson.questions)) !== null && _r !== void 0 ? _r : null,
                    assignments: (_s = parseSafe(targetLesson.assignments)) !== null && _s !== void 0 ? _s : null,
                    attachments: (_t = parseSafe(targetLesson.attachments)) !== null && _t !== void 0 ? _t : null,
                    slides: (_u = parseSafe(targetLesson.slides)) !== null && _u !== void 0 ? _u : null,
                    standards: (_v = targetLesson.standards) !== null && _v !== void 0 ? _v : null,
                    indicators: (_w = targetLesson.indicators) !== null && _w !== void 0 ? _w : null,
                    learningOutcomes: (_x = targetLesson.learningOutcomes) !== null && _x !== void 0 ? _x : null,
                    isCentral: (_y = targetLesson.isCentral) !== null && _y !== void 0 ? _y : false,
                    isVisible: targetLesson.isVisible !== undefined ? !!targetLesson.isVisible : true,
                    publishDate: toDate(targetLesson.publishDate),
                    cutOffDate: toDate(targetLesson.cutOffDate),
                    order: (_z = targetLesson.order) !== null && _z !== void 0 ? _z : 0,
                    updatedAt: new Date(),
                },
                create: {
                    id: lessonId,
                    courseId: targetLesson.courseId,
                    title: targetLesson.title || 'Untitled Lesson',
                    domain: (_0 = targetLesson.domain) !== null && _0 !== void 0 ? _0 : null,
                    content: (_1 = targetLesson.content) !== null && _1 !== void 0 ? _1 : null,
                    videoUrl: (_2 = targetLesson.videoUrl) !== null && _2 !== void 0 ? _2 : null,
                    duration: (_3 = targetLesson.duration) !== null && _3 !== void 0 ? _3 : 0,
                    summary: (_4 = targetLesson.summary) !== null && _4 !== void 0 ? _4 : null,
                    notes: (_5 = targetLesson.notes) !== null && _5 !== void 0 ? _5 : null,
                    questions: (_6 = parseSafe(targetLesson.questions)) !== null && _6 !== void 0 ? _6 : null,
                    assignments: (_7 = parseSafe(targetLesson.assignments)) !== null && _7 !== void 0 ? _7 : null,
                    attachments: (_8 = parseSafe(targetLesson.attachments)) !== null && _8 !== void 0 ? _8 : null,
                    slides: (_9 = parseSafe(targetLesson.slides)) !== null && _9 !== void 0 ? _9 : null,
                    standards: (_10 = targetLesson.standards) !== null && _10 !== void 0 ? _10 : null,
                    indicators: (_11 = targetLesson.indicators) !== null && _11 !== void 0 ? _11 : null,
                    learningOutcomes: (_12 = targetLesson.learningOutcomes) !== null && _12 !== void 0 ? _12 : null,
                    isCentral: (_13 = targetLesson.isCentral) !== null && _13 !== void 0 ? _13 : false,
                    isVisible: targetLesson.isVisible !== undefined ? !!targetLesson.isVisible : true,
                    publishDate: toDate(targetLesson.publishDate),
                    cutOffDate: toDate(targetLesson.cutOffDate),
                    order: (_14 = targetLesson.order) !== null && _14 !== void 0 ? _14 : 0,
                    createdAt: (_15 = toDate(targetLesson.createdAt)) !== null && _15 !== void 0 ? _15 : new Date(),
                    updatedAt: (_16 = toDate(targetLesson.updatedAt)) !== null && _16 !== void 0 ? _16 : new Date(),
                }
            });
            // 🔓 Remove from tombstones if previously marked as deleted
            const { unmarkLessonDeleted, unmarkCourseDeleted } = yield Promise.resolve().then(() => __importStar(require('../lib/tombstones')));
            unmarkLessonDeleted(lessonId);
            if (targetLesson.courseId)
                unmarkCourseDeleted(targetLesson.courseId);
        }));
        const freshLesson = yield prisma_1.default.lesson.findUnique({ where: { id: lessonId }, include: { course: true } });
        console.log(`✅ [Lesson Restore] Restored lesson "${freshLesson === null || freshLesson === void 0 ? void 0 : freshLesson.title}" (${lessonId}) to course "${(_b = freshLesson === null || freshLesson === void 0 ? void 0 : freshLesson.course) === null || _b === void 0 ? void 0 : _b.title}"`);
        res.json({
            success: true,
            message: `تم استعادة الدرس "${freshLesson === null || freshLesson === void 0 ? void 0 : freshLesson.title}" بنجاح في قاعدة البيانات الحالية.`,
            lesson: freshLesson
        });
    }
    catch (error) {
        console.error('❌ Lesson restore error:', error);
        res.status(500).json({ error: 'Failed to restore lesson', details: error.message });
    }
});
exports.postBackupHandler19 = postBackupHandler19;
const postBackupHandler20 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { filename, useLatest } = req.body;
        // --- Find the backup file ---
        let backupPath = null;
        if (useLatest) {
            // Use the largest (most data) backup file in the backups directory
            const files = fs_1.default.readdirSync(exports.BACKUPS_DIR)
                .filter(f => f.endsWith('.json') || f.endsWith('.zip'))
                .map(f => ({ name: f, size: fs_1.default.statSync(path_1.default.join(exports.BACKUPS_DIR, f)).size }))
                .sort((a, b) => b.size - a.size);
            if (files.length === 0)
                return res.status(404).json({ error: 'No backup files found in backups directory' });
            backupPath = path_1.default.join(exports.BACKUPS_DIR, files[0].name);
            console.log(`📂 [Content Restore] Using largest backup: ${files[0].name} (${(files[0].size / 1024 / 1024).toFixed(1)} MB)`);
        }
        else if (filename) {
            backupPath = path_1.default.join(exports.BACKUPS_DIR, path_1.default.basename(filename));
            if (!fs_1.default.existsSync(backupPath)) {
                return res.status(404).json({ error: `Backup file not found: ${filename}` });
            }
        }
        else {
            return res.status(400).json({ error: 'Provide either filename or useLatest:true' });
        }
        // --- Parse backup ---
        const parsed = readLocalBackupFile(backupPath, path_1.default.basename(backupPath));
        const data = parsed.data || parsed;
        const backupLessons = Array.isArray(data.lesson) ? data.lesson : [];
        if (backupLessons.length === 0) {
            return res.status(400).json({ error: 'No lessons found in backup file' });
        }
        console.log(`\n🎯 [Content Restore] Processing ${backupLessons.length} lessons from backup...`);
        // Helper: parse JSON field safely
        const parseSafe = (v) => {
            if (!v)
                return [];
            if (Array.isArray(v))
                return v;
            if (typeof v === 'string') {
                try {
                    const p = JSON.parse(v);
                    return Array.isArray(p) ? p : [];
                }
                catch (_a) {
                    return [];
                }
            }
            return [];
        };
        const report = [];
        let updated = 0;
        let skipped = 0;
        let notFound = 0;
        for (const bl of backupLessons) {
            if (!(bl === null || bl === void 0 ? void 0 : bl.id)) {
                skipped++;
                continue;
            }
            // Fetch current lesson from DB
            const current = yield prisma_1.default.lesson.findUnique({
                where: { id: bl.id },
                select: { id: true, title: true, questions: true, assignments: true, slides: true, attachments: true }
            });
            if (!current) {
                console.log(`  ⚠ Lesson not found in DB: "${bl.title}" (${bl.id})`);
                notFound++;
                continue;
            }
            const backupQ = parseSafe(bl.questions);
            const backupA = parseSafe(bl.assignments);
            const backupS = parseSafe(bl.slides);
            const backupAtt = parseSafe(bl.attachments);
            const currentQ = parseSafe(current.questions);
            const currentA = parseSafe(current.assignments);
            const currentS = parseSafe(current.slides);
            const currentAtt = parseSafe(current.attachments);
            // "Richer wins": only restore if backup has more items
            const finalQ = backupQ.length > currentQ.length ? backupQ : currentQ;
            const finalA = backupA.length > currentA.length ? backupA : currentA;
            const finalS = backupS.length > currentS.length ? backupS : currentS;
            const finalAtt = backupAtt.length > currentAtt.length ? backupAtt : currentAtt;
            const qChanged = backupQ.length > currentQ.length;
            const aChanged = backupA.length > currentA.length;
            const sChanged = backupS.length > currentS.length;
            const attChanged = backupAtt.length > currentAtt.length;
            if (!qChanged && !aChanged && !sChanged && !attChanged) {
                skipped++;
                continue;
            }
            const updateData = {};
            if (qChanged)
                updateData.questions = finalQ;
            if (aChanged)
                updateData.assignments = finalA;
            if (sChanged)
                updateData.slides = finalS;
            if (attChanged)
                updateData.attachments = finalAtt;
            updateData.updatedAt = new Date();
            yield prisma_1.default.lesson.update({ where: { id: bl.id }, data: updateData });
            const changes = [
                qChanged ? `Q: ${currentQ.length}→${finalQ.length}` : null,
                aChanged ? `A: ${currentA.length}→${finalA.length}` : null,
                sChanged ? `S: ${currentS.length}→${finalS.length}` : null,
                attChanged ? `Att: ${currentAtt.length}→${finalAtt.length}` : null,
            ].filter(Boolean).join(' | ');
            console.log(`  ✅ "${current.title}" [${changes}]`);
            report.push({ lessonId: bl.id, title: current.title, changes });
            updated++;
        }
        console.log(`\n🎯 [Content Restore] DONE — Updated: ${updated}, Skipped (already ok): ${skipped}, Not found: ${notFound}`);
        return res.json({
            success: true,
            message: `تم استعادة محتوى ${updated} درس بنجاح`,
            updated,
            skipped,
            notFound,
            total: backupLessons.length,
            details: report
        });
    }
    catch (error) {
        console.error('❌ [Content Restore] Error:', error);
        return res.status(500).json({ error: 'Failed to restore lesson content', details: error.message });
    }
});
exports.postBackupHandler20 = postBackupHandler20;
exports.BACKUPS_DIR = path_1.default.join(process.cwd(), 'uploads', 'backups');
function parseBackupBuffer(buffer, filename) {
    const lowerName = filename.toLowerCase();
    if (lowerName.endsWith('.zip')) {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(buffer);
        (0, runtimeSecurity_1.assertSafeArchiveEntries)(zip.getEntries());
        const entries = zip.getEntries()
            .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.json'))
            .sort((a, b) => b.header.size - a.header.size);
        if (entries.length === 0) {
            throw new Error('ZIP backup does not contain a JSON payload.');
        }
        return JSON.parse(entries[0].getData().toString('utf-8'));
    }
    return JSON.parse(buffer.toString('utf-8'));
}
function generateFullSystemBackupData() {
    return __awaiter(this, void 0, void 0, function* () {
        const [schools, users, classrooms, courses, studentEnrollments, teacherCourses, lessons, exams, questions, lessonBlocks, dynamicSections, examsWithSchools, coursesWithSchools, skillClusters, skillLessons, interactiveActivities, lessonProgress, courseProgress, examSubmission, studentAnswer, activityLog, blockAnswer, activityAttempt, xpHistory] = yield Promise.all([
            prisma_1.default.school.findMany(),
            prisma_1.default.user.findMany(),
            prisma_1.default.classroom.findMany(),
            prisma_1.default.course.findMany({ where: { deletedAt: null } }),
            prisma_1.default.studentEnrollment.findMany(),
            prisma_1.default.teacherCourse.findMany(),
            prisma_1.default.lesson.findMany({ where: { deletedAt: null } }),
            prisma_1.default.exam.findMany(),
            prisma_1.default.question.findMany(),
            prisma_1.default.lessonBlock.findMany(),
            prisma_1.default.dynamicSection.findMany(),
            prisma_1.default.exam.findMany({ select: { id: true, schools: { select: { id: true } } } }),
            prisma_1.default.course.findMany({ where: { deletedAt: null }, select: { id: true, schools: { select: { id: true } } } }),
            prisma_1.default.skillCluster.findMany(),
            prisma_1.default.skillLesson.findMany(),
            prisma_1.default.interactiveActivity.findMany(),
            prisma_1.default.lessonProgress.findMany(),
            prisma_1.default.courseProgress.findMany(),
            prisma_1.default.examSubmission.findMany(),
            prisma_1.default.studentAnswer.findMany(),
            prisma_1.default.activityLog.findMany(),
            prisma_1.default.blockAnswer.findMany(),
            prisma_1.default.activityAttempt.findMany(),
            prisma_1.default.xPHistory.findMany()
        ]);
        return {
            version: '1.0',
            timestamp: new Date().toISOString(),
            data: {
                school: schools,
                user: users,
                classroom: classrooms,
                course: courses,
                studentEnrollment: studentEnrollments,
                teacherCourse: teacherCourses,
                lesson: lessons,
                exam: exams,
                question: questions,
                lessonBlock: lessonBlocks,
                dynamicSection: dynamicSections,
                examToSchool: examsWithSchools,
                courseToSchool: coursesWithSchools,
                skillCluster: skillClusters,
                skillLesson: skillLessons,
                interactiveActivity: interactiveActivities,
                lessonProgress: lessonProgress,
                courseProgress: courseProgress,
                examSubmission: examSubmission,
                studentAnswer: studentAnswer,
                activityLog: activityLog,
                blockAnswer: blockAnswer,
                activityAttempt: activityAttempt,
                xpHistory: xpHistory
            }
        };
    });
}
function performBackupAndPruning() {
    return __awaiter(this, void 0, void 0, function* () {
        const egyptTime = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour12: false });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup-${timestamp}.json`;
        const filePath = path_1.default.join(exports.BACKUPS_DIR, filename);
        const backupData = yield generateFullSystemBackupData();
        // 1️⃣ Save locally
        fs_1.default.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');
        const size = fs_1.default.statSync(filePath).size;
        console.log(`💾 [Backup] Saved locally: ${filename} | توقيت مصر: ${egyptTime}`);
        // 2️⃣ Save to Cloud Backup cloud in background (non-blocking)
        const cloudName = `auto_hourly_backup_egypt_${egyptTime.replace(/[/,:\s]/g, '-')}`;
        (0, db_backup_1.saveToCloudBackup)(cloudName, 'AUTO_HOURLY', backupData)
            .then(saved => {
            if (saved) {
                console.log(`☁️ [Backup] Saved to Cloud Backup cloud: ${cloudName}`);
            }
            else {
                console.warn(`⚠️ [Backup] Cloud save skipped (Cloud Backup unavailable): ${cloudName}`);
            }
        })
            .catch((err) => {
            console.error(`❌ [Backup] Cloud save failed: ${err.message}`);
        });
        // 3️⃣ Prune local backups — keep only the latest 100
        // Keep only the latest 100 backups (= ~100 hours at hourly intervals, Egypt time)
        // Older backups are deleted only when the count exceeds 100
        try {
            const files = fs_1.default.readdirSync(exports.BACKUPS_DIR)
                .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')))
                .map(file => {
                const fp = path_1.default.join(exports.BACKUPS_DIR, file);
                const stats = fs_1.default.statSync(fp);
                return {
                    filename: file,
                    filePath: fp,
                    createdAt: stats.birthtime || stats.mtime
                };
            })
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            if (files.length > 50) {
                const filesToDelete = files.slice(50);
                for (const f of filesToDelete) {
                    fs_1.default.unlinkSync(f.filePath);
                    console.log(`🗑️ [Backup Scheduler] Deleted old backup (kept latest 50): ${f.filename}`);
                }
            }
        }
        catch (err) {
            console.error('❌ [Backup Scheduler] Error pruning old backups:', err.message);
        }
        return {
            filename,
            size,
            createdAt: backupData.timestamp
        };
    });
}
const normalizeRestoredValue = (value) => (0, shared_1.externalizeEmbeddedDataImages)(value);
exports.normalizeRestoredValue = normalizeRestoredValue;
function readLocalBackupFile(filePath, filename) {
    return parseBackupBuffer(fs_1.default.readFileSync(filePath), filename);
}
