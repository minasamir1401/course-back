"use strict";
/**
 * diagnose-lesson-damage.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY diagnostic script.
 * Does NOT modify the database — outputs a JSON report only.
 *
 * Purpose: Detect lessons/courses/exams that may have been incorrectly
 *          soft-deleted by the automatic runGlobalDeduplication() logic.
 *
 * Run manually:
 *   npx tsx src/scripts/diagnose-lesson-damage.ts
 *   npx tsx src/scripts/diagnose-lesson-damage.ts --json > report.json
 * ─────────────────────────────────────────────────────────────────────────────
 */
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
exports.runDiagnosis = runDiagnosis;
const prisma_1 = __importDefault(require("../lib/prisma"));
function runDiagnosis() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        console.log('\n🔍 [Diagnostic] Starting read-only database diagnosis...\n');
        // ── 1. Count all soft-deleted records ──────────────────────────────────────
        const [softDeletedLessons, softDeletedCourses, softDeletedExams] = yield Promise.all([
            prisma_1.default.lesson.count({ where: { deletedAt: { not: null } } }),
            prisma_1.default.course.count({ where: { deletedAt: { not: null } } }),
            prisma_1.default.exam.count({ where: { deletedAt: { not: null } } }),
        ]);
        console.log(`📊 Soft-deleted: Lessons=${softDeletedLessons}, Courses=${softDeletedCourses}, Exams=${softDeletedExams}`);
        // ── 2. Find all lessons (active + deleted) for collision check ──────────────
        const allLessons = yield prisma_1.default.lesson.findMany({
            select: {
                id: true, title: true, courseId: true,
                deletedAt: true, createdAt: true, updatedAt: true,
                questions: true, assignments: true, attachments: true,
                course: { select: { title: true, schoolId: true } },
            },
            orderBy: { courseId: 'asc' },
        });
        // ── 3. Detect title collisions ─────────────────────────────────────────────
        const collisionMap = new Map();
        for (const l of allLessons) {
            const key = `${l.courseId}__${l.title.trim().toLowerCase()}`;
            if (!collisionMap.has(key))
                collisionMap.set(key, []);
            collisionMap.get(key).push(l);
        }
        const titleCollisions = [];
        const suspiciousLessons = [];
        for (const [key, group] of collisionMap.entries()) {
            if (group.length > 1) {
                const [courseId] = key.split('__');
                const hasDeletedMembers = group.some(l => l.deletedAt !== null);
                if (hasDeletedMembers) {
                    titleCollisions.push({
                        courseId,
                        courseTitle: (_a = group[0].course) === null || _a === void 0 ? void 0 : _a.title,
                        normalizedTitle: group[0].title.trim().toLowerCase(),
                        lessons: group.map(l => ({
                            id: l.id, title: l.title, deletedAt: l.deletedAt,
                            createdAt: l.createdAt, updatedAt: l.updatedAt,
                            questions: l.questions, assignments: l.assignments, attachments: l.attachments
                        })),
                    });
                    // Add deleted ones to suspicious list
                    for (const l of group.filter(x => x.deletedAt !== null)) {
                        // lessonId is not a direct FK on Exam in this schema — skip exam count
                        const examCount = 0;
                        // Check JSON fields for orphaned content
                        const parseCount = (val) => {
                            if (Array.isArray(val))
                                return val.length;
                            if (typeof val === 'string') {
                                try {
                                    const parsed = JSON.parse(val);
                                    if (Array.isArray(parsed))
                                        return parsed.length;
                                }
                                catch (e) { }
                            }
                            return 0;
                        };
                        const qCount = parseCount(l.questions);
                        const aCount = parseCount(l.assignments);
                        const attCount = parseCount(l.attachments);
                        suspiciousLessons.push({
                            id: l.id, title: l.title, courseId,
                            courseTitle: (_b = l.course) === null || _b === void 0 ? void 0 : _b.title,
                            schoolId: (_d = (_c = l.course) === null || _c === void 0 ? void 0 : _c.schoolId) !== null && _d !== void 0 ? _d : undefined,
                            deletedAt: l.deletedAt,
                            createdAt: l.createdAt, updatedAt: l.updatedAt,
                            examCount,
                            progressCount: 0,
                            orphanedQuestions: qCount,
                            orphanedAssignments: aCount,
                            orphanedAttachments: attCount,
                            hasOrphanedRelationships: examCount > 0 || qCount > 0 || aCount > 0 || attCount > 0,
                        });
                    }
                }
            }
        }
        // ── 4. Recent deletions (last 30 days) ─────────────────────────────────────
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [recentLessons, recentCourses, recentExams] = yield Promise.all([
            prisma_1.default.lesson.findMany({
                where: { deletedAt: { gte: thirtyDaysAgo } },
                select: { id: true, title: true, courseId: true, deletedAt: true },
                orderBy: { deletedAt: 'desc' },
                take: 100,
            }),
            prisma_1.default.course.findMany({
                where: { deletedAt: { gte: thirtyDaysAgo } },
                select: { id: true, title: true, schoolId: true, deletedAt: true },
                orderBy: { deletedAt: 'desc' },
                take: 50,
            }),
            prisma_1.default.exam.findMany({
                where: { deletedAt: { gte: thirtyDaysAgo } },
                select: { id: true, title: true, courseId: true, schoolId: true, deletedAt: true },
                orderBy: { deletedAt: 'desc' },
                take: 50,
            }),
        ]);
        const recentDeletions = [
            ...recentLessons.map(l => ({ id: l.id, title: l.title, type: 'lesson', deletedAt: l.deletedAt, courseId: l.courseId })),
            ...recentCourses.map(c => { var _a; return ({ id: c.id, title: c.title, type: 'course', deletedAt: c.deletedAt, schoolId: (_a = c.schoolId) !== null && _a !== void 0 ? _a : undefined }); }),
            ...recentExams.map(e => { var _a, _b; return ({ id: e.id, title: e.title, type: 'exam', deletedAt: e.deletedAt, courseId: (_a = e.courseId) !== null && _a !== void 0 ? _a : undefined, schoolId: (_b = e.schoolId) !== null && _b !== void 0 ? _b : undefined }); }),
        ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
        const report = {
            generatedAt: new Date().toISOString(),
            summary: {
                softDeletedLessons,
                softDeletedCourses,
                softDeletedExams,
                suspiciousDeletions: suspiciousLessons.length,
                titleCollisionGroups: titleCollisions.length,
                recentDeletions: recentDeletions.length,
            },
            suspiciousLessons,
            titleCollisions,
            recentDeletions,
        };
        return report;
    });
}
// ─── ENTRY POINT GUARD ───────────────────────────────────────────────────────
// Run manually ONLY: npx tsx src/scripts/diagnose-lesson-damage.ts [--json]
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    runDiagnosis()
        .then(report => {
        var _a;
        const isJson = process.argv.includes('--json');
        if (isJson) {
            console.log(JSON.stringify(report, null, 2));
        }
        else {
            console.log('\n═══════════════════════════════════════════════════════');
            console.log('📋 DIAGNOSTIC REPORT — READ ONLY — NO CHANGES MADE');
            console.log('═══════════════════════════════════════════════════════');
            console.log('\n📊 SUMMARY:');
            console.log(JSON.stringify(report.summary, null, 2));
            if (report.suspiciousLessons.length > 0) {
                console.log(`\n⚠️  ${report.suspiciousLessons.length} SUSPICIOUS DELETIONS (title collision + soft-deleted):`);
                for (const l of report.suspiciousLessons.slice(0, 20)) {
                    console.log(`  • [${l.id}] "${l.title}" | Course: ${(_a = l.courseTitle) !== null && _a !== void 0 ? _a : l.courseId} | Deleted: ${l.deletedAt}`);
                    if (l.hasOrphanedRelationships) {
                        console.log(`      ↳ Orphaned Content -> Q: ${l.orphanedQuestions} | A: ${l.orphanedAssignments} | Att: ${l.orphanedAttachments}`);
                    }
                }
            }
            else {
                console.log('\n✅ No suspicious deletions from title collisions found.');
            }
            console.log(`\n📅 RECENT DELETIONS (last 30 days): ${report.recentDeletions.length} records`);
            for (const d of report.recentDeletions.slice(0, 10)) {
                console.log(`  • [${d.type.toUpperCase()}] "${d.title}" deleted at ${d.deletedAt}`);
            }
            console.log('\n═══════════════════════════════════════════════════════');
            console.log('ℹ️  Run with --json flag for full JSON output.');
            console.log('⚠️  NO DATA WAS MODIFIED. This is a read-only scan.');
            console.log('═══════════════════════════════════════════════════════\n');
        }
    })
        .catch(err => {
        console.error('❌ Diagnostic failed:', err);
        process.exit(1);
    })
        .finally(() => __awaiter(void 0, void 0, void 0, function* () {
        yield prisma_1.default.$disconnect();
    }));
}
