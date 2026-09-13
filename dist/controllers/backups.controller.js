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
exports.normalizeRestoredValue = exports.postBackupHandler20 = exports.postBackupHandler19 = exports.getBackupHandler18 = exports.postBackupHandler17 = exports.postBackupHandler16 = exports.getBackupHandler15 = exports.postBackupHandler14 = exports.postBackupHandler13 = exports.deleteBackupHandler12 = exports.postBackupHandler11 = exports.postBackupHandler10 = exports.getBackupHandler9 = exports.getBackupHandler8 = exports.getBackupHandler7 = exports.postBackupHandler6 = exports.postBackupHandler5 = exports.postBackupHandler4 = exports.getBackupHandler3 = exports.getBackupHandler2 = exports.postBackupHandler1 = exports.BACKUPS_DIR = void 0;
exports.restoreExamWithHierarchy = restoreExamWithHierarchy;
exports.parseBackupBuffer = parseBackupBuffer;
exports.generateFullSystemBackupData = generateFullSystemBackupData;
exports.performBackupAndPruning = performBackupAndPruning;
exports.readLocalBackupFile = readLocalBackupFile;
const backupSnapshot_1 = require("../lib/backupSnapshot");
const storage_1 = require("../lib/storage");
var backupSnapshot_2 = require("../lib/backupSnapshot");
Object.defineProperty(exports, "BACKUPS_DIR", { enumerable: true, get: function () { return backupSnapshot_2.BACKUPS_DIR; } });
const db_backup_1 = require("../lib/db-backup");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const shared_1 = require("../shared");
const db_backup_2 = require("../lib/db-backup");
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
            const cloudBackups = yield (0, db_backup_2.getCloudBackups)();
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
        const cloudBackups = yield (0, db_backup_2.getCloudBackups)();
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
        const fullData = yield generateFullSystemBackupData();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `backup_manual_cloud_${timestamp}`;
        const saved = yield (0, db_backup_2.saveToCloudBackup)(backupName, 'MANUAL', fullData);
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
function restoreExamWithHierarchy(tx, e, backupData, targetCourseId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36;
        const toDate = (v) => (v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null);
        const resolvedCourseId = targetCourseId !== undefined ? targetCourseId : ((_a = e.courseId) !== null && _a !== void 0 ? _a : null);
        const ePayload = {
            title: (_b = e.title) !== null && _b !== void 0 ? _b : 'Untitled',
            description: (_c = e.description) !== null && _c !== void 0 ? _c : null,
            type: (_d = e.type) !== null && _d !== void 0 ? _d : 'Quiz',
            duration: typeof e.duration === 'number' ? e.duration : (parseInt(e.duration, 10) || 30),
            passingScore: typeof e.passingScore === 'number' ? e.passingScore : (parseInt(e.passingScore, 10) || 50),
            isCentral: (_e = e.isCentral) !== null && _e !== void 0 ? _e : false,
            showAnswers: e.showAnswers !== false,
            resultVisibility: (_f = e.resultVisibility) !== null && _f !== void 0 ? _f : 'SHOW_SCORE',
            password: (_g = e.password) !== null && _g !== void 0 ? _g : null,
            startDate: toDate(e.startDate),
            endDate: toDate(e.endDate),
            attemptsAllowed: typeof e.attemptsAllowed === 'number' ? e.attemptsAllowed : (parseInt(e.attemptsAllowed, 10) || 1),
            status: (_h = e.status) !== null && _h !== void 0 ? _h : 'PUBLISHED',
            category: (_j = e.category) !== null && _j !== void 0 ? _j : null,
            grade: (_k = e.grade) !== null && _k !== void 0 ? _k : null,
            grades: (_l = e.grades) !== null && _l !== void 0 ? _l : null,
            subjects: (_m = e.subjects) !== null && _m !== void 0 ? _m : null,
            schoolId: (_o = e.schoolId) !== null && _o !== void 0 ? _o : null,
            courseId: resolvedCourseId,
            folderId: (_p = e.folderId) !== null && _p !== void 0 ? _p : null,
            courseName: (_q = e.courseName) !== null && _q !== void 0 ? _q : null,
            section: (_r = e.section) !== null && _r !== void 0 ? _r : null,
            domain: (_s = e.domain) !== null && _s !== void 0 ? _s : null,
            learningOutcomes: (_t = e.learningOutcomes) !== null && _t !== void 0 ? _t : null,
            indicators: (_u = e.indicators) !== null && _u !== void 0 ? _u : null,
            skills: (_v = e.skills) !== null && _v !== void 0 ? _v : null,
            skill: (_w = e.skill) !== null && _w !== void 0 ? _w : null,
            gradeTarget: (_x = e.gradeTarget) !== null && _x !== void 0 ? _x : null,
            level: (_y = e.level) !== null && _y !== void 0 ? _y : 'Medium',
            creatorId: (_z = e.creatorId) !== null && _z !== void 0 ? _z : null,
            deletedAt: null,
            createdAt: (_0 = toDate(e.createdAt)) !== null && _0 !== void 0 ? _0 : new Date(),
            updatedAt: (_1 = toDate(e.updatedAt)) !== null && _1 !== void 0 ? _1 : new Date()
        };
        yield tx.exam.upsert({
            where: { id: e.id },
            update: ePayload,
            create: Object.assign({ id: e.id }, ePayload)
        });
        // 1. Gather all ExamModules
        const backupModules = Array.isArray(backupData.examModule) ? backupData.examModule : [];
        const embeddedModules = Array.isArray(e.modules) ? e.modules : [];
        const allModulesMap = new Map();
        for (const m of backupModules) {
            if ((m === null || m === void 0 ? void 0 : m.examId) === e.id)
                allModulesMap.set(m.id, m);
        }
        for (const m of embeddedModules) {
            if (m === null || m === void 0 ? void 0 : m.id)
                allModulesMap.set(m.id, Object.assign(Object.assign({}, m), { examId: e.id }));
            if (Array.isArray(m.subModules)) {
                for (const sm of m.subModules) {
                    if (sm === null || sm === void 0 ? void 0 : sm.id)
                        allModulesMap.set(sm.id, Object.assign(Object.assign({}, sm), { examId: e.id, parentModuleId: m.id }));
                }
            }
        }
        const modulesList = Array.from(allModulesMap.values());
        const parentModules = modulesList.filter((m) => !m.parentModuleId);
        const childModules = modulesList.filter((m) => !!m.parentModuleId);
        for (const m of parentModules) {
            const mPayload = {
                examId: e.id,
                parentModuleId: null,
                title: m.title || 'Untitled Module',
                description: (_2 = m.description) !== null && _2 !== void 0 ? _2 : null,
                order: typeof m.order === 'number' ? m.order : 0,
                duration: m.duration !== undefined && m.duration !== null ? Number(m.duration) : null,
                passingScore: m.passingScore !== undefined && m.passingScore !== null ? Number(m.passingScore) : null,
                gradeTarget: (_3 = m.gradeTarget) !== null && _3 !== void 0 ? _3 : null,
                publishDate: toDate(m.publishDate),
                cutOffDate: toDate(m.cutOffDate),
                createdAt: (_4 = toDate(m.createdAt)) !== null && _4 !== void 0 ? _4 : new Date(),
                updatedAt: (_5 = toDate(m.updatedAt)) !== null && _5 !== void 0 ? _5 : new Date()
            };
            yield tx.examModule.upsert({
                where: { id: m.id },
                update: mPayload,
                create: Object.assign({ id: m.id }, mPayload)
            });
        }
        for (const m of childModules) {
            const mPayload = {
                examId: e.id,
                parentModuleId: m.parentModuleId,
                title: m.title || 'Untitled Submodule',
                description: (_6 = m.description) !== null && _6 !== void 0 ? _6 : null,
                order: typeof m.order === 'number' ? m.order : 0,
                duration: m.duration !== undefined && m.duration !== null ? Number(m.duration) : null,
                passingScore: m.passingScore !== undefined && m.passingScore !== null ? Number(m.passingScore) : null,
                gradeTarget: (_7 = m.gradeTarget) !== null && _7 !== void 0 ? _7 : null,
                publishDate: toDate(m.publishDate),
                cutOffDate: toDate(m.cutOffDate),
                createdAt: (_8 = toDate(m.createdAt)) !== null && _8 !== void 0 ? _8 : new Date(),
                updatedAt: (_9 = toDate(m.updatedAt)) !== null && _9 !== void 0 ? _9 : new Date()
            };
            yield tx.examModule.upsert({
                where: { id: m.id },
                update: mPayload,
                create: Object.assign({ id: m.id }, mPayload)
            });
        }
        // 2. Gather and restore SubExams
        const backupSubExams = Array.isArray(backupData.subExam) ? backupData.subExam : [];
        const allSubExamsMap = new Map();
        for (const se of backupSubExams) {
            if (allModulesMap.has(se.moduleId))
                allSubExamsMap.set(se.id, se);
        }
        for (const m of modulesList) {
            if (Array.isArray(m.subExams)) {
                for (const se of m.subExams) {
                    if (se === null || se === void 0 ? void 0 : se.id)
                        allSubExamsMap.set(se.id, Object.assign(Object.assign({}, se), { moduleId: m.id }));
                }
            }
        }
        for (const se of allSubExamsMap.values()) {
            const sePayload = {
                moduleId: se.moduleId,
                title: se.title || 'Untitled SubExam',
                password: (_10 = se.password) !== null && _10 !== void 0 ? _10 : null,
                duration: se.duration !== undefined && se.duration !== null ? Number(se.duration) : null,
                passingScore: se.passingScore !== undefined && se.passingScore !== null ? Number(se.passingScore) : null,
                attemptsAllowed: typeof se.attemptsAllowed === 'number' ? se.attemptsAllowed : 1,
                order: typeof se.order === 'number' ? se.order : 0,
                publishDate: toDate(se.publishDate),
                cutOffDate: toDate(se.cutOffDate),
                createdAt: (_11 = toDate(se.createdAt)) !== null && _11 !== void 0 ? _11 : new Date(),
                updatedAt: (_12 = toDate(se.updatedAt)) !== null && _12 !== void 0 ? _12 : new Date()
            };
            yield tx.subExam.upsert({
                where: { id: se.id },
                update: sePayload,
                create: Object.assign({ id: se.id }, sePayload)
            });
        }
        // 3. Gather and restore Questions (with bilingual fields)
        const backupQuestions = Array.isArray(backupData.question) ? backupData.question : [];
        const embeddedQuestions = Array.isArray(e.questions) ? e.questions : [];
        const allQuestionsMap = new Map();
        for (const q of backupQuestions) {
            if ((q === null || q === void 0 ? void 0 : q.examId) === e.id)
                allQuestionsMap.set(q.id, q);
        }
        for (const q of embeddedQuestions) {
            if (q === null || q === void 0 ? void 0 : q.id)
                allQuestionsMap.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id }));
        }
        for (const m of modulesList) {
            if (Array.isArray(m.questions)) {
                for (const q of m.questions) {
                    if (q === null || q === void 0 ? void 0 : q.id)
                        allQuestionsMap.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id, moduleId: m.id }));
                }
            }
        }
        for (const se of allSubExamsMap.values()) {
            if (Array.isArray(se.questions)) {
                for (const q of se.questions) {
                    if (q === null || q === void 0 ? void 0 : q.id)
                        allQuestionsMap.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id, subExamId: se.id, moduleId: se.moduleId }));
                }
            }
        }
        for (const q of allQuestionsMap.values()) {
            const optionsStr = typeof q.options === 'string'
                ? q.options
                : JSON.stringify(Array.isArray(q.options) ? q.options : []);
            const optionsEnStr = q.optionsEn
                ? (typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(Array.isArray(q.optionsEn) ? q.optionsEn : []))
                : null;
            const correctAnswerStr = Array.isArray(q.correctAnswer)
                ? JSON.stringify(q.correctAnswer)
                : String((_13 = q.correctAnswer) !== null && _13 !== void 0 ? _13 : '');
            const qPayload = {
                examId: e.id,
                text: (_15 = (_14 = q.text) !== null && _14 !== void 0 ? _14 : q.content) !== null && _15 !== void 0 ? _15 : '',
                textEn: (_16 = q.textEn) !== null && _16 !== void 0 ? _16 : null,
                type: q.type || q.questionType || 'MCQ',
                options: optionsStr,
                optionsEn: optionsEnStr,
                correctAnswer: correctAnswerStr,
                points: Number(q.points) || 1,
                xpPoints: Number(q.xpPoints) || 10,
                skill: (_17 = q.skill) !== null && _17 !== void 0 ? _17 : null,
                learningOutcome: (_18 = q.learningOutcome) !== null && _18 !== void 0 ? _18 : null,
                indicator: (_19 = q.indicator) !== null && _19 !== void 0 ? _19 : null,
                videoUrl: (_20 = q.videoUrl) !== null && _20 !== void 0 ? _20 : null,
                level: (_21 = q.level) !== null && _21 !== void 0 ? _21 : 'Medium',
                dok: (_22 = q.dok) !== null && _22 !== void 0 ? _22 : null,
                cognitive: (_23 = q.cognitive) !== null && _23 !== void 0 ? _23 : null,
                course: (_24 = q.course) !== null && _24 !== void 0 ? _24 : null,
                section: (_25 = q.section) !== null && _25 !== void 0 ? _25 : null,
                domain: (_26 = q.domain) !== null && _26 !== void 0 ? _26 : null,
                standard: (_27 = q.standard) !== null && _27 !== void 0 ? _27 : null,
                subskill: (_28 = q.subskill) !== null && _28 !== void 0 ? _28 : null,
                microSkill: (_29 = q.microSkill) !== null && _29 !== void 0 ? _29 : null,
                gradeTarget: (_30 = q.gradeTarget) !== null && _30 !== void 0 ? _30 : null,
                errorPattern: (_31 = q.errorPattern) !== null && _31 !== void 0 ? _31 : null,
                estimatedTime: q.estimatedTime ? String(q.estimatedTime) : null,
                explanation: (_32 = q.explanation) !== null && _32 !== void 0 ? _32 : null,
                explanationEn: (_33 = q.explanationEn) !== null && _33 !== void 0 ? _33 : null,
                imageUrl: (_34 = q.imageUrl) !== null && _34 !== void 0 ? _34 : null,
                order: Number(q.order) || 0,
                deletedAt: null,
                moduleId: (q.moduleId && allModulesMap.has(q.moduleId)) ? q.moduleId : null,
                subExamId: (q.subExamId && allSubExamsMap.has(q.subExamId)) ? q.subExamId : null,
                createdAt: (_35 = toDate(q.createdAt)) !== null && _35 !== void 0 ? _35 : new Date(),
                updatedAt: (_36 = toDate(q.updatedAt)) !== null && _36 !== void 0 ? _36 : new Date()
            };
            yield tx.question.upsert({
                where: { id: q.id },
                update: qPayload,
                create: Object.assign({ id: q.id }, qPayload)
            });
        }
    });
}
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
        const saved = yield (0, db_backup_2.saveToCloudBackup)(backupName, 'REALTIME_SYNC', {
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
                    yield restoreExamWithHierarchy(tx, e, backupDataWrapper, (_a = e.courseId) !== null && _a !== void 0 ? _a : null);
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
        const result = yield (0, db_backup_2.createManualBundle)();
        res.json(result);
    }
    catch (error) {
        console.error(' Manual bundle backups error:', error);
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
            backupData = readLocalBackupFile(filePath, filename);
        }
        const data = (backupData === null || backupData === void 0 ? void 0 : backupData.data) || backupData; // Handle both wrapper structure and plain object
        // v2 backups are validated inside restoreSnapshot using DMMF; v1 legacy backups may lack course/lesson arrays
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ error: 'Incomplete backup: no data payload found' });
        }
        yield performBackupAndPruning();
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
        const backup = readLocalBackupFile(filePath, filename);
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
                yield restoreExamWithHierarchy(tx, exam, data, courseId);
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
                            update: { courseId: c.id, title: l.title, domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() },
                            create: { id: l.id, courseId: c.id, title: l.title || 'Untitled', domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() }
                        });
                    }
                    // Restore all its exams with complete hierarchy
                    const cExams = Array.from(bExamsMap.values()).filter((e) => e.courseId === c.id);
                    for (const e of cExams) {
                        yield restoreExamWithHierarchy(tx, e, backupData, c.id);
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
                    const e = bExamsMap.get(sel.id);
                    if (!e)
                        continue;
                    const targetCourseId = sel.targetCourseId !== undefined ? sel.targetCourseId : e.courseId;
                    yield restoreExamWithHierarchy(tx, e, backupData, targetCourseId);
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
                            const backup = readLocalBackupFile(fp, file);
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
                    yield restoreExamWithHierarchy(tx, e, backupDataForLessonRestore, targetLesson.courseId);
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
        const parsed = readLocalBackupFile(backupPath, path_1.default.basename(backupPath));
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
        return (0, backupSnapshot_1.collectFullSnapshot)(prisma_1.default);
    });
}
function performBackupAndPruning() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, backupSnapshot_1.ensureBackupStorage)();
        const filename = 'backup-full-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + require('crypto').randomUUID() + '.json';
        const filePath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, filename);
        const saved = yield (0, backupSnapshot_1.writeFullSnapshot)(prisma_1.default, filePath);
        // Mirror to Cloud Backup DB (JSONB) if configured
        if (db_backup_1.CLOUD_BACKUP_ENABLED) {
            const payload = JSON.parse(yield fs_1.default.promises.readFile(filePath, 'utf8'));
            const cloud = yield (0, db_backup_2.saveToCloudBackup)(filename.slice(0, -5), 'FULL_SYSTEM', payload);
            if (!cloud)
                console.warn('[Backup] Local snapshot saved; cloud DB copy failed.');
        }
        // Mirror the raw JSON file to R2/S3 object storage if configured (non-fatal)
        if ((0, storage_1.isCloudStorageActive)()) {
            (0, storage_1.persistUpload)(filePath, filename, 'application/json').catch(err => console.warn('[Backup] R2 file mirror failed (local copy kept):', err.message));
        }
        yield (0, backupSnapshot_1.pruneFullSnapshots)();
        return { filename, size: saved.size, createdAt: saved.timestamp };
    });
}
const normalizeRestoredValue = (value) => (0, shared_1.externalizeEmbeddedDataImages)(value);
exports.normalizeRestoredValue = normalizeRestoredValue;
function readLocalBackupFile(filePath, filename) {
    return parseBackupBuffer(fs_1.default.readFileSync(filePath), filename);
}
