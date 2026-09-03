"use strict";
/**
 * ================================================================
 * 🛟 RESTORE-FROM-LOCAL-BACKUP — Full Data Recovery Script
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
    console.log(`📂 Found ${files.length} backup files in: ${backupDir}`);
    const courses = new Map();
    const lessons = new Map();
    const exams = new Map();
    for (const { name, fullPath } of files) {
        try {
            const raw = fs.readFileSync(fullPath, 'utf-8');
            const parsed = JSON.parse(raw);
            const data = parsed.data || parsed;
            const backupCourses = Array.isArray(data.course) ? data.course : [];
            const backupLessons = Array.isArray(data.lesson) ? data.lesson : [];
            const backupExams = Array.isArray(data.exam) ? data.exam : [];
            for (const c of backupCourses) {
                if (!(c === null || c === void 0 ? void 0 : c.id) || !(c === null || c === void 0 ? void 0 : c.title))
                    continue;
                if (!courses.has(c.id)) {
                    courses.set(c.id, Object.assign({}, c));
                }
                // Extract embedded lessons from REALTIME_SYNC format
                if (Array.isArray(c.lessons)) {
                    for (const l of c.lessons) {
                        if (!(l === null || l === void 0 ? void 0 : l.id))
                            continue;
                        if (!lessons.has(l.id)) {
                            lessons.set(l.id, Object.assign(Object.assign({}, l), { courseId: l.courseId || c.id }));
                        }
                        else {
                            // Merge — keep richer data
                            const existing = lessons.get(l.id);
                            lessons.set(l.id, Object.assign(Object.assign({}, existing), { slides: pickRicher(existing.slides, l.slides), questions: pickRicher(existing.questions, l.questions), assignments: pickRicher(existing.assignments, l.assignments), attachments: pickRicher(existing.attachments, l.attachments) }));
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
                    // Merge — keep richer data for each field
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
            }
            process.stdout.write(`  ✓ ${name} — ${backupCourses.length} courses, ${backupLessons.length} lessons, ${backupExams.length} exams\n`);
        }
        catch (err) {
            console.warn(`  ⚠ Skipped ${name}: ${err.message}`);
        }
    }
    return { courses, lessons, exams };
}
// ── Main ──────────────────────────────────────────────────────────
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
        const backupDir = process.argv[2] || 'C:\\Users\\Administrator\\Downloads\\Compressed';
        console.log('\n🛟 ================================================');
        console.log('🛟  FULL DATA RESTORE FROM LOCAL BACKUPS');
        console.log('🛟 ================================================\n');
        console.log(`📁 Backup directory: ${backupDir}\n`);
        // 1. Load and merge all backups
        const { courses: backupCourses, lessons: backupLessons, exams: backupExams } = loadAndMergeBackups(backupDir);
        console.log(`\n📊 Merged pool: ${backupCourses.size} unique courses, ${backupLessons.size} unique lessons, ${backupExams.size} unique exams\n`);
        // 2. Load current active DB state
        const [activeCourses, activeLessons] = yield Promise.all([
            prisma.course.findMany({ select: { id: true, title: true } }),
            prisma.lesson.findMany({ select: { id: true, courseId: true, title: true, slides: true, questions: true, assignments: true, attachments: true } }),
        ]);
        const activeCourseIds = new Set(activeCourses.map(c => c.id));
        const activeLessonMap = new Map(activeLessons.map(l => [l.id, l]));
        console.log(`📊 Active DB: ${activeCourses.length} courses, ${activeLessons.length} lessons\n`);
        let restoredCourses = 0;
        let updatedCourses = 0;
        let restoredLessons = 0;
        let updatedLessons = 0;
        let skipped = 0;
        const report = [];
        // 3. Restore / update courses
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📚 STEP 1: Restoring Courses');
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
                    report.push(`🔄 Updated course: "${c.title}"`);
                    console.log(`  🔄 Updated: "${c.title}"`);
                }
                else {
                    // Create missing course
                    yield prisma.course.create({
                        data: Object.assign(Object.assign({ id: courseId }, payload), { createdAt: (_h = safeDate(c.createdAt)) !== null && _h !== void 0 ? _h : new Date() })
                    });
                    activeCourseIds.add(courseId);
                    restoredCourses++;
                    report.push(`✅ Restored course: "${c.title}"`);
                    console.log(`  ✅ Restored: "${c.title}"`);
                }
            }
            catch (err) {
                const msg = `❌ Course "${c.title}" (${courseId}): ${err.message}`;
                report.push(msg);
                console.warn(`  ⚠ ${msg}`);
                skipped++;
            }
        }
        // 4. Restore / update lessons with Quizzes, Assignments, Slides
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📖 STEP 2: Restoring Lessons (with Q, A, Slides)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (const [lessonId, l] of backupLessons) {
            if (!l.courseId) {
                skipped++;
                continue;
            }
            if (!activeCourseIds.has(l.courseId)) {
                console.warn(`  ⚠ Skipping "${l.title}" — parent course ${l.courseId} not found`);
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
                        report.push(`  🔄 Updated lesson: "${l.title}" [${changes}]`);
                        console.log(`  🔄 Updated: "${l.title}" [${changes}]`);
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
                    report.push(`  ✅ Restored lesson: "${l.title}" Q:${(backupQ === null || backupQ === void 0 ? void 0 : backupQ.length) || 0} A:${(backupA === null || backupA === void 0 ? void 0 : backupA.length) || 0} S:${(backupS === null || backupS === void 0 ? void 0 : backupS.length) || 0}`);
                    console.log(`  ✅ Restored: "${l.title}" | Q:${(backupQ === null || backupQ === void 0 ? void 0 : backupQ.length) || 0} A:${(backupA === null || backupA === void 0 ? void 0 : backupA.length) || 0} S:${(backupS === null || backupS === void 0 ? void 0 : backupS.length) || 0}`);
                }
            }
            catch (err) {
                const msg = `❌ Lesson "${l.title}" (${lessonId}): ${err.message}`;
                report.push(msg);
                console.warn(`  ⚠ ${msg}`);
                skipped++;
            }
        }
        // 5. Final report
        console.log('\n🛟 ================================================');
        console.log('🛟  RESTORE COMPLETE — SUMMARY');
        console.log('🛟 ================================================');
        console.log(`  ✅ Courses restored : ${restoredCourses}`);
        console.log(`  🔄 Courses updated  : ${updatedCourses}`);
        console.log(`  ✅ Lessons restored : ${restoredLessons}`);
        console.log(`  🔄 Lessons updated  : ${updatedLessons}`);
        console.log(`  ⏭  Items skipped   : ${skipped}`);
        console.log('🛟 ================================================\n');
        // Save report to file
        const reportPath = path.join(process.cwd(), `restore-report-${Date.now()}.txt`);
        fs.writeFileSync(reportPath, report.join('\n'), 'utf-8');
        console.log(`📄 Full report saved to: ${reportPath}\n`);
    });
}
main()
    .catch(err => {
    console.error('\n❌ CRITICAL ERROR during restore:', err);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
    console.log('✅ Database connection closed.');
}));
