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
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const router = (0, express_1.Router)();
// --- Extracted from lines 3851-3979 ---
router.get('/api/reports/school', auth_1.verifyToken, (0, auth_1.checkRole)(['SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER']), auth_1.checkSchoolAccess, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const targetSchoolId = req.user.role === 'SUPER_ADMIN' ? req.query.schoolId : req.user.schoolId;
    try {
        const cacheKey = `school_reports_${targetSchoolId}`;
        const cached = (0, shared_1.getCache)(cacheKey);
        if (cached)
            return res.json(cached);
        // ✅ PERF FIX: Use parallel count + aggregate instead of loading ALL submissions into RAM
        const [studentsCount, teachersCount, submissionStats] = yield Promise.all([
            prisma_1.default.user.count({ where: { schoolId: targetSchoolId, role: 'STUDENT' } }),
            prisma_1.default.user.count({ where: { schoolId: targetSchoolId, role: 'TEACHER' } }),
            prisma_1.default.examSubmission.aggregate({
                where: { user: { schoolId: targetSchoolId } },
                _avg: { percentage: true },
                _count: { id: true },
            }),
        ]);
        const averageScore = Math.round(submissionStats._avg.percentage || 0);
        const totalExamsTaken = submissionStats._count.id;
        const stats = { schoolId: targetSchoolId, studentsCount, teachersCount, averageScore, totalExamsTaken };
        (0, shared_1.setCache)(cacheKey, stats);
        res.json(stats);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error generating report' });
    }
}));
// Student Dashboard Stats
router.get('/api/student/dashboard-stats', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const studentId = req.user.id;
        const cacheKey = `student_dashboard_${studentId}`;
        const cached = (0, shared_1.getCache)(cacheKey);
        if (cached)
            return res.json(cached);
        const student = yield prisma_1.default.user.findUnique({
            where: { id: studentId },
            include: {
                school: { select: { name: true } },
                _count: {
                    select: {
                        studentEnrollments: true,
                        examSubmissions: true
                    }
                }
            }
        });
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        // Count upcoming exams in the student's school
        const upcomingExamsCount = yield prisma_1.default.exam.count({
            where: {
                schoolId: student.schoolId,
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Placeholder for "upcoming/recent"
            }
        });
        const stats = {
            name: student.name,
            schoolName: (_a = student.school) === null || _a === void 0 ? void 0 : _a.name,
            coursesCount: student._count.studentEnrollments,
            examsTaken: student._count.examSubmissions,
            upcomingExams: upcomingExamsCount,
            overallProgress: 0 // Placeholder
        };
        (0, shared_1.setCache)(cacheKey, stats);
        res.json(stats);
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching dashboard stats' });
    }
}));
// (Removed redundant route definition)
// ==========================================
// 📊 STATS & REPORTS
// ==========================================
// Exam Attendance Report
router.get('/api/reports/exam-attendance', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { schoolId, grade, examId } = req.query;
        if (!examId)
            return res.status(400).json({ error: 'examId is required' });
        let targetSchoolId = schoolId;
        if (req.user.role === 'SCHOOL_ADMIN') {
            targetSchoolId = req.user.schoolId;
        }
        if (!targetSchoolId)
            return res.status(400).json({ error: 'schoolId is required' });
        // Pagination params — max 200 per page to prevent large payloads
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
        const skip = (page - 1) * limit;
        // Build user filter
        const userWhere = { role: 'STUDENT', schoolId: targetSchoolId };
        if (grade) {
            userWhere.grade = grade;
        }
        // Count total students for pagination metadata
        const totalStudents = yield prisma_1.default.user.count({ where: userWhere });
        // Get paginated students
        const students = yield prisma_1.default.user.findMany({
            where: userWhere,
            select: { id: true, name: true, username: true, grade: true },
            skip,
            take: limit,
            orderBy: { name: 'asc' },
        });
        // Get all submissions for this exam for the current page of students
        const submissions = yield prisma_1.default.examSubmission.findMany({
            where: {
                examId: examId,
                userId: { in: students.map(s => s.id)
                }
            },
            orderBy: { totalScore: 'desc' }
        });
        // Group submissions by user
        const submissionMap = new Map();
        for (const sub of submissions) {
            if (!submissionMap.has(sub.userId)) {
                submissionMap.set(sub.userId, sub);
            }
        }
        const attended = [];
        const missed = [];
        for (const student of students) {
            if (submissionMap.has(student.id)) {
                const sub = submissionMap.get(student.id);
                attended.push(Object.assign(Object.assign({}, student), { score: sub.totalScore, percentage: sub.percentage, submittedAt: sub.createdAt }));
            }
            else {
                missed.push(student);
            }
        }
        res.json({
            attended,
            missed,
            total: totalStudents,
            // Pagination metadata (new — backward compatible addition)
            pagination: {
                page,
                limit,
                total: totalStudents,
                pages: Math.ceil(totalStudents / limit),
                hasMore: page * limit < totalStudents,
            }
        });
    }
    catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ error: 'Error generating report' });
    }
}));
// Student Stats (Admins can also view their own stats for testing)
exports.default = router;
