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
exports.postBackupHandler20 = exports.postBackupHandler19 = exports.getBackupHandler18 = exports.postBackupHandler17 = void 0;
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const backupSnapshot_1 = require("../lib/backupSnapshot");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const backupRestore_1 = require("./backupRestore");
const backupMaintenance_1 = require("./backupMaintenance");
const postBackupHandler17 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { filename, source, selections } = req.body;
        if (!selections || !Array.isArray(selections) || selections.length === 0) {
            return res.status(400).json({ error: 'No items selected for restore.' });
        }
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
                    const fp = path_1.default.join(dir, filename);
                    if (fs_1.default.existsSync(fp)) {
                        const parsed = (0, backupMaintenance_1.readLocalBackupFile)(fp, filename);
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
        const bExamsMap = new Map();
        if (Array.isArray(backupData.exam)) {
            for (const e of backupData.exam)
                if (e === null || e === void 0 ? void 0 : e.id)
                    bExamsMap.set(e.id, e);
        }
        for (const c of bCourses) {
            if (Array.isArray(c.exams)) {
                for (const e of c.exams)
                    if ((e === null || e === void 0 ? void 0 : e.id) && !bExamsMap.has(e.id))
                        bExamsMap.set(e.id, Object.assign(Object.assign({}, e), { courseId: e.courseId || c.id }));
            }
        }
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
                            update: Object.assign(Object.assign({ courseId: c.id, title: l.title }, (0, bilingualMetadata_1.metadataTranslations)(l, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() }),
                            create: Object.assign(Object.assign({ id: l.id, courseId: c.id, title: l.title || 'Untitled' }, (0, bilingualMetadata_1.metadataTranslations)(l, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() })
                        });
                    }
                    // Restore all its exams with complete hierarchy
                    const cExams = Array.from(bExamsMap.values()).filter((e) => e.courseId === c.id);
                    for (const e of cExams) {
                        yield (0, backupRestore_1.restoreExamWithHierarchy)(tx, e, backupData, c.id);
                    }
                }
                else if (sel.type === 'lesson') {
                    const l = bLessons.find((x) => x.id === sel.id);
                    if (!l)
                        continue;
                    const targetCourseId = sel.targetCourseId || l.courseId;
                    yield tx.lesson.upsert({
                        where: { id: l.id },
                        update: Object.assign(Object.assign({ courseId: targetCourseId, title: l.title }, (0, bilingualMetadata_1.metadataTranslations)(l, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() }),
                        create: Object.assign(Object.assign({ id: l.id, courseId: targetCourseId, title: l.title || 'Untitled' }, (0, bilingualMetadata_1.metadataTranslations)(l, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() })
                    });
                }
                else if (sel.type === 'exam') {
                    const e = bExamsMap.get(sel.id);
                    if (!e)
                        continue;
                    const targetCourseId = sel.targetCourseId !== undefined ? sel.targetCourseId : e.courseId;
                    yield (0, backupRestore_1.restoreExamWithHierarchy)(tx, e, backupData, targetCourseId);
                }
            }
        }), { timeout: 120000 });
        res.json({ success: true, message: 'Selective restore completed successfully.' });
    }
    catch (error) {
        console.error('Selective restore error:', error);
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
            update: Object.assign(Object.assign({ courseId: targetCourseId, title: targetLesson.title }, (0, bilingualMetadata_1.metadataTranslations)(targetLesson, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: (_b = targetLesson.domain) !== null && _b !== void 0 ? _b : null, content: (_c = targetLesson.content) !== null && _c !== void 0 ? _c : null, videoUrl: (_d = targetLesson.videoUrl) !== null && _d !== void 0 ? _d : null, duration: (_e = targetLesson.duration) !== null && _e !== void 0 ? _e : 0, summary: (_f = targetLesson.summary) !== null && _f !== void 0 ? _f : null, notes: (_g = targetLesson.notes) !== null && _g !== void 0 ? _g : null, questions: (_h = parseSafe(targetLesson.questions)) !== null && _h !== void 0 ? _h : null, assignments: (_j = parseSafe(targetLesson.assignments)) !== null && _j !== void 0 ? _j : null, attachments: (_k = parseSafe(targetLesson.attachments)) !== null && _k !== void 0 ? _k : null, slides: (_l = parseSafe(targetLesson.slides)) !== null && _l !== void 0 ? _l : null, standards: (_m = targetLesson.standards) !== null && _m !== void 0 ? _m : null, indicators: (_o = targetLesson.indicators) !== null && _o !== void 0 ? _o : null, learningOutcomes: (_p = targetLesson.learningOutcomes) !== null && _p !== void 0 ? _p : null, isCentral: (_q = targetLesson.isCentral) !== null && _q !== void 0 ? _q : false, isVisible: true, publishDate: toDate(targetLesson.publishDate), cutOffDate: toDate(targetLesson.cutOffDate), order: (_r = targetLesson.order) !== null && _r !== void 0 ? _r : 0, updatedAt: new Date() }),
            create: Object.assign(Object.assign({ id: lessonId, courseId: targetCourseId, title: targetLesson.title || 'Untitled Lesson' }, (0, bilingualMetadata_1.metadataTranslations)(targetLesson, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: (_s = targetLesson.domain) !== null && _s !== void 0 ? _s : null, content: (_t = targetLesson.content) !== null && _t !== void 0 ? _t : null, videoUrl: (_u = targetLesson.videoUrl) !== null && _u !== void 0 ? _u : null, duration: (_v = targetLesson.duration) !== null && _v !== void 0 ? _v : 0, summary: (_w = targetLesson.summary) !== null && _w !== void 0 ? _w : null, notes: (_x = targetLesson.notes) !== null && _x !== void 0 ? _x : null, questions: (_y = parseSafe(targetLesson.questions)) !== null && _y !== void 0 ? _y : null, assignments: (_z = parseSafe(targetLesson.assignments)) !== null && _z !== void 0 ? _z : null, attachments: (_0 = parseSafe(targetLesson.attachments)) !== null && _0 !== void 0 ? _0 : null, slides: (_1 = parseSafe(targetLesson.slides)) !== null && _1 !== void 0 ? _1 : null, standards: (_2 = targetLesson.standards) !== null && _2 !== void 0 ? _2 : null, indicators: (_3 = targetLesson.indicators) !== null && _3 !== void 0 ? _3 : null, learningOutcomes: (_4 = targetLesson.learningOutcomes) !== null && _4 !== void 0 ? _4 : null, isCentral: (_5 = targetLesson.isCentral) !== null && _5 !== void 0 ? _5 : false, isVisible: true, publishDate: toDate(targetLesson.publishDate), cutOffDate: toDate(targetLesson.cutOffDate), order: (_6 = targetLesson.order) !== null && _6 !== void 0 ? _6 : 0, createdAt: (_7 = toDate(targetLesson.createdAt)) !== null && _7 !== void 0 ? _7 : new Date(), updatedAt: (_8 = toDate(targetLesson.updatedAt)) !== null && _8 !== void 0 ? _8 : new Date() })
        });
        res.send(` تم إضافة الدرس بنجاح إلى الكورس المطلوب!`);
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
        let backupDataForLessonRestore = null;
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
                            backupDataForLessonRestore = data;
                            break;
                        }
                    }
                }
                if (!targetLesson) {
                    const found = lessons.find((l) => l.id === lessonId);
                    if (found) {
                        targetLesson = found;
                        targetCourse = courses.find((c) => c.id === found.courseId);
                        backupDataForLessonRestore = data;
                    }
                }
                if (targetLesson)
                    break;
            }
        }
        else {
            // B. Search in local files
            const searchDirs = [backupSnapshot_1.BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
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
                            const backup = (0, backupMaintenance_1.readLocalBackupFile)(fp, file);
                            const data = backup.data || backup;
                            const lessons = Array.isArray(data.lesson) ? data.lesson : [];
                            const courses = Array.isArray(data.course) ? data.course : [];
                            const found = lessons.find((l) => l.id === lessonId);
                            if (found) {
                                targetLesson = found;
                                targetCourse = courses.find((c) => c.id === found.courseId);
                                backupDataForLessonRestore = data;
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
                update: Object.assign(Object.assign({ title: targetLesson.title }, (0, bilingualMetadata_1.metadataTranslations)(targetLesson, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: (_k = targetLesson.domain) !== null && _k !== void 0 ? _k : null, content: (_l = targetLesson.content) !== null && _l !== void 0 ? _l : null, videoUrl: (_m = targetLesson.videoUrl) !== null && _m !== void 0 ? _m : null, duration: (_o = targetLesson.duration) !== null && _o !== void 0 ? _o : 0, summary: (_p = targetLesson.summary) !== null && _p !== void 0 ? _p : null, notes: (_q = targetLesson.notes) !== null && _q !== void 0 ? _q : null, questions: (_r = parseSafe(targetLesson.questions)) !== null && _r !== void 0 ? _r : null, assignments: (_s = parseSafe(targetLesson.assignments)) !== null && _s !== void 0 ? _s : null, attachments: (_t = parseSafe(targetLesson.attachments)) !== null && _t !== void 0 ? _t : null, slides: (_u = parseSafe(targetLesson.slides)) !== null && _u !== void 0 ? _u : null, standards: (_v = targetLesson.standards) !== null && _v !== void 0 ? _v : null, indicators: (_w = targetLesson.indicators) !== null && _w !== void 0 ? _w : null, learningOutcomes: (_x = targetLesson.learningOutcomes) !== null && _x !== void 0 ? _x : null, isCentral: (_y = targetLesson.isCentral) !== null && _y !== void 0 ? _y : false, isVisible: targetLesson.isVisible !== undefined ? !!targetLesson.isVisible : true, publishDate: toDate(targetLesson.publishDate), cutOffDate: toDate(targetLesson.cutOffDate), order: (_z = targetLesson.order) !== null && _z !== void 0 ? _z : 0, updatedAt: new Date() }),
                create: Object.assign(Object.assign({ id: lessonId, courseId: targetLesson.courseId, title: targetLesson.title || 'Untitled Lesson' }, (0, bilingualMetadata_1.metadataTranslations)(targetLesson, String, bilingualMetadata_1.LESSON_METADATA_FIELDS)), { domain: (_0 = targetLesson.domain) !== null && _0 !== void 0 ? _0 : null, content: (_1 = targetLesson.content) !== null && _1 !== void 0 ? _1 : null, videoUrl: (_2 = targetLesson.videoUrl) !== null && _2 !== void 0 ? _2 : null, duration: (_3 = targetLesson.duration) !== null && _3 !== void 0 ? _3 : 0, summary: (_4 = targetLesson.summary) !== null && _4 !== void 0 ? _4 : null, notes: (_5 = targetLesson.notes) !== null && _5 !== void 0 ? _5 : null, questions: (_6 = parseSafe(targetLesson.questions)) !== null && _6 !== void 0 ? _6 : null, assignments: (_7 = parseSafe(targetLesson.assignments)) !== null && _7 !== void 0 ? _7 : null, attachments: (_8 = parseSafe(targetLesson.attachments)) !== null && _8 !== void 0 ? _8 : null, slides: (_9 = parseSafe(targetLesson.slides)) !== null && _9 !== void 0 ? _9 : null, standards: (_10 = targetLesson.standards) !== null && _10 !== void 0 ? _10 : null, indicators: (_11 = targetLesson.indicators) !== null && _11 !== void 0 ? _11 : null, learningOutcomes: (_12 = targetLesson.learningOutcomes) !== null && _12 !== void 0 ? _12 : null, isCentral: (_13 = targetLesson.isCentral) !== null && _13 !== void 0 ? _13 : false, isVisible: targetLesson.isVisible !== undefined ? !!targetLesson.isVisible : true, publishDate: toDate(targetLesson.publishDate), cutOffDate: toDate(targetLesson.cutOffDate), order: (_14 = targetLesson.order) !== null && _14 !== void 0 ? _14 : 0, createdAt: (_15 = toDate(targetLesson.createdAt)) !== null && _15 !== void 0 ? _15 : new Date(), updatedAt: (_16 = toDate(targetLesson.updatedAt)) !== null && _16 !== void 0 ? _16 : new Date() })
            });
            // Restore ExamModules and SubExams for any exam that belongs to this lesson's course
            // This covers the case where the lesson's course has exams with modular hierarchy
            if (targetLesson.courseId && backupDataForLessonRestore) {
                const courseExams = [];
                const flatExams = Array.isArray(backupDataForLessonRestore.exam) ? backupDataForLessonRestore.exam : [];
                for (const e of flatExams) {
                    if ((e === null || e === void 0 ? void 0 : e.courseId) === targetLesson.courseId)
                        courseExams.push(e);
                }
                const flatCourses = Array.isArray(backupDataForLessonRestore.course) ? backupDataForLessonRestore.course : [];
                for (const c of flatCourses) {
                    if ((c === null || c === void 0 ? void 0 : c.id) === targetLesson.courseId && Array.isArray(c.exams)) {
                        for (const e of c.exams) {
                            if (!courseExams.some((x) => x.id === e.id))
                                courseExams.push(e);
                        }
                    }
                }
                for (const e of courseExams) {
                    yield (0, backupRestore_1.restoreExamWithHierarchy)(tx, e, backupDataForLessonRestore, targetLesson.courseId);
                }
            }
            //  Remove from tombstones if previously marked as deleted
            const { unmarkLessonDeleted, unmarkCourseDeleted } = yield Promise.resolve().then(() => __importStar(require('../lib/tombstones')));
            unmarkLessonDeleted(lessonId);
            if (targetLesson.courseId)
                unmarkCourseDeleted(targetLesson.courseId);
        }));
        const freshLesson = yield prisma_1.default.lesson.findUnique({ where: { id: lessonId }, include: { course: true } });
        console.log(` [Lesson Restore] Restored lesson "${freshLesson === null || freshLesson === void 0 ? void 0 : freshLesson.title}" (${lessonId}) to course "${(_b = freshLesson === null || freshLesson === void 0 ? void 0 : freshLesson.course) === null || _b === void 0 ? void 0 : _b.title}"`);
        res.json({
            success: true,
            message: `تم استعادة الدرس "${freshLesson === null || freshLesson === void 0 ? void 0 : freshLesson.title}" بنجاح في قاعدة البيانات الحالية.`,
            lesson: freshLesson
        });
    }
    catch (error) {
        console.error(' Lesson restore error:', error);
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
            const files = fs_1.default.readdirSync(backupSnapshot_1.BACKUPS_DIR)
                .filter(f => f.endsWith('.json') || f.endsWith('.zip'))
                .map(f => ({ name: f, size: fs_1.default.statSync(path_1.default.join(backupSnapshot_1.BACKUPS_DIR, f)).size }))
                .sort((a, b) => b.size - a.size);
            if (files.length === 0)
                return res.status(404).json({ error: 'No backup files found in backups directory' });
            backupPath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, files[0].name);
            console.log(` [Content Restore] Using largest backup: ${files[0].name} (${(files[0].size / 1024 / 1024).toFixed(1)} MB)`);
        }
        else if (filename) {
            backupPath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, path_1.default.basename(filename));
            if (!fs_1.default.existsSync(backupPath)) {
                return res.status(404).json({ error: `Backup file not found: ${filename}` });
            }
        }
        else {
            return res.status(400).json({ error: 'Provide either filename or useLatest:true' });
        }
        // --- Parse backup ---
        const parsed = (0, backupMaintenance_1.readLocalBackupFile)(backupPath, path_1.default.basename(backupPath));
        const data = parsed.data || parsed;
        const backupLessons = Array.isArray(data.lesson) ? data.lesson : [];
        if (backupLessons.length === 0) {
            return res.status(400).json({ error: 'No lessons found in backup file' });
        }
        console.log(`\n [Content Restore] Processing ${backupLessons.length} lessons from backup...`);
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
                console.log(`   Lesson not found in DB: "${bl.title}" (${bl.id})`);
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
            console.log(`   "${current.title}" [${changes}]`);
            report.push({ lessonId: bl.id, title: current.title, changes });
            updated++;
        }
        console.log(`\n [Content Restore] DONE — Updated: ${updated}, Skipped (already ok): ${skipped}, Not found: ${notFound}`);
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
        console.error(' [Content Restore] Error:', error);
        return res.status(500).json({ error: 'Failed to restore lesson content', details: error.message });
    }
});
exports.postBackupHandler20 = postBackupHandler20;
