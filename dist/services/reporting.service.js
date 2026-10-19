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
exports.ReportError = void 0;
exports.reportFilters = reportFilters;
exports.reportSubmissionWhere = reportSubmissionWhere;
exports.reportOptions = reportOptions;
exports.generateReport = generateReport;
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const prisma_1 = __importDefault(require("../lib/prisma"));
const client_1 = require("@prisma/client");
const shared_1 = require("../shared");
const examControllerSupport_1 = require("../controllers/examControllerSupport");
const egyptTime_1 = require("../utils/egyptTime");
const reportMetrics_1 = require("../utils/reportMetrics");
class ReportError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
exports.ReportError = ReportError;
function reportFilters(user, query) {
    const string = (key) => typeof query[key] === 'string' ? query[key].trim() : '';
    const schoolId = user.role === 'SUPER_ADMIN' ? string('schoolId') : user.schoolId;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'STUDENT' && !schoolId)
        throw new ReportError('Your account has no school', 403);
    return Object.assign(Object.assign({}, (0, egyptTime_1.reportRange)(query)), { policy: (0, reportMetrics_1.attemptPolicy)(query.attemptPolicy), schoolId: schoolId || '', grade: string('grade'), classroomId: string('classroomId'), subject: string('subject'), courseId: string('courseId'), examId: string('examId'), subExamId: string('subExamId'), page: Math.max(1, Number.parseInt(string('page')) || 1), limit: Math.min(100, Math.max(1, Number.parseInt(string('limit')) || 25)), search: string('search').slice(0, 100) });
}
function reportSubmissionWhere(user, filters) {
    const AND = [{ user: { role: 'STUDENT', deletedAt: null } }, { createdAt: { gte: filters.start, lt: filters.end } }];
    if (user.role === 'STUDENT')
        AND.push({ userId: user.id, exam: { resultVisibility: { not: 'HIDE_ALL' } } });
    if (filters.schoolId)
        AND.push({ OR: [
                { schoolIdAtSubmission: filters.schoolId },
                { schoolIdAtSubmission: null, user: { schoolId: filters.schoolId } },
            ] });
    if (filters.grade)
        AND.push({ OR: [
                { gradeAtSubmission: filters.grade },
                { gradeAtSubmission: null, user: { grade: filters.grade } },
            ] });
    if (filters.classroomId)
        AND.push({ OR: [
                { reportSnapshot: { path: ['classroomId'], equals: filters.classroomId } },
                { reportSnapshot: { equals: client_1.Prisma.DbNull }, user: { classroomId: filters.classroomId } },
            ] });
    if (user.role === 'TEACHER')
        AND.push({ user: { classroom: { teacherId: user.id } } });
    if (filters.examId)
        AND.push({ examId: filters.examId });
    if (filters.subExamId)
        AND.push({ subExamId: filters.subExamId });
    if (filters.courseId || filters.subject)
        AND.push({ exam: Object.assign(Object.assign({}, (filters.courseId ? { courseId: filters.courseId } : {})), (filters.subject ? { OR: [{ subjects: { contains: JSON.stringify(filters.subject) } }, { subjects: filters.subject }] } : {})) });
    return { AND };
}
const reportInclude = {
    user: { select: { id: true, name: true, username: true, grade: true, schoolId: true, classroomId: true, school: { select: { name: true } } } },
    exam: { select: { id: true, title: true, type: true, subjects: true, passingScore: true, courseId: true } },
};
function reportOptions(user) {
    return __awaiter(this, void 0, void 0, function* () {
        const studentWhere = Object.assign(Object.assign(Object.assign({ role: 'STUDENT', deletedAt: null }, (user.role !== 'SUPER_ADMIN' ? { schoolId: user.schoolId } : {})), (user.role === 'STUDENT' ? { id: user.id } : {})), (user.role === 'TEACHER' ? { classroom: { teacherId: user.id } } : {}));
        const schoolWhere = user.role === 'SUPER_ADMIN' ? {} : { id: user.schoolId || '__none__' };
        const [schools, grades, classrooms, exams] = yield Promise.all([
            prisma_1.default.school.findMany({ where: schoolWhere, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
            prisma_1.default.user.findMany({ where: studentWhere, distinct: ['grade'], select: { grade: true } }),
            prisma_1.default.classroom.findMany({ where: Object.assign(Object.assign({}, (user.role !== 'SUPER_ADMIN' ? { schoolId: user.schoolId || '__none__' } : {})), (user.role === 'TEACHER' ? { teacherId: user.id } : {})), select: { id: true, name: true, schoolId: true, grade: true }, orderBy: { name: 'asc' } }),
            prisma_1.default.exam.findMany({ where: Object.assign(Object.assign({ deletedAt: null }, (user.role === 'STUDENT' ? { status: 'PUBLISHED', resultVisibility: { not: 'HIDE_ALL' } } : {})), (user.role === 'SUPER_ADMIN' ? {} : { OR: [
                        { isCentral: true }, { schoolId: user.schoolId || '__none__' }, { schools: { some: { id: user.schoolId || '__none__' } } },
                    ] })), select: { id: true, title: true, type: true, subjects: true, grade: true, grades: true, schoolId: true, isCentral: true,
                    schools: { select: { id: true } }, courseId: true, course: { select: { id: true, title: true } }, modules: { select: { subExams: { select: { id: true, title: true } } } } }, orderBy: { title: 'asc' } }),
        ]);
        const visibleExams = user.role === 'STUDENT' ? exams.filter(exam => (0, shared_1.examMatchesStudent)(exam, user)) : exams;
        return { schools, grades: grades.map(item => item.grade).filter(Boolean).sort(), classrooms,
            courses: [...new Map(visibleExams.filter(exam => exam.course).map(exam => [exam.course.id, exam.course])).values()],
            exams: visibleExams, subjects: [...new Set(visibleExams.flatMap(exam => {
                    try {
                        const values = JSON.parse(exam.subjects || '[]');
                        return Array.isArray(values) ? values : [values];
                    }
                    catch (_a) {
                        return exam.subjects ? [exam.subjects] : [];
                    }
                }).filter(Boolean))].sort() };
    });
}
function generateReport(user_1, query_1) {
    return __awaiter(this, arguments, void 0, function* (user, query, db = prisma_1.default) {
        var _a, _b, _c, _d, _e, _f;
        const filters = reportFilters(user, query);
        let exam = null;
        if (filters.examId) {
            exam = yield db.exam.findUnique({ where: { id: filters.examId }, include: { schools: { select: { id: true } }, modules: { include: { subExams: true } } } });
            if (!exam || !(yield (0, examControllerSupport_1.canViewExam)(user, exam)))
                throw new ReportError('Exam not accessible', 403);
            if (user.role === 'STUDENT' && !(0, shared_1.examMatchesStudent)(exam, user))
                throw new ReportError('Exam not assigned to you', 403);
            if (filters.subExamId && !exam.modules.some((module) => module.subExams.some((child) => child.id === filters.subExamId))) {
                throw new ReportError('Exam section does not belong to this exam');
            }
        }
        const rows = yield db.examSubmission.findMany({ where: reportSubmissionWhere(user, filters), include: reportInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10001 });
        if (rows.length > 10000)
            throw new ReportError('Too many attempts. Narrow the dates, school, or exam before generating this report.', 422);
        const childIds = [...new Set(rows.map(row => row.subExamId).filter(Boolean))];
        const children = childIds.length ? yield db.subExam.findMany({ where: { id: { in: childIds } }, select: { id: true, title: true, passingScore: true } }) : [];
        const childMap = new Map(children.map((child) => [child.id, child]));
        for (const row of rows)
            row.subExam = childMap.get(row.subExamId);
        const selected = (0, reportMetrics_1.selectAttempts)(rows, filters.policy);
        // Fetch answers only for selected attempts, with a separate safety bound; never send answers in the JSON report.
        const answers = selected.length ? yield db.studentAnswer.findMany({ where: { submissionId: { in: selected.map(row => row.id) } }, take: 200001,
            select: { submissionId: true, isCorrect: true, questionSnapshot: true,
                question: { select: { id: true, text: true, type: true, points: true, skill: true, skillEn: true, standard: true, standardEn: true, learningOutcome: true, learningOutcomeEn: true, textEn: true, moduleId: true, subExamId: true } } } }) : [];
        if (answers.length > 200000)
            throw new ReportError('Too many answers. Narrow the dates or exam before generating this report.', 422);
        const bySubmission = new Map();
        for (const answer of answers) {
            const list = bySubmission.get(answer.submissionId) || [];
            list.push(answer);
            bySubmission.set(answer.submissionId, list);
        }
        for (const row of selected) {
            row.answers = bySubmission.get(row.id) || [];
            row.totalQuestions = (_b = (_a = row.reportSnapshot) === null || _a === void 0 ? void 0 : _a.totalQuestions) !== null && _b !== void 0 ? _b : row.answers.length;
            row.correctAnswers = (_d = (_c = row.reportSnapshot) === null || _c === void 0 ? void 0 : _c.correctAnswers) !== null && _d !== void 0 ? _d : row.answers.filter((answer) => answer.isCorrect).length;
        }
        const graded = selected.filter(row => typeof row.percentage === 'number');
        const uniqueStudents = new Set(selected.map(row => row.userId)).size;
        const passes = graded.filter(reportMetrics_1.attemptPassed).length;
        const skills = new Map(), questions = new Map(), schools = new Map(), timeline = new Map();
        for (const row of selected) {
            const day = (0, egyptTime_1.egyptDay)(row.createdAt);
            const activity = timeline.get(day) || { day, attempts: 0, sum: 0, graded: 0 };
            activity.attempts++;
            if (typeof row.percentage === 'number') {
                activity.sum += row.percentage;
                activity.graded++;
            }
            timeline.set(day, activity);
            const schoolId = row.schoolIdAtSubmission || row.user.schoolId || '__unassigned__';
            const school = schools.get(schoolId) || { id: schoolId, name: ((_e = row.reportSnapshot) === null || _e === void 0 ? void 0 : _e.schoolName) || ((_f = row.user.school) === null || _f === void 0 ? void 0 : _f.name) || '—', students: new Set(), count: 0, sum: 0, graded: 0, passed: 0 };
            school.students.add(row.userId);
            school.count++;
            if (typeof row.percentage === 'number') {
                school.sum += row.percentage;
                school.graded++;
                if ((0, reportMetrics_1.attemptPassed)(row))
                    school.passed++;
            }
            schools.set(schoolId, school);
            for (const answer of row.answers) {
                const q = (0, bilingualMetadata_1.metadataForDisplay)(answer.questionSnapshot, answer.question) || answer.question;
                if (!q)
                    continue;
                const key = `${q.id}:${q.revision || 'legacy'}`;
                const item = questions.get(key) || { id: key, questionId: q.id, text: q.text, textEn: q.textEn, type: q.type, moduleId: q.moduleId, subExamId: q.subExamId, points: q.points, total: 0, correct: 0 };
                item.total++;
                if (answer.isCorrect)
                    item.correct++;
                questions.set(key, item);
                const field = q.skill || q.skillEn ? "skill" : "learningOutcome";
                const skillKey = q[field + "En"] || q[field];
                if (!skillKey)
                    continue;
                const skill = skills.get(skillKey) || { name: skillKey, nameAr: q[field], nameEn: q[field + "En"], total: 0, correct: 0, students: new Set() };
                skill.total++;
                skill.students.add(row.userId);
                if (answer.isCorrect)
                    skill.correct++;
                skills.set(skillKey, skill);
            }
        }
        const studentWhere = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ role: 'STUDENT', deletedAt: null, status: 'ACTIVE' }, (filters.schoolId ? { schoolId: filters.schoolId } : {})), (filters.grade ? { grade: filters.grade } : {})), (filters.classroomId ? { classroomId: filters.classroomId } : {})), (user.role === 'STUDENT' ? { id: user.id } : {})), (user.role === 'TEACHER' ? { classroom: { teacherId: user.id } } : {}));
        // Participation has a denominator only for a particular assigned exam; other views show unique participants.
        let eligibleCount = null;
        let eligibleParticipants = null;
        if (exam) {
            const students = yield db.user.findMany({ where: studentWhere, select: { id: true, grade: true, schoolId: true } });
            const ids = new Set(students.filter((student) => (0, shared_1.examMatchesStudent)(exam, Object.assign(Object.assign({}, student), { role: 'STUDENT' }))).map((student) => student.id));
            eligibleCount = ids.size;
            eligibleParticipants = new Set(selected.filter(row => ids.has(row.userId)).map(row => row.userId)).size;
        }
        const students = selected.map(row => {
            var _a, _b, _c, _d, _e;
            return ({
                id: row.id, userId: row.userId, name: row.user.name, username: row.user.username,
                schoolId: row.schoolIdAtSubmission || row.user.schoolId, schoolName: ((_a = row.reportSnapshot) === null || _a === void 0 ? void 0 : _a.schoolName) || ((_b = row.user.school) === null || _b === void 0 ? void 0 : _b.name) || '—',
                grade: row.gradeAtSubmission || row.user.grade, examId: row.examId, subExamId: row.subExamId,
                examTitle: ((_c = row.reportSnapshot) === null || _c === void 0 ? void 0 : _c.examTitle) || ((_d = row.subExam) === null || _d === void 0 ? void 0 : _d.title) || row.exam.title, subject: ((_e = row.reportSnapshot) === null || _e === void 0 ? void 0 : _e.subject) || row.exam.subjects,
                score: row.totalScore, percentage: row.percentage, passingScore: (0, reportMetrics_1.passingThreshold)(row), passed: typeof row.percentage === 'number' ? (0, reportMetrics_1.attemptPassed)(row) : null,
                totalTime: row.totalTime, correctAnswers: row.correctAnswers, totalQuestions: row.totalQuestions,
                createdAt: row.createdAt, historicalSnapshot: Boolean(row.reportSnapshot),
            });
        });
        const matching = students.filter(row => !filters.search || [row.name, row.username, row.examTitle].some(value => value === null || value === void 0 ? void 0 : value.toLowerCase().includes(filters.search.toLowerCase())));
        const skillRows = [...skills.values()].map(skill => ({ name: skill.name, nameAr: skill.nameAr, nameEn: skill.nameEn, answers: skill.total, students: skill.students.size,
            correctRate: (0, reportMetrics_1.ratio)(skill.correct, skill.total), sufficientEvidence: skill.total >= 5 }));
        return {
            exam: exam ? { id: exam.id, title: exam.title } : null,
            generatedAt: new Date().toISOString(), timeZone: filters.timeZone,
            filters: Object.assign(Object.assign({}, filters), { start: filters.start.toISOString(), end: filters.end.toISOString() }),
            summary: { totalAttempts: rows.length, selectedAttempts: selected.length, uniqueStudents, eligibleCount,
                participationRate: eligibleCount == null ? null : (0, reportMetrics_1.ratio)(eligibleParticipants || 0, eligibleCount),
                eligibleParticipants, participationBasis: 'current-assigned-students',
                averageScore: graded.length ? (0, reportMetrics_1.roundMetric)(graded.reduce((sum, row) => sum + row.percentage, 0) / graded.length) : null,
                passRate: (0, reportMetrics_1.ratio)(passes, graded.length), passed: passes, gradedAttempts: graded.length,
                legacyAttempts: selected.filter(row => !row.reportSnapshot).length,
                averageExamSeconds: selected.some(row => row.totalTime != null) ? Math.round(selected.filter(row => row.totalTime != null).reduce((sum, row) => sum + row.totalTime, 0) / selected.filter(row => row.totalTime != null).length) : null },
            timeline: [...timeline.values()].sort((a, b) => a.day.localeCompare(b.day)).map(item => ({ day: item.day, attempts: item.attempts, averageScore: item.graded ? (0, reportMetrics_1.roundMetric)(item.sum / item.graded) : null })),
            skills: skillRows.sort((a, b) => { var _a, _b; return ((_a = a.correctRate) !== null && _a !== void 0 ? _a : 0) - ((_b = b.correctRate) !== null && _b !== void 0 ? _b : 0); }),
            questions: [...questions.values()].map(q => (Object.assign(Object.assign({}, q), { correctRate: (0, reportMetrics_1.ratio)(q.correct, q.total) }))).sort((a, b) => { var _a, _b; return ((_a = a.correctRate) !== null && _a !== void 0 ? _a : 0) - ((_b = b.correctRate) !== null && _b !== void 0 ? _b : 0); }),
            modules: ((exam === null || exam === void 0 ? void 0 : exam.modules) || []).map((module) => {
                const entries = [...questions.values()].filter(question => question.moduleId === module.id);
                const totalAnswers = entries.reduce((sum, question) => sum + question.total, 0);
                return { id: module.id, title: module.title, totalAnswers, correctRate: (0, reportMetrics_1.ratio)(entries.reduce((sum, question) => sum + question.correct, 0), totalAnswers) };
            }),
            subExams: ((exam === null || exam === void 0 ? void 0 : exam.modules) || []).flatMap((module) => (module.subExams || []).map((child) => {
                const entries = [...questions.values()].filter(question => question.subExamId === child.id);
                const totalAnswers = entries.reduce((sum, question) => sum + question.total, 0);
                return { id: child.id, title: child.title, moduleId: module.id, totalAnswers, correctRate: (0, reportMetrics_1.ratio)(entries.reduce((sum, question) => sum + question.correct, 0), totalAnswers) };
            })),
            schools: user.role === 'SUPER_ADMIN' ? [...schools.values()].map(school => ({ id: school.id, name: school.name, uniqueStudents: school.students.size, selectedAttempts: school.count,
                averageScore: school.graded ? (0, reportMetrics_1.roundMetric)(school.sum / school.graded) : null, passRate: (0, reportMetrics_1.ratio)(school.passed, school.graded) })) : [],
            students: matching.slice((filters.page - 1) * filters.limit, filters.page * filters.limit),
            pagination: { page: filters.page, limit: filters.limit, total: matching.length, pages: Math.ceil(matching.length / filters.limit) },
            // Kept in-process for full filtered exports; the router never exposes this internal field as JSON.
            exportRows: matching,
        };
    });
}
