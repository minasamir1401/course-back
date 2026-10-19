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
exports.postBackupHandler10 = exports.getBackupHandler9 = exports.getBackupHandler8 = exports.getBackupHandler7 = exports.postBackupHandler6 = exports.postBackupHandler5 = exports.postBackupHandler4 = exports.getBackupHandler3 = exports.getBackupHandler2 = exports.postBackupHandler1 = void 0;
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const backupSnapshot_1 = require("../lib/backupSnapshot");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const db_backup_1 = require("../lib/db-backup");
const backupRestore_1 = require("./backupRestore");
const backupMaintenance_1 = require("./backupMaintenance");
const postBackupHandler1 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield (0, backupMaintenance_1.performBackupAndPruning)();
        res.json({
            message: 'Backup created successfully',
            filename: result.filename,
            size: result.size,
            createdAt: result.createdAt
        });
    }
    catch (error) {
        console.error(' Backup creation error:', error);
        res.status(500).json({ error: 'Failed to create backup', details: error.message });
    }
});
exports.postBackupHandler1 = postBackupHandler1;
const getBackupHandler2 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const files = fs_1.default.readdirSync(backupSnapshot_1.BACKUPS_DIR)
            .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')))
            .map(file => {
            const filePath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, file);
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
        console.error(' Backup list error:', error);
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
        console.error(' Cloud backup list error:', error);
        res.status(500).json({ error: 'Failed to list cloud backups', details: error.message });
    }
});
exports.getBackupHandler3 = getBackupHandler3;
const postBackupHandler4 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fullData = yield (0, backupMaintenance_1.generateFullSystemBackupData)();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup_manual_cloud_${timestamp}`;
        const saved = yield (0, db_backup_1.saveToCloudBackup)(backupName, 'MANUAL', fullData);
        if (!saved) {
            return res.status(500).json({ error: 'Failed to save cloud backup to Cloud Backup' });
        }
        res.json({ message: 'Cloud backup created successfully on Cloud Backup', filename: backupName });
    }
    catch (error) {
        console.error(' Cloud backup create error:', error);
        res.status(500).json({ error: 'Failed to create cloud backup', details: error.message });
    }
});
exports.postBackupHandler4 = postBackupHandler4;
const postBackupHandler5 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const allCourses = yield prisma_1.default.course.findMany({
            include: {
                lessons: { include: { blocks: true } },
                exams: {
                    include: {
                        questions: true,
                        modules: {
                            where: { parentModuleId: null },
                            include: {
                                subExams: true,
                                subModules: {
                                    include: {
                                        subExams: true
                                    }
                                }
                            }
                        }
                    }
                },
                schools: true,
                school: true
            }
        });
        const standaloneExams = yield prisma_1.default.exam.findMany({
            where: { courseId: null },
            include: {
                questions: true,
                modules: {
                    where: { parentModuleId: null },
                    include: {
                        subExams: true,
                        subModules: {
                            include: {
                                subExams: true
                            }
                        }
                    }
                }
            }
        });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup_forced_sync_${timestamp}`;
        const saved = yield (0, db_backup_1.saveToCloudBackup)(backupName, 'REALTIME_SYNC', {
            data: {
                course: allCourses,
                exam: standaloneExams
            }
        });
        if (!saved) {
            return res.status(500).json({ error: 'Failed to sync courses to Cloud Backup' });
        }
        console.log(`[Force Sync] Synced ${allCourses.length} courses and ${standaloneExams.length} standalone exams to Cloud Backup as REALTIME_SYNC`);
        res.json({
            message: `تمت مزامنة ${allCourses.length} كورس و ${standaloneExams.length} امتحان بنجاح إلى Cloud Backup`,
            coursesCount: allCourses.length,
            examsCount: standaloneExams.length,
            backupName
        });
    }
    catch (error) {
        console.error('Cloud sync-all error:', error);
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
        // 1. Fetch the most recent cloud backup records
        const result = yield cloudPool.query(`
      SELECT data, created_at, type
      FROM cloud_backups
      WHERE type IN ('FULL_SYSTEM', 'REALTIME_SYNC', 'AUTO_HOURLY', 'MANUAL', 'FULL_SYSTEM')
      ORDER BY created_at DESC
      LIMIT 30;
    `);
        yield cloudPool.end();
        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'No cloud backup records found' });
        }
        // 2. Merge all course, lesson, and modular exam data from cloud records (newest first)
        const mergedCourses = new Map();
        const mergedLessons = new Map();
        const mergedExams = new Map();
        const mergedModules = new Map();
        const mergedSubExams = new Map();
        const mergedQuestions = new Map();
        for (const row of result.rows) {
            try {
                const payload = row.data;
                const data = (payload === null || payload === void 0 ? void 0 : payload.data) || payload;
                const courses = Array.isArray(data === null || data === void 0 ? void 0 : data.course) ? data.course : [];
                const lessons = Array.isArray(data === null || data === void 0 ? void 0 : data.lesson) ? data.lesson : [];
                const exams = Array.isArray(data === null || data === void 0 ? void 0 : data.exam) ? data.exam : [];
                const modules = Array.isArray(data === null || data === void 0 ? void 0 : data.examModule) ? data.examModule : [];
                const subExams = Array.isArray(data === null || data === void 0 ? void 0 : data.subExam) ? data.subExam : [];
                const questions = Array.isArray(data === null || data === void 0 ? void 0 : data.question) ? data.question : [];
                for (const c of courses) {
                    if ((c === null || c === void 0 ? void 0 : c.id) && !mergedCourses.has(c.id)) {
                        mergedCourses.set(c.id, c);
                        if (Array.isArray(c.lessons)) {
                            for (const l of c.lessons) {
                                if ((l === null || l === void 0 ? void 0 : l.id) && !mergedLessons.has(l.id)) {
                                    mergedLessons.set(l.id, Object.assign(Object.assign({}, l), { courseId: l.courseId || c.id }));
                                }
                            }
                        }
                        if (Array.isArray(c.exams)) {
                            for (const e of c.exams) {
                                if ((e === null || e === void 0 ? void 0 : e.id) && !mergedExams.has(e.id)) {
                                    mergedExams.set(e.id, Object.assign(Object.assign({}, e), { courseId: e.courseId || c.id }));
                                    if (Array.isArray(e.questions)) {
                                        for (const q of e.questions) {
                                            if ((q === null || q === void 0 ? void 0 : q.id) && !mergedQuestions.has(q.id))
                                                mergedQuestions.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id }));
                                        }
                                    }
                                    if (Array.isArray(e.modules)) {
                                        for (const m of e.modules) {
                                            if ((m === null || m === void 0 ? void 0 : m.id) && !mergedModules.has(m.id)) {
                                                mergedModules.set(m.id, Object.assign(Object.assign({}, m), { examId: e.id }));
                                            }
                                            if (Array.isArray(m.subExams)) {
                                                for (const se of m.subExams) {
                                                    if ((se === null || se === void 0 ? void 0 : se.id) && !mergedSubExams.has(se.id))
                                                        mergedSubExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: m.id }));
                                                }
                                            }
                                            if (Array.isArray(m.subModules)) {
                                                for (const sm of m.subModules) {
                                                    if ((sm === null || sm === void 0 ? void 0 : sm.id) && !mergedModules.has(sm.id))
                                                        mergedModules.set(sm.id, Object.assign(Object.assign({}, sm), { examId: e.id, parentModuleId: m.id }));
                                                    if (Array.isArray(sm.subExams)) {
                                                        for (const se of sm.subExams) {
                                                            if ((se === null || se === void 0 ? void 0 : se.id) && !mergedSubExams.has(se.id))
                                                                mergedSubExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: sm.id }));
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                for (const l of lessons) {
                    if ((l === null || l === void 0 ? void 0 : l.id) && !mergedLessons.has(l.id))
                        mergedLessons.set(l.id, l);
                }
                for (const e of exams) {
                    if ((e === null || e === void 0 ? void 0 : e.id) && !mergedExams.has(e.id)) {
                        mergedExams.set(e.id, e);
                        if (Array.isArray(e.questions)) {
                            for (const q of e.questions) {
                                if ((q === null || q === void 0 ? void 0 : q.id) && !mergedQuestions.has(q.id))
                                    mergedQuestions.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id }));
                            }
                        }
                        if (Array.isArray(e.modules)) {
                            for (const m of e.modules) {
                                if ((m === null || m === void 0 ? void 0 : m.id) && !mergedModules.has(m.id)) {
                                    mergedModules.set(m.id, Object.assign(Object.assign({}, m), { examId: e.id }));
                                }
                                if (Array.isArray(m.subExams)) {
                                    for (const se of m.subExams) {
                                        if ((se === null || se === void 0 ? void 0 : se.id) && !mergedSubExams.has(se.id))
                                            mergedSubExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: m.id }));
                                    }
                                }
                                if (Array.isArray(m.subModules)) {
                                    for (const sm of m.subModules) {
                                        if ((sm === null || sm === void 0 ? void 0 : sm.id) && !mergedModules.has(sm.id))
                                            mergedModules.set(sm.id, Object.assign(Object.assign({}, sm), { examId: e.id, parentModuleId: m.id }));
                                        if (Array.isArray(sm.subExams)) {
                                            for (const se of sm.subExams) {
                                                if ((se === null || se === void 0 ? void 0 : se.id) && !mergedSubExams.has(se.id))
                                                    mergedSubExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: sm.id }));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                for (const m of modules) {
                    if ((m === null || m === void 0 ? void 0 : m.id) && !mergedModules.has(m.id))
                        mergedModules.set(m.id, m);
                    if (Array.isArray(m.subExams)) {
                        for (const se of m.subExams) {
                            if ((se === null || se === void 0 ? void 0 : se.id) && !mergedSubExams.has(se.id))
                                mergedSubExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: m.id }));
                        }
                    }
                    if (Array.isArray(m.subModules)) {
                        for (const sm of m.subModules) {
                            if ((sm === null || sm === void 0 ? void 0 : sm.id) && !mergedModules.has(sm.id))
                                mergedModules.set(sm.id, Object.assign(Object.assign({}, sm), { examId: m.examId, parentModuleId: m.id }));
                            if (Array.isArray(sm.subExams)) {
                                for (const se of sm.subExams) {
                                    if ((se === null || se === void 0 ? void 0 : se.id) && !mergedSubExams.has(se.id))
                                        mergedSubExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: sm.id }));
                                }
                            }
                        }
                    }
                }
                for (const se of subExams) {
                    if ((se === null || se === void 0 ? void 0 : se.id) && !mergedSubExams.has(se.id))
                        mergedSubExams.set(se.id, se);
                }
                for (const q of questions) {
                    if ((q === null || q === void 0 ? void 0 : q.id) && !mergedQuestions.has(q.id))
                        mergedQuestions.set(q.id, q);
                }
            }
            catch ( /* skip malformed records */_2) { /* skip malformed records */ }
        }
        console.log(`[Cloud Restore] Found ${mergedCourses.size} courses, ${mergedLessons.size} lessons, ${mergedExams.size} exams in cloud backup pool`);
        // 3. Load current primary DB state
        const [activeCourses, activeLessons, activeExams] = yield Promise.all([
            prisma_1.default.course.findMany({ select: { id: true } }),
            prisma_1.default.lesson.findMany({ select: { id: true } }),
            prisma_1.default.exam.findMany({ select: { id: true } })
        ]);
        const activeCourseIds = new Set(activeCourses.map((c) => c.id));
        const activeLessonIds = new Set(activeLessons.map((l) => l.id));
        const activeExamIds = new Set(activeExams.map((e) => e.id));
        const toDate = (v) => (v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null);
        let restoredCourses = 0;
        let restoredLessons = 0;
        let restoredExams = 0;
        let skippedCourses = 0;
        let skippedLessons = 0;
        let skippedExams = 0;
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
                details.push(`Course: "${c.title}"`);
                console.log(`[Cloud Restore] Restored course: "${c.title}" (${courseId})`);
            }
            catch (err) {
                if (err.code === 'P2002') {
                    skippedCourses++;
                    activeCourseIds.add(courseId);
                }
                else {
                    details.push(`Course "${c.title}": ${err.message}`);
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
                    data: Object.assign(Object.assign({ id: l.id, courseId: l.courseId, title: l.title || 'Untitled Lesson' }, (0, bilingualMetadata_1.metadataTranslations)(l, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: (_k = l.domain) !== null && _k !== void 0 ? _k : null, content: (_l = l.content) !== null && _l !== void 0 ? _l : null, videoUrl: (_m = l.videoUrl) !== null && _m !== void 0 ? _m : null, duration: (_o = l.duration) !== null && _o !== void 0 ? _o : 0, summary: (_p = l.summary) !== null && _p !== void 0 ? _p : null, notes: (_q = l.notes) !== null && _q !== void 0 ? _q : null, questions: (_r = parseSafe(l.questions)) !== null && _r !== void 0 ? _r : null, assignments: (_s = parseSafe(l.assignments)) !== null && _s !== void 0 ? _s : null, attachments: (_t = parseSafe(l.attachments)) !== null && _t !== void 0 ? _t : null, slides: (_u = parseSafe(l.slides)) !== null && _u !== void 0 ? _u : null, standards: (_v = l.standards) !== null && _v !== void 0 ? _v : null, indicators: (_w = l.indicators) !== null && _w !== void 0 ? _w : null, learningOutcomes: (_x = l.learningOutcomes) !== null && _x !== void 0 ? _x : null, isCentral: (_y = l.isCentral) !== null && _y !== void 0 ? _y : false, isVisible: l.isVisible !== undefined ? !!l.isVisible : true, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: (_z = l.order) !== null && _z !== void 0 ? _z : 0, createdAt: (_0 = toDate(l.createdAt)) !== null && _0 !== void 0 ? _0 : new Date(), updatedAt: (_1 = toDate(l.updatedAt)) !== null && _1 !== void 0 ? _1 : new Date() })
                });
                activeLessonIds.add(lessonId);
                restoredLessons++;
                details.push(`Lesson: "${l.title}"`);
                console.log(`[Cloud Restore] Restored lesson: "${l.title}" -> course ${l.courseId}`);
            }
            catch (err) {
                if (err.code === 'P2002') {
                    skippedLessons++;
                }
                else {
                    details.push(`Lesson "${l.title}": ${err.message}`);
                    skippedLessons++;
                }
            }
        }
        // 6. Restore missing exams (with modules, sub-exams, and bilingual questions)
        const backupDataWrapper = {
            examModule: Array.from(mergedModules.values()),
            subExam: Array.from(mergedSubExams.values()),
            question: Array.from(mergedQuestions.values())
        };
        for (const [examId, e] of mergedExams) {
            if (activeExamIds.has(examId)) {
                skippedExams++;
                continue;
            }
            if (e.courseId && !activeCourseIds.has(e.courseId)) {
                skippedExams++;
                continue;
            }
            try {
                yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                    var _a;
                    yield (0, backupRestore_1.restoreExamWithHierarchy)(tx, e, backupDataWrapper, (_a = e.courseId) !== null && _a !== void 0 ? _a : null);
                }), { timeout: 30000 });
                activeExamIds.add(examId);
                restoredExams++;
                details.push(`Exam: "${e.title}"`);
                console.log(`[Cloud Restore] Restored modular exam: "${e.title}" (${examId})`);
            }
            catch (err) {
                details.push(`Exam "${e.title}": ${err.message}`);
                skippedExams++;
            }
        }
        const summary = {
            success: true,
            message: `تم استعادة ${restoredCourses} كورس و ${restoredLessons} درس و ${restoredExams} امتحان من Cloud Backup إلى قاعدة البيانات الأساسية`,
            restoredCourses,
            restoredLessons,
            restoredExams,
            skippedCourses,
            skippedLessons,
            skippedExams,
            cloudRecordsScanned: result.rows.length,
            details: details.slice(0, 100)
        };
        console.log(`[Cloud Restore] COMPLETE - Courses: ${restoredCourses} restored, ${skippedCourses} skipped | Lessons: ${restoredLessons} restored, ${skippedLessons} skipped | Exams: ${restoredExams} restored, ${skippedExams} skipped`);
        res.json(summary);
    }
    catch (error) {
        console.error('Cloud restore error:', error);
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
        const filePath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, filename);
        if (!fs_1.default.existsSync(filePath)) {
            return res.status(404).json({ error: 'Backup file not found' });
        }
        res.download(filePath, filename);
    }
    catch (error) {
        console.error(' Backup download error:', error);
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
        const backupData = yield (0, backupMaintenance_1.generateFullSystemBackupData)();
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
        console.error(' Download full backup with media error:', error);
        if (!res.headersSent)
            res.status(500).json({ error: 'Failed to create full backup zip', details: error.message });
    }
});
exports.getBackupHandler8 = getBackupHandler8;
const getBackupHandler9 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const files = fs_1.default.readdirSync(backupSnapshot_1.BACKUPS_DIR)
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
            archive.file(path_1.default.join(backupSnapshot_1.BACKUPS_DIR, file), { name: file });
        }
        archive.finalize();
    }
    catch (error) {
        console.error(' Download all backups error:', error);
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
        console.error(' Manual bundle backups error:', error);
        res.status(500).json({ error: error.message || 'Failed to create manual bundle' });
    }
});
exports.postBackupHandler10 = postBackupHandler10;
