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
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const egyptTime_1 = require("../utils/egyptTime");
const router = (0, express_1.Router)();
const workspaceRoles = (0, auth_1.checkRole)(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']);
const writeLimiter = (0, express_rate_limit_1.default)({ windowMs: 60000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
router.get('/api/workspace/calendar', auth_1.verifyToken, workspaceRoles, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const range = (0, egyptTime_1.reportRange)(req.query);
        const user = yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { id: true, role: true, schoolId: true, grade: true } });
        if (!user)
            return res.status(404).json({ error: 'Account not found' });
        const [exams, lessons] = yield Promise.all([
            prisma_1.default.exam.findMany({ where: Object.assign({ deletedAt: null, status: 'PUBLISHED' }, (user.role === 'SUPER_ADMIN' ? {} : { OR: [{ isCentral: true }, { schoolId: user.schoolId || '__none__' }, { schools: { some: { id: user.schoolId || '__none__' } } }] })),
                select: { id: true, title: true, type: true, grade: true, grades: true, isCentral: true, schoolId: true, schools: { select: { id: true } }, startDate: true, endDate: true,
                    modules: { select: { subExams: { select: { id: true, title: true, publishDate: true, cutOffDate: true } } } } } }),
            prisma_1.default.lesson.findMany({ where: { deletedAt: null, isVisible: true, course: Object.assign(Object.assign({}, (0, shared_1.buildStudentCourseWhere)(user)), { deletedAt: null }),
                    OR: [{ publishDate: { gte: range.start, lt: range.end } }, { cutOffDate: { gte: range.start, lt: range.end } }] },
                select: { id: true, title: true, courseId: true, publishDate: true, cutOffDate: true } }),
        ]);
        const events = [];
        const add = (id, title, kind, date, href) => {
            if (date && date >= range.start && date < range.end)
                events.push({ id, title, kind, at: date.toISOString(), day: (0, egyptTime_1.egyptDay)(date), href });
        };
        for (const exam of exams.filter(exam => user.role !== 'STUDENT' || (0, shared_1.examMatchesStudent)(exam, user))) {
            const href = user.role === 'STUDENT' ? `/exams/${exam.id}/details` : `/${user.role === 'SUPER_ADMIN' ? 'super-admin' : 'school-admin'}/exams/analytics/${exam.id}`;
            add(exam.id + '-start', exam.title, 'EXAM_START', exam.startDate, href);
            add(exam.id + '-end', exam.title, 'EXAM_END', exam.endDate, href);
            for (const child of exam.modules.flatMap(module => module.subExams)) {
                const childHref = user.role === 'STUDENT' ? `/exams/${exam.id}?subExamId=${child.id}` : href;
                add(child.id + '-start', child.title, 'EXAM_START', child.publishDate, childHref);
                add(child.id + '-end', child.title, 'EXAM_END', child.cutOffDate, childHref);
            }
        }
        for (const lesson of lessons) {
            add(lesson.id + '-start', lesson.title, 'LESSON_START', lesson.publishDate, `/lessons/${lesson.id}?courseId=${lesson.courseId}`);
            add(lesson.id + '-end', lesson.title, 'LESSON_END', lesson.cutOffDate, `/lessons/${lesson.id}?courseId=${lesson.courseId}`);
        }
        res.json({ events: events.sort((a, b) => a.at.localeCompare(b.at)), from: range.from, to: range.to, timeZone: range.timeZone, generatedAt: new Date().toISOString() });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
}));
router.get('/api/workspace/assignments', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield prisma_1.default.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            return res.status(404).json({ error: 'Student not found' });
        const [exams, lessons] = yield Promise.all([
            prisma_1.default.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', type: { in: ['Assignment', 'ASSIGNMENT', 'Homework', 'HOMEWORK', 'واجب'] } }, include: { schools: { select: { id: true } }, submissions: { where: { userId: user.id }, select: { id: true } } } }),
            prisma_1.default.lesson.findMany({ where: { deletedAt: null, isVisible: true, course: Object.assign(Object.assign({}, (0, shared_1.buildStudentCourseWhere)(user)), { deletedAt: null }) },
                select: { id: true, title: true, courseId: true, assignments: true, publishDate: true, cutOffDate: true, progresses: { where: { userId: user.id }, select: { isCompleted: true } } } }),
        ]);
        const now = new Date();
        const status = (date, end, completed) => completed ? 'COMPLETED' : end && end < now ? 'CLOSED' : date && date > now ? 'UPCOMING' : 'AVAILABLE';
        const tasks = exams.filter(exam => (0, shared_1.examMatchesStudent)(exam, user)).map(exam => ({ id: exam.id, title: exam.title,
            status: status(exam.startDate, exam.endDate, exam.submissions.length > 0), dueAt: exam.endDate, href: `/exams/${exam.id}/details`, kind: 'EXAM' }));
        for (const lesson of lessons) {
            let assignments = lesson.assignments;
            try {
                if (typeof assignments === 'string')
                    assignments = JSON.parse(assignments);
            }
            catch (_a) {
                assignments = [];
            }
            if (!Array.isArray(assignments) || !assignments.length)
                continue;
            tasks.push({ id: lesson.id, title: lesson.title, dueAt: lesson.cutOffDate, status: status(lesson.publishDate, lesson.cutOffDate, false),
                href: `/lessons/${lesson.id}?courseId=${lesson.courseId}`, kind: 'LESSON', questionCount: assignments.length });
        }
        res.json({ tasks, generatedAt: now.toISOString(), timeZone: 'Africa/Cairo' });
    }
    catch (_b) {
        res.status(500).json({ error: 'Could not load assignments' });
    }
}));
router.post('/api/auth/change-password', auth_1.verifyToken, workspaceRoles, writeLimiter, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { currentPassword, newPassword } = req.body;
        if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 72)
            return res.status(400).json({ error: 'Use a new password of 10–72 characters' });
        const user = yield prisma_1.default.user.findUnique({ where: { id: req.user.id } });
        if (!user || !(yield bcryptjs_1.default.compare(currentPassword, user.password)))
            return res.status(403).json({ error: 'Current password is incorrect' });
        yield prisma_1.default.user.update({ where: { id: user.id }, data: { password: yield bcryptjs_1.default.hash(newPassword, 12) } });
        res.json({ success: true });
    }
    catch (_a) {
        res.status(500).json({ error: 'Password could not be changed' });
    }
}));
exports.default = router;
