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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// GET /api/deduplicate/scan
// Requires SUPER_ADMIN
router.get('/scan', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const results = {
            courses: [],
            exams: [],
            lessons: [],
            questions: [],
            bankQuestions: [],
        };
        // 1. Scan Courses (Group by title, description, subject)
        const duplicateCoursesGroups = (yield prisma.course.groupBy({
            by: ['title', 'description', 'subject'],
            _count: { id: true }
        })).filter(g => g._count.id > 1);
        for (const group of duplicateCoursesGroups) {
            const courses = yield prisma.course.findMany({
                where: { title: group.title, description: group.description, subject: group.subject },
                orderBy: { createdAt: 'asc' },
                select: { id: true, title: true, createdAt: true, school: { select: { name: true } } },
            });
            if (courses.length > 1) {
                results.courses.push({
                    original: courses[0],
                    duplicates: courses.slice(1),
                    title: group.title
                });
            }
        }
        // 2. Scan Exams (Group by title, courseId)
        const duplicateExamsGroups = (yield prisma.exam.groupBy({
            by: ['title', 'courseId'],
            _count: { id: true }
        })).filter(g => g._count.id > 1);
        for (const group of duplicateExamsGroups) {
            const exams = yield prisma.exam.findMany({
                where: { title: group.title, courseId: group.courseId },
                orderBy: { createdAt: 'asc' },
                select: { id: true, title: true, createdAt: true },
            });
            if (exams.length > 1) {
                results.exams.push({
                    original: exams[0],
                    duplicates: exams.slice(1),
                    title: group.title
                });
            }
        }
        // 3. Scan Lessons (Group by title, courseId)
        const duplicateLessonsGroups = (yield prisma.lesson.groupBy({
            by: ['title', 'courseId'],
            _count: { id: true }
        })).filter(g => g._count.id > 1);
        for (const group of duplicateLessonsGroups) {
            const lessons = yield prisma.lesson.findMany({
                where: { title: group.title, courseId: group.courseId },
                orderBy: { createdAt: 'asc' },
                select: { id: true, title: true, createdAt: true },
            });
            if (lessons.length > 1) {
                results.lessons.push({
                    original: lessons[0],
                    duplicates: lessons.slice(1),
                    title: group.title
                });
            }
        }
        // 4. Scan Questions (Group by text, examId)
        const duplicateQuestionsGroups = (yield prisma.question.groupBy({
            by: ['text', 'examId'],
            _count: { id: true }
        })).filter(g => g._count.id > 1);
        for (const group of duplicateQuestionsGroups) {
            const questions = yield prisma.question.findMany({
                where: { text: group.text, examId: group.examId },
                orderBy: { createdAt: 'asc' },
                select: { id: true, text: true, createdAt: true },
            });
            if (questions.length > 1) {
                results.questions.push({
                    original: questions[0],
                    duplicates: questions.slice(1),
                    title: group.text.replace(/<[^>]+>/g, '').substring(0, 50) + '...'
                });
            }
        }
        res.json(results);
    }
    catch (error) {
        next(error);
    }
}));
// POST /api/deduplicate/clean
// Expects { courses: string[], exams: string[], lessons: string[], questions: string[] }
router.post('/clean', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { courses = [], exams = [], lessons = [], questions = [] } = req.body;
        const deleted = { courses: 0, exams: 0, lessons: 0, questions: 0 };
        yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            if (questions.length > 0) {
                const result = yield tx.question.deleteMany({ where: { id: { in: questions } } });
                deleted.questions = result.count;
            }
            if (lessons.length > 0) {
                const result = yield tx.lesson.deleteMany({ where: { id: { in: lessons } } });
                deleted.lessons = result.count;
            }
            if (exams.length > 0) {
                const result = yield tx.exam.deleteMany({ where: { id: { in: exams } } });
                deleted.exams = result.count;
            }
            if (courses.length > 0) {
                const result = yield tx.course.deleteMany({ where: { id: { in: courses } } });
                deleted.courses = result.count;
            }
        }));
        res.json({ message: 'Duplicates cleaned successfully', deleted });
    }
    catch (error) {
        next(error);
    }
}));
exports.default = router;
