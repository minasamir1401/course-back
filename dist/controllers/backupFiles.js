"use strict";
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
exports.postBackupHandler16 = exports.getBackupHandler15 = exports.postBackupHandler14 = exports.postBackupHandler13 = exports.deleteBackupHandler12 = exports.postBackupHandler11 = void 0;
const backupSnapshot_1 = require("../lib/backupSnapshot");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const shared_1 = require("../shared");
const backupRestore_1 = require("./backupRestore");
const backupMaintenance_1 = require("./backupMaintenance");
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
        const parsed = (0, backupMaintenance_1.parseBackupBuffer)(fs_1.default.readFileSync(tempPath), req.file.originalname || req.file.filename);
        if (!parsed.data) {
            fs_1.default.unlinkSync(tempPath);
            return res.status(400).json({ error: 'Invalid backup format' });
        }
        const filename = `backup-uploaded-${Date.now()}${ext}`;
        const destPath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, filename);
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
                    console.log(` Extracted ${extractedMediaCount} media files from uploaded backup`);
                }
            }
            catch (err) {
                console.error('️ Failed to extract media from ZIP:', err.message);
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
        console.error(' Backup upload error:', error);
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
        const filePath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, filename);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            return res.json({ success: true, message: 'Local backup deleted successfully' });
        }
        return res.status(404).json({ error: 'Backup not found' });
    }
    catch (error) {
        console.error(' Delete backup error:', error);
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
            const filePath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, filename);
            if (!fs_1.default.existsSync(filePath)) {
                return res.status(404).json({ error: 'Backup file not found' });
            }
            backupData = (0, backupMaintenance_1.readLocalBackupFile)(filePath, filename);
        }
        const data = (backupData === null || backupData === void 0 ? void 0 : backupData.data) || backupData; // Handle both wrapper structure and plain object
        // v2 backups are validated inside restoreSnapshot using DMMF; v1 legacy backups may lack course/lesson arrays
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Incomplete backup: no data payload found' });
        }
        yield (0, backupMaintenance_1.performBackupAndPruning)();
        yield (0, backupSnapshot_1.restoreSnapshot)(prisma_1.default, backupData);
        res.json({ success: true, message: 'Database restored successfully from backup.' });
    }
    catch (error) {
        console.error(' Restore error:', error);
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
            path_1.default.join(backupSnapshot_1.BACKUPS_DIR, filename),
            path_1.default.join(process.cwd(), filename)
        ];
        let filePath = searchPaths.find(p => fs_1.default.existsSync(p));
        if (!filePath) {
            return res.status(404).json({ error: 'Backup file not found' });
        }
        const backup = (0, backupMaintenance_1.readLocalBackupFile)(filePath, filename);
        const data = backup.data || backup;
        // Find the course in the backup
        const backupCourses = Array.isArray(data.course) ? data.course : [];
        const targetCourse = backupCourses.find((c) => c.id === courseId);
        if (!targetCourse) {
            return res.status(404).json({ error: `Course '${courseId}' not found in this backup file` });
        }
        // Find lessons and exams for this course
        const backupLessons = (Array.isArray(data.lesson) ? data.lesson : [])
            .filter((l) => l.courseId === courseId);
        const backupExams = (Array.isArray(data.exam) ? data.exam : [])
            .filter((e) => e.courseId === courseId);
        if (Array.isArray(targetCourse.exams)) {
            for (const ce of targetCourse.exams) {
                if (!backupExams.some((x) => x.id === ce.id))
                    backupExams.push(ce);
            }
        }
        console.log(`[Partial Restore] Found ${backupLessons.length} lessons and ${backupExams.length} exams for course '${targetCourse.title}' in backup ${filename}`);
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
            // Restore course exams with modular hierarchy and bilingual questions
            for (const exam of backupExams) {
                yield (0, backupRestore_1.restoreExamWithHierarchy)(tx, exam, data, courseId);
            }
            console.log(`[Partial Restore] Restored: ${restoredCount}, Skipped (already exist): ${skippedCount}`);
        }), { timeout: 120000 });
        // Return fresh course data
        const freshCourse = yield prisma_1.default.course.findUnique({
            where: { id: courseId },
            include: { lessons: { orderBy: { order: 'asc' } }, exams: true }
        });
        res.json({
            success: true,
            message: `Course lessons and exams restored from backup. Backup date: ${backup.timestamp || 'unknown'}`,
            course: freshCourse
        });
    }
    catch (error) {
        console.error('Partial restore error:', error);
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
            backupSnapshot_1.BACKUPS_DIR,
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
                const backup = (0, backupMaintenance_1.readLocalBackupFile)(bFile.filePath, bFile.filename);
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
        console.error(' Search lesson error:', error);
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
            const searchDirs = [backupSnapshot_1.BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
            for (const dir of searchDirs) {
                if (backupData)
                    break;
                try {
                    if (!fs_1.default.existsSync(dir) || !fs_1.default.statSync(dir).isDirectory())
                        continue;
                    const fp = path_1.default.join(dir, filename);
                    if (fs_1.default.existsSync(fp)) {
                        const parsed = (0, backupMaintenance_1.readLocalBackupFile)(fp, filename);
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
        const questions = Array.isArray(backupData.question) ? backupData.question : [];
        const modules = Array.isArray(backupData.examModule) ? backupData.examModule : [];
        const subExams = Array.isArray(backupData.subExam) ? backupData.subExam : [];
        const formatExamLabel = (e) => {
            const examQuestions = questions.filter((q) => q.examId === e.id);
            const embeddedQ = Array.isArray(e.questions) ? e.questions : [];
            const totalQ = Math.max(examQuestions.length, embeddedQ.length);
            const examModules = modules.filter((m) => m.examId === e.id);
            const embeddedM = Array.isArray(e.modules) ? e.modules : [];
            const totalM = Math.max(examModules.length, embeddedM.length);
            const hasBilingual = [...examQuestions, ...embeddedQ].some((q) => (q === null || q === void 0 ? void 0 : q.textEn) || (q === null || q === void 0 ? void 0 : q.optionsEn));
            const tags = [];
            if (totalQ > 0)
                tags.push(`${totalQ} سؤال`);
            if (totalM > 0)
                tags.push(`${totalM} موديول`);
            if (hasBilingual)
                tags.push('ثنائي اللغة');
            return tags.length > 0 ? `${e.title || 'Untitled'} (${tags.join(' - ')})` : (e.title || 'Untitled');
        };
        const tree = [];
        const attachedExamIds = new Set();
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
            if (Array.isArray(c.exams)) {
                for (const ce of c.exams) {
                    if (!courseExams.some((x) => x.id === ce.id))
                        courseExams.push(ce);
                }
            }
            for (const e of courseExams) {
                attachedExamIds.add(e.id);
                courseNode.children.push({ id: e.id, type: 'exam', title: formatExamLabel(e) });
            }
            tree.push(courseNode);
        }
        const standaloneExams = exams.filter((e) => !attachedExamIds.has(e.id));
        if (standaloneExams.length > 0) {
            const standaloneNode = {
                id: 'standalone_exams',
                type: 'course',
                title: 'امتحانات مستقلة ومركزية',
                children: standaloneExams.map((e) => ({
                    id: e.id,
                    type: 'exam',
                    title: formatExamLabel(e)
                }))
            };
            tree.push(standaloneNode);
        }
        const courseIdSet = new Set(courses.map((c) => c.id));
        const orphanedLessons = lessons.filter((l) => !courseIdSet.has(l.courseId));
        if (orphanedLessons.length > 0) {
            const orphanNode = { id: 'orphaned_lessons', type: 'course', title: 'دروس منفصلة', children: [] };
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
