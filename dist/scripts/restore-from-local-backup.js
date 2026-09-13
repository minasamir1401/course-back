"use strict";
/**
 * ================================================================
 *  RESTORE-FROM-LOCAL-BACKUP — Full Data Recovery Script
 * ================================================================
 * Reads ALL backup files from a given directory, merges them
 * (most-data wins), and restores every course + lesson with their
 * Quizzes, Assignments, Slides, and Attachments into the live DB.
 *
 * Usage:
 *   npx ts-node src/scripts/restore-from-local-backup.ts [backupDir]
 *
 * Example:
 *   npx ts-node src/scripts/restore-from-local-backup.ts "C:\Users\Administrator\Downloads\Compressed"
 * ================================================================
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const prisma = new client_1.PrismaClient();
// ── Helpers ───────────────────────────────────────────────────────
function safeDate(v) {
    if (!v)
        return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}
function parseSafe(v) {
    if (v === null || v === undefined)
        return null;
    if (typeof v === 'string') {
        try {
            return JSON.parse(v);
        }
        catch (_a) {
            return null;
        }
    }
    return v; // already parsed (JSONB)
}
function countItems(v) {
    const parsed = parseSafe(v);
    if (Array.isArray(parsed))
        return parsed.length;
    return 0;
}
// Pick the value with MORE items (to preserve the richest data)
function pickRicher(existing, incoming) {
    return countItems(incoming) >= countItems(existing) ? incoming : existing;
}
// ── Load & Merge all backup files ────────────────────────────────
function loadAndMergeBackups(backupDir) {
    if (!fs.existsSync(backupDir)) {
        throw new Error(`Backup directory not found: ${backupDir}`);
    }
    const files = fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
        name: f,
        fullPath: path.join(backupDir, f),
        mtime: (() => { try {
            return fs.statSync(path.join(backupDir, f)).mtime.getTime();
        }
        catch (_a) {
            return 0;
        } })()
    }))
        .sort((a, b) => b.mtime - a.mtime); // newest first
    console.log(`Found ${files.length} backup files in: ${backupDir}`);
    const courses = new Map();
    const lessons = new Map();
    const exams = new Map();
    const modules = new Map();
    const subExams = new Map();
    const questions = new Map();
    for (const { name, fullPath } of files) {
        try {
            const raw = fs.readFileSync(fullPath, 'utf-8');
            const parsed = JSON.parse(raw);
            const data = parsed.data || parsed;
            const backupCourses = Array.isArray(data.course) ? data.course : [];
            const backupLessons = Array.isArray(data.lesson) ? data.lesson : [];
            const backupExams = Array.isArray(data.exam) ? data.exam : [];
            const backupModules = Array.isArray(data.examModule) ? data.examModule : [];
            const backupSubExams = Array.isArray(data.subExam) ? data.subExam : [];
            const backupQuestions = Array.isArray(data.question) ? data.question : [];
            for (const c of backupCourses) {
                if (!(c === null || c === void 0 ? void 0 : c.id) || !(c === null || c === void 0 ? void 0 : c.title))
                    continue;
                if (!courses.has(c.id)) {
                    courses.set(c.id, Object.assign({}, c));
                }
                if (Array.isArray(c.lessons)) {
                    for (const l of c.lessons) {
                        if (!(l === null || l === void 0 ? void 0 : l.id))
                            continue;
                        if (!lessons.has(l.id)) {
                            lessons.set(l.id, Object.assign(Object.assign({}, l), { courseId: l.courseId || c.id }));
                        }
                        else {
                            const existing = lessons.get(l.id);
                            lessons.set(l.id, Object.assign(Object.assign({}, existing), { slides: pickRicher(existing.slides, l.slides), questions: pickRicher(existing.questions, l.questions), assignments: pickRicher(existing.assignments, l.assignments), attachments: pickRicher(existing.attachments, l.attachments) }));
                        }
                    }
                }
                if (Array.isArray(c.exams)) {
                    for (const e of c.exams) {
                        if (!(e === null || e === void 0 ? void 0 : e.id))
                            continue;
                        if (!exams.has(e.id)) {
                            exams.set(e.id, Object.assign(Object.assign({}, e), { courseId: e.courseId || c.id }));
                        }
                        if (Array.isArray(e.modules)) {
                            for (const m of e.modules) {
                                if ((m === null || m === void 0 ? void 0 : m.id) && !modules.has(m.id))
                                    modules.set(m.id, Object.assign(Object.assign({}, m), { examId: e.id }));
                                if (Array.isArray(m.subExams)) {
                                    for (const se of m.subExams) {
                                        if ((se === null || se === void 0 ? void 0 : se.id) && !subExams.has(se.id))
                                            subExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: m.id }));
                                    }
                                }
                                if (Array.isArray(m.subModules)) {
                                    for (const sm of m.subModules) {
                                        if ((sm === null || sm === void 0 ? void 0 : sm.id) && !modules.has(sm.id))
                                            modules.set(sm.id, Object.assign(Object.assign({}, sm), { examId: e.id, parentModuleId: m.id }));
                                        if (Array.isArray(sm.subExams)) {
                                            for (const se of sm.subExams) {
                                                if ((se === null || se === void 0 ? void 0 : se.id) && !subExams.has(se.id))
                                                    subExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: sm.id }));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (Array.isArray(e.questions)) {
                            for (const q of e.questions) {
                                if ((q === null || q === void 0 ? void 0 : q.id) && !questions.has(q.id))
                                    questions.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id }));
                            }
                        }
                    }
                }
            }
            for (const l of backupLessons) {
                if (!(l === null || l === void 0 ? void 0 : l.id))
                    continue;
                if (!lessons.has(l.id)) {
                    lessons.set(l.id, Object.assign({}, l));
                }
                else {
                    const existing = lessons.get(l.id);
                    lessons.set(l.id, Object.assign(Object.assign({}, existing), { slides: pickRicher(existing.slides, l.slides), questions: pickRicher(existing.questions, l.questions), assignments: pickRicher(existing.assignments, l.assignments), attachments: pickRicher(existing.attachments, l.attachments) }));
                }
            }
            for (const e of backupExams) {
                if (!(e === null || e === void 0 ? void 0 : e.id))
                    continue;
                if (!exams.has(e.id)) {
                    exams.set(e.id, Object.assign({}, e));
                }
                else {
                    const existing = exams.get(e.id);
                    exams.set(e.id, Object.assign(Object.assign({}, existing), { questions: pickRicher(existing.questions, e.questions), schools: pickRicher(existing.schools, e.schools), grades: pickRicher(existing.grades, e.grades), subjects: pickRicher(existing.subjects, e.subjects) }));
                }
                if (Array.isArray(e.modules)) {
                    for (const m of e.modules) {
                        if ((m === null || m === void 0 ? void 0 : m.id) && !modules.has(m.id))
                            modules.set(m.id, Object.assign(Object.assign({}, m), { examId: e.id }));
                        if (Array.isArray(m.subExams)) {
                            for (const se of m.subExams) {
                                if ((se === null || se === void 0 ? void 0 : se.id) && !subExams.has(se.id))
                                    subExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: m.id }));
                            }
                        }
                        if (Array.isArray(m.subModules)) {
                            for (const sm of m.subModules) {
                                if ((sm === null || sm === void 0 ? void 0 : sm.id) && !modules.has(sm.id))
                                    modules.set(sm.id, Object.assign(Object.assign({}, sm), { examId: e.id, parentModuleId: m.id }));
                                if (Array.isArray(sm.subExams)) {
                                    for (const se of sm.subExams) {
                                        if ((se === null || se === void 0 ? void 0 : se.id) && !subExams.has(se.id))
                                            subExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: sm.id }));
                                    }
                                }
                            }
                        }
                    }
                }
                if (Array.isArray(e.questions)) {
                    for (const q of e.questions) {
                        if ((q === null || q === void 0 ? void 0 : q.id) && !questions.has(q.id))
                            questions.set(q.id, Object.assign(Object.assign({}, q), { examId: e.id }));
                    }
                }
            }
            for (const m of backupModules) {
                if ((m === null || m === void 0 ? void 0 : m.id) && !modules.has(m.id))
                    modules.set(m.id, m);
                if (Array.isArray(m.subExams)) {
                    for (const se of m.subExams) {
                        if ((se === null || se === void 0 ? void 0 : se.id) && !subExams.has(se.id))
                            subExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: m.id }));
                    }
                }
                if (Array.isArray(m.subModules)) {
                    for (const sm of m.subModules) {
                        if ((sm === null || sm === void 0 ? void 0 : sm.id) && !modules.has(sm.id))
                            modules.set(sm.id, Object.assign(Object.assign({}, sm), { examId: m.examId, parentModuleId: m.id }));
                        if (Array.isArray(sm.subExams)) {
                            for (const se of sm.subExams) {
                                if ((se === null || se === void 0 ? void 0 : se.id) && !subExams.has(se.id))
                                    subExams.set(se.id, Object.assign(Object.assign({}, se), { moduleId: sm.id }));
                            }
                        }
                    }
                }
            }
            for (const se of backupSubExams) {
                if ((se === null || se === void 0 ? void 0 : se.id) && !subExams.has(se.id))
                    subExams.set(se.id, se);
            }
            for (const q of backupQuestions) {
                if ((q === null || q === void 0 ? void 0 : q.id) && !questions.has(q.id))
                    questions.set(q.id, q);
            }
            process.stdout.write(`  [OK] ${name} - ${backupCourses.length} courses, ${backupLessons.length} lessons, ${backupExams.length} exams\n`);
        }
        catch (err) {
            console.warn(`  Warning: Skipped ${name}: ${err.message}`);
        }
    }
    return { courses, lessons, exams, modules, subExams, questions };
}
// ── Main ──────────────────────────────────────────────────────────
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38, _39, _40;
        const backupDir = process.argv[2] || 'C:\\Users\\Administrator\\Downloads\\Compressed';
        console.log('\n ================================================');
        console.log('  FULL DATA RESTORE FROM LOCAL BACKUPS');
        console.log(' ================================================\n');
        console.log(` Backup directory: ${backupDir}\n`);
        // 1. Load and merge all backups
        const { courses: backupCourses, lessons: backupLessons, exams: backupExams, modules: backupModules, subExams: backupSubExams, questions: backupQuestions } = loadAndMergeBackups(backupDir);
        console.log(`\n Merged pool: ${backupCourses.size} unique courses, ${backupLessons.size} unique lessons, ${backupExams.size} unique exams\n`);
        // 2. Load current active DB state
        const [activeCourses, activeLessons] = yield Promise.all([
            prisma.course.findMany({ select: { id: true, title: true } }),
            prisma.lesson.findMany({ select: { id: true, courseId: true, title: true, slides: true, questions: true, assignments: true, attachments: true } }),
        ]);
        const activeCourseIds = new Set(activeCourses.map(c => c.id));
        const activeLessonMap = new Map(activeLessons.map(l => [l.id, l]));
        console.log(` Active DB: ${activeCourses.length} courses, ${activeLessons.length} lessons\n`);
        let restoredCourses = 0;
        let updatedCourses = 0;
        let restoredLessons = 0;
        let updatedLessons = 0;
        let restoredExams = 0;
        let updatedExams = 0;
        let skipped = 0;
        const report = [];
        // 3. Restore / update courses
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(' STEP 1: Restoring Courses');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (const [courseId, c] of backupCourses) {
            try {
                const payload = {
                    title: c.title,
                    description: (_a = c.description) !== null && _a !== void 0 ? _a : null,
                    coverImage: (_b = c.coverImage) !== null && _b !== void 0 ? _b : null,
                    grade: (_c = c.grade) !== null && _c !== void 0 ? _c : null,
                    grades: (_d = c.grades) !== null && _d !== void 0 ? _d : null,
                    subject: (_e = c.subject) !== null && _e !== void 0 ? _e : null,
                    country: c.country || 'مصر',
                    isCentral: (_f = c.isCentral) !== null && _f !== void 0 ? _f : true,
                    schoolId: (_g = c.schoolId) !== null && _g !== void 0 ? _g : null,
                    deletedAt: null, // Restore from trash if soft-deleted
                    updatedAt: new Date(),
                };
                if (activeCourseIds.has(courseId)) {
                    // Update existing course (un-delete if soft-deleted)
                    yield prisma.course.update({ where: { id: courseId }, data: payload });
                    updatedCourses++;
                    report.push(` Updated course: "${c.title}"`);
                    console.log(`   Updated: "${c.title}"`);
                }
                else {
                    // Create missing course
                    yield prisma.course.create({
                        data: Object.assign(Object.assign({ id: courseId }, payload), { createdAt: (_h = safeDate(c.createdAt)) !== null && _h !== void 0 ? _h : new Date() })
                    });
                    activeCourseIds.add(courseId);
                    restoredCourses++;
                    report.push(` Restored course: "${c.title}"`);
                    console.log(`   Restored: "${c.title}"`);
                }
            }
            catch (err) {
                const msg = ` Course "${c.title}" (${courseId}): ${err.message}`;
                report.push(msg);
                console.warn(`   ${msg}`);
                skipped++;
            }
        }
        // 4. Restore / update lessons with Quizzes, Assignments, Slides
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(' STEP 2: Restoring Lessons (with Q, A, Slides)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (const [lessonId, l] of backupLessons) {
            if (!l.courseId) {
                skipped++;
                continue;
            }
            if (!activeCourseIds.has(l.courseId)) {
                console.warn(`   Skipping "${l.title}" — parent course ${l.courseId} not found`);
                skipped++;
                continue;
            }
            const backupQ = parseSafe(l.questions);
            const backupA = parseSafe(l.assignments);
            const backupS = parseSafe(l.slides);
            const backupAtt = parseSafe(l.attachments);
            try {
                if (activeLessonMap.has(lessonId)) {
                    // Lesson EXISTS — update fields, but only if backup has MORE data
                    const existing = activeLessonMap.get(lessonId);
                    const existingQ = parseSafe(existing.questions);
                    const existingA = parseSafe(existing.assignments);
                    const existingS = parseSafe(existing.slides);
                    const existingAtt = parseSafe(existing.attachments);
                    // Use whichever is richer
                    const finalQ = (Array.isArray(backupQ) && backupQ.length > 0 && backupQ.length >= ((existingQ === null || existingQ === void 0 ? void 0 : existingQ.length) || 0)) ? backupQ : existingQ;
                    const finalA = (Array.isArray(backupA) && backupA.length > 0 && backupA.length >= ((existingA === null || existingA === void 0 ? void 0 : existingA.length) || 0)) ? backupA : existingA;
                    const finalS = (Array.isArray(backupS) && backupS.length > 0 && backupS.length >= ((existingS === null || existingS === void 0 ? void 0 : existingS.length) || 0)) ? backupS : existingS;
                    const finalAtt = (Array.isArray(backupAtt) && backupAtt.length > 0 && backupAtt.length >= ((existingAtt === null || existingAtt === void 0 ? void 0 : existingAtt.length) || 0)) ? backupAtt : existingAtt;
                    const qChanged = JSON.stringify(finalQ) !== JSON.stringify(existingQ);
                    const aChanged = JSON.stringify(finalA) !== JSON.stringify(existingA);
                    const sChanged = JSON.stringify(finalS) !== JSON.stringify(existingS);
                    const attChanged = JSON.stringify(finalAtt) !== JSON.stringify(existingAtt);
                    if (qChanged || aChanged || sChanged || attChanged) {
                        yield prisma.lesson.update({
                            where: { id: lessonId },
                            data: {
                                questions: finalQ,
                                assignments: finalA,
                                slides: finalS,
                                attachments: finalAtt,
                                deletedAt: null,
                                updatedAt: new Date(),
                            }
                        });
                        updatedLessons++;
                        const changes = [
                            qChanged ? `Q:${((existingQ === null || existingQ === void 0 ? void 0 : existingQ.length) || 0)}→${((finalQ === null || finalQ === void 0 ? void 0 : finalQ.length) || 0)}` : '',
                            aChanged ? `A:${((existingA === null || existingA === void 0 ? void 0 : existingA.length) || 0)}→${((finalA === null || finalA === void 0 ? void 0 : finalA.length) || 0)}` : '',
                            sChanged ? `S:${((existingS === null || existingS === void 0 ? void 0 : existingS.length) || 0)}→${((finalS === null || finalS === void 0 ? void 0 : finalS.length) || 0)}` : '',
                        ].filter(Boolean).join(', ');
                        report.push(`   Updated lesson: "${l.title}" [${changes}]`);
                        console.log(`   Updated: "${l.title}" [${changes}]`);
                    }
                    else {
                        // Already has data, just un-delete if needed
                        if (existing.deletedAt) {
                            yield prisma.lesson.update({ where: { id: lessonId }, data: { deletedAt: null } });
                        }
                    }
                }
                else {
                    // Lesson MISSING — create it with all data
                    yield prisma.lesson.create({
                        data: {
                            id: lessonId,
                            courseId: l.courseId,
                            title: l.title || 'Untitled Lesson',
                            domain: (_j = l.domain) !== null && _j !== void 0 ? _j : null,
                            content: (_k = l.content) !== null && _k !== void 0 ? _k : null,
                            videoUrl: (_l = l.videoUrl) !== null && _l !== void 0 ? _l : null,
                            duration: (_m = l.duration) !== null && _m !== void 0 ? _m : 0,
                            summary: (_o = l.summary) !== null && _o !== void 0 ? _o : null,
                            notes: (_p = l.notes) !== null && _p !== void 0 ? _p : null,
                            questions: backupQ,
                            assignments: backupA,
                            attachments: backupAtt,
                            slides: backupS,
                            standards: (_q = l.standards) !== null && _q !== void 0 ? _q : null,
                            indicators: (_r = l.indicators) !== null && _r !== void 0 ? _r : null,
                            learningOutcomes: (_s = l.learningOutcomes) !== null && _s !== void 0 ? _s : null,
                            isCentral: (_t = l.isCentral) !== null && _t !== void 0 ? _t : false,
                            isVisible: l.isVisible !== undefined ? !!l.isVisible : true,
                            publishDate: safeDate(l.publishDate),
                            cutOffDate: safeDate(l.cutOffDate),
                            order: (_u = l.order) !== null && _u !== void 0 ? _u : 0,
                            deletedAt: null,
                            createdAt: (_v = safeDate(l.createdAt)) !== null && _v !== void 0 ? _v : new Date(),
                            updatedAt: new Date(),
                        }
                    });
                    activeLessonMap.set(lessonId, l);
                    restoredLessons++;
                    report.push(`   Restored lesson: "${l.title}" Q:${(backupQ === null || backupQ === void 0 ? void 0 : backupQ.length) || 0} A:${(backupA === null || backupA === void 0 ? void 0 : backupA.length) || 0} S:${(backupS === null || backupS === void 0 ? void 0 : backupS.length) || 0}`);
                    console.log(`   Restored: "${l.title}" | Q:${(backupQ === null || backupQ === void 0 ? void 0 : backupQ.length) || 0} A:${(backupA === null || backupA === void 0 ? void 0 : backupA.length) || 0} S:${(backupS === null || backupS === void 0 ? void 0 : backupS.length) || 0}`);
                }
            }
            catch (err) {
                const msg = ` Lesson "${l.title}" (${lessonId}): ${err.message}`;
                report.push(msg);
                console.warn(`   ${msg}`);
                skipped++;
            }
        }
        // 5. Restore / update modular exams (with modules, sub-exams, and bilingual questions)
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(' STEP 3: Restoring Exams (Modular Hierarchy & Bilingual Questions)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const activeExams = yield prisma.exam.findMany({ select: { id: true } });
        const activeExamIds = new Set(activeExams.map(e => e.id));
        for (const [examId, e] of backupExams) {
            try {
                const ePayload = {
                    title: (_w = e.title) !== null && _w !== void 0 ? _w : 'Untitled',
                    description: (_x = e.description) !== null && _x !== void 0 ? _x : null,
                    type: (_y = e.type) !== null && _y !== void 0 ? _y : 'Quiz',
                    duration: typeof e.duration === 'number' ? e.duration : 30,
                    passingScore: typeof e.passingScore === 'number' ? e.passingScore : 50,
                    isCentral: (_z = e.isCentral) !== null && _z !== void 0 ? _z : false,
                    showAnswers: e.showAnswers !== false,
                    resultVisibility: (_0 = e.resultVisibility) !== null && _0 !== void 0 ? _0 : 'SHOW_SCORE',
                    password: (_1 = e.password) !== null && _1 !== void 0 ? _1 : null,
                    startDate: safeDate(e.startDate),
                    endDate: safeDate(e.endDate),
                    attemptsAllowed: typeof e.attemptsAllowed === 'number' ? e.attemptsAllowed : 1,
                    status: (_2 = e.status) !== null && _2 !== void 0 ? _2 : 'PUBLISHED',
                    category: (_3 = e.category) !== null && _3 !== void 0 ? _3 : null,
                    grade: (_4 = e.grade) !== null && _4 !== void 0 ? _4 : null,
                    grades: (_5 = e.grades) !== null && _5 !== void 0 ? _5 : null,
                    subjects: (_6 = e.subjects) !== null && _6 !== void 0 ? _6 : null,
                    schoolId: (_7 = e.schoolId) !== null && _7 !== void 0 ? _7 : null,
                    courseId: (e.courseId && activeCourseIds.has(e.courseId)) ? e.courseId : null,
                    skill: (_8 = e.skill) !== null && _8 !== void 0 ? _8 : null,
                    level: (_9 = e.level) !== null && _9 !== void 0 ? _9 : 'Medium',
                    deletedAt: null,
                    createdAt: (_10 = safeDate(e.createdAt)) !== null && _10 !== void 0 ? _10 : new Date(),
                    updatedAt: new Date()
                };
                if (activeExamIds.has(examId)) {
                    yield prisma.exam.update({ where: { id: examId }, data: ePayload });
                    updatedExams++;
                }
                else {
                    yield prisma.exam.create({ data: Object.assign({ id: examId }, ePayload) });
                    activeExamIds.add(examId);
                    restoredExams++;
                }
                // Restore modules for this exam (parents first, then children)
                const examModules = Array.from(backupModules.values()).filter((m) => m.examId === examId);
                const parentMods = examModules.filter((m) => !m.parentModuleId);
                const childMods = examModules.filter((m) => !!m.parentModuleId);
                for (const m of [...parentMods, ...childMods]) {
                    const mPayload = {
                        examId,
                        parentModuleId: (_11 = m.parentModuleId) !== null && _11 !== void 0 ? _11 : null,
                        title: m.title || 'Untitled Module',
                        description: (_12 = m.description) !== null && _12 !== void 0 ? _12 : null,
                        order: typeof m.order === 'number' ? m.order : 0,
                        duration: m.duration ? Number(m.duration) : null,
                        passingScore: m.passingScore ? Number(m.passingScore) : null,
                        gradeTarget: (_13 = m.gradeTarget) !== null && _13 !== void 0 ? _13 : null,
                        publishDate: safeDate(m.publishDate),
                        cutOffDate: safeDate(m.cutOffDate),
                        createdAt: (_14 = safeDate(m.createdAt)) !== null && _14 !== void 0 ? _14 : new Date(),
                        updatedAt: new Date()
                    };
                    yield prisma.examModule.upsert({
                        where: { id: m.id },
                        update: mPayload,
                        create: Object.assign({ id: m.id }, mPayload)
                    });
                }
                // Restore sub-exams for this exam's modules
                const examModuleIds = new Set(examModules.map((m) => m.id));
                const examSubExams = Array.from(backupSubExams.values()).filter((se) => examModuleIds.has(se.moduleId));
                for (const se of examSubExams) {
                    const sePayload = {
                        moduleId: se.moduleId,
                        title: se.title || 'Untitled SubExam',
                        password: (_15 = se.password) !== null && _15 !== void 0 ? _15 : null,
                        duration: se.duration ? Number(se.duration) : null,
                        passingScore: se.passingScore ? Number(se.passingScore) : null,
                        attemptsAllowed: typeof se.attemptsAllowed === 'number' ? se.attemptsAllowed : 1,
                        order: typeof se.order === 'number' ? se.order : 0,
                        publishDate: safeDate(se.publishDate),
                        cutOffDate: safeDate(se.cutOffDate),
                        createdAt: (_16 = safeDate(se.createdAt)) !== null && _16 !== void 0 ? _16 : new Date(),
                        updatedAt: new Date()
                    };
                    yield prisma.subExam.upsert({
                        where: { id: se.id },
                        update: sePayload,
                        create: Object.assign({ id: se.id }, sePayload)
                    });
                }
                // Restore questions for this exam (including bilingual fields)
                const examQuestions = Array.from(backupQuestions.values()).filter((q) => q.examId === examId);
                for (const q of examQuestions) {
                    const optionsStr = typeof q.options === 'string'
                        ? q.options
                        : JSON.stringify(Array.isArray(q.options) ? q.options : []);
                    const optionsEnStr = q.optionsEn
                        ? (typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(Array.isArray(q.optionsEn) ? q.optionsEn : []))
                        : null;
                    const correctAnswerStr = Array.isArray(q.correctAnswer)
                        ? JSON.stringify(q.correctAnswer)
                        : String((_17 = q.correctAnswer) !== null && _17 !== void 0 ? _17 : '');
                    const qPayload = {
                        examId,
                        text: (_19 = (_18 = q.text) !== null && _18 !== void 0 ? _18 : q.content) !== null && _19 !== void 0 ? _19 : '',
                        textEn: (_20 = q.textEn) !== null && _20 !== void 0 ? _20 : null,
                        type: q.type || q.questionType || 'MCQ',
                        options: optionsStr,
                        optionsEn: optionsEnStr,
                        correctAnswer: correctAnswerStr,
                        points: Number(q.points) || 1,
                        xpPoints: Number(q.xpPoints) || 10,
                        skill: (_21 = q.skill) !== null && _21 !== void 0 ? _21 : null,
                        learningOutcome: (_22 = q.learningOutcome) !== null && _22 !== void 0 ? _22 : null,
                        indicator: (_23 = q.indicator) !== null && _23 !== void 0 ? _23 : null,
                        videoUrl: (_24 = q.videoUrl) !== null && _24 !== void 0 ? _24 : null,
                        level: (_25 = q.level) !== null && _25 !== void 0 ? _25 : 'Medium',
                        dok: (_26 = q.dok) !== null && _26 !== void 0 ? _26 : null,
                        cognitive: (_27 = q.cognitive) !== null && _27 !== void 0 ? _27 : null,
                        course: (_28 = q.course) !== null && _28 !== void 0 ? _28 : null,
                        section: (_29 = q.section) !== null && _29 !== void 0 ? _29 : null,
                        domain: (_30 = q.domain) !== null && _30 !== void 0 ? _30 : null,
                        standard: (_31 = q.standard) !== null && _31 !== void 0 ? _31 : null,
                        subskill: (_32 = q.subskill) !== null && _32 !== void 0 ? _32 : null,
                        microSkill: (_33 = q.microSkill) !== null && _33 !== void 0 ? _33 : null,
                        gradeTarget: (_34 = q.gradeTarget) !== null && _34 !== void 0 ? _34 : null,
                        errorPattern: (_35 = q.errorPattern) !== null && _35 !== void 0 ? _35 : null,
                        estimatedTime: q.estimatedTime ? String(q.estimatedTime) : null,
                        explanation: (_36 = q.explanation) !== null && _36 !== void 0 ? _36 : null,
                        explanationEn: (_37 = q.explanationEn) !== null && _37 !== void 0 ? _37 : null,
                        imageUrl: (_38 = q.imageUrl) !== null && _38 !== void 0 ? _38 : null,
                        order: Number(q.order) || 0,
                        deletedAt: null,
                        moduleId: (q.moduleId && examModuleIds.has(q.moduleId)) ? q.moduleId : null,
                        subExamId: (_39 = q.subExamId) !== null && _39 !== void 0 ? _39 : null,
                        createdAt: (_40 = safeDate(q.createdAt)) !== null && _40 !== void 0 ? _40 : new Date(),
                        updatedAt: new Date()
                    };
                    yield prisma.question.upsert({
                        where: { id: q.id },
                        update: qPayload,
                        create: Object.assign({ id: q.id }, qPayload)
                    });
                }
                report.push(`  Exam: "${e.title}" (Q: ${examQuestions.length}, M: ${examModules.length})`);
                console.log(`  Exam: "${e.title}" | Q: ${examQuestions.length}, M: ${examModules.length}`);
            }
            catch (err) {
                const msg = `Exam "${e.title}" (${examId}): ${err.message}`;
                report.push(msg);
                console.warn(`  Warning: ${msg}`);
                skipped++;
            }
        }
        // 6. Final report
        console.log('\n ================================================');
        console.log('  RESTORE COMPLETE — SUMMARY');
        console.log(' ================================================');
        console.log(`   Courses restored : ${restoredCourses}`);
        console.log(`   Courses updated  : ${updatedCourses}`);
        console.log(`   Lessons restored : ${restoredLessons}`);
        console.log(`   Lessons updated  : ${updatedLessons}`);
        console.log(`   Exams restored   : ${restoredExams}`);
        console.log(`   Exams updated    : ${updatedExams}`);
        console.log(`  ⏭  Items skipped   : ${skipped}`);
        console.log(' ================================================\n');
        // Save report to file
        const reportPath = path.join(process.cwd(), `restore-report-${Date.now()}.txt`);
        fs.writeFileSync(reportPath, report.join('\n'), 'utf-8');
        console.log(` Full report saved to: ${reportPath}\n`);
    });
}
main()
    .catch(err => {
    console.error('\n CRITICAL ERROR during restore:', err);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    console.log(' Database connection closed.');
}));
