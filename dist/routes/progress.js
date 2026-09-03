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
// --- Extracted from lines 3980-4304 ---
router.get('/api/student/stats', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const userId = req.user.id;
        // 1. Check cache
        const cacheKey = `student_stats_${userId}`;
        const cached = (0, shared_1.getCache)(cacheKey);
        const now = Date.now();
        if (cached && (now - cached.timestamp < shared_1.CACHE_TTL)) {
            return res.json(cached.data);
        }
        // 2. Fetch Student Basic Info
        const student = yield prisma_1.default.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                grade: true,
                schoolId: true,
                xp: true,
                school: { select: { name: true } },
                classroom: {
                    select: {
                        id: true,
                        name: true,
                        teacher: { select: { name: true } }
                    }
                }
            }
        });
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        // 2. Build course filters
        const courseWhere = (0, shared_1.buildStudentCourseWhere)(student);
        // 3. Fetch all dashboard data in PARALLEL
        const [allSubmissions, allLessonProgresses, avgScoreData, availableCourses, courseProgresses, upcomingExamsCount] = yield Promise.all([
            prisma_1.default.examSubmission.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                include: {
                    exam: {
                        select: {
                            title: true,
                            type: true
                        }
                    }
                }
            }),
            prisma_1.default.lessonProgress.findMany({
                where: { userId },
                include: {
                    lesson: {
                        select: {
                            title: true,
                            duration: true,
                            courseId: true,
                            course: { select: { title: true } }
                        }
                    }
                },
                orderBy: { updatedAt: 'desc' }
            }),
            prisma_1.default.examSubmission.aggregate({
                where: { userId },
                _avg: { percentage: true }
            }),
            prisma_1.default.course.findMany({
                where: courseWhere,
                select: { id: true, title: true, subject: true, coverImage: true, createdAt: true },
                orderBy: { createdAt: 'desc' }
            }),
            prisma_1.default.courseProgress.findMany({ where: { userId } }),
            prisma_1.default.exam.count({
                where: {
                    OR: [
                        { isCentral: true },
                        ...(student.schoolId ? [
                            { schoolId: student.schoolId },
                            { schools: { some: { id: student.schoolId } } }
                        ] : [])
                    ],
                    createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                }
            })
        ]);
        const completedLessonsData = allLessonProgresses.filter(lp => lp.isCompleted);
        const courseIds = availableCourses.map(course => course.id);
        const lessonCounts = courseIds.length > 0
            ? yield prisma_1.default.lesson.groupBy({
                by: ['courseId'],
                where: { courseId: { in: courseIds } },
                _count: { _all: true },
                _sum: { duration: true }
            })
            : [];
        // Build question count map by fetching lessons with non-null questions
        const lessonsWithQuestions = courseIds.length > 0
            ? yield prisma_1.default.lesson.findMany({
                where: { courseId: { in: courseIds }, questions: { not: 'DbNull' } },
                select: { courseId: true, questions: true }
            })
            : [];
        const questionCountMap = {};
        for (const l of lessonsWithQuestions) {
            if (!l.questions || !l.courseId)
                continue;
            try {
                const parsed = typeof l.questions === 'string' ? JSON.parse(l.questions) : l.questions;
                const count = Array.isArray(parsed) ? parsed.length : 0;
                questionCountMap[l.courseId] = (questionCountMap[l.courseId] || 0) + count;
            }
            catch (_d) {
                // ignore malformed JSON
            }
        }
        // 4. Efficiently map progress
        const completedCountMap = {};
        completedLessonsData.forEach(lp => {
            const cid = lp.lesson.courseId;
            if (cid)
                completedCountMap[cid] = (completedCountMap[cid] || 0) + 1;
        });
        const lessonCountMap = Object.fromEntries(lessonCounts.map((item) => [item.courseId, item._count._all]));
        const lessonDurationMap = Object.fromEntries(lessonCounts.map((item) => { var _a; return [item.courseId, ((_a = item._sum) === null || _a === void 0 ? void 0 : _a.duration) || 0]; }));
        const progressMap = Object.fromEntries(courseProgresses.map((progress) => [progress.courseId, progress]));
        const coursesWithProgress = availableCourses.map((course) => {
            const progress = progressMap[course.id];
            const totalLessons = lessonCountMap[course.id] || 0;
            const completedCount = completedCountMap[course.id] || 0;
            const percent = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;
            return {
                id: course.id,
                title: course.title,
                subject: course.subject || "عام",
                coverImage: course.coverImage,
                totalLessons,
                completedLessonsCount: completedCount,
                progressPercent: percent,
                lastAccessedAt: progress ? progress.lastAccessedAt : null,
                totalDurationSeconds: lessonDurationMap[course.id] || 0,
                totalQuestions: questionCountMap[course.id] || 0
            };
        });
        const totalPossibleLessons = availableCourses.reduce((acc, c) => acc + (lessonCountMap[c.id] || 0), 0);
        const totalCompleted = availableCourses.reduce((acc, c) => acc + (completedCountMap[c.id] || 0), 0);
        const overallCourseProgress = totalPossibleLessons > 0 ? Math.round((totalCompleted / totalPossibleLessons) * 100) : 0;
        const result = {
            name: student.name,
            grade: student.grade,
            xp: student.xp || 0,
            schoolName: (_a = student.school) === null || _a === void 0 ? void 0 : _a.name,
            classroomName: student.classroom ? student.classroom.name.split(' | ')[0] : null,
            teacherName: ((_c = (_b = student.classroom) === null || _b === void 0 ? void 0 : _b.teacher) === null || _c === void 0 ? void 0 : _c.name) || null,
            totalExams: allSubmissions.length,
            avgScore: Math.round(avgScoreData._avg.percentage || 0),
            upcomingExams: upcomingExamsCount,
            overallCourseProgress,
            courseProgresses: coursesWithProgress,
            recentExams: allSubmissions.slice(0, 5).map((s) => ({
                id: s.id,
                examTitle: s.exam.title,
                score: s.totalScore,
                percentage: s.percentage,
                date: s.createdAt
            })),
            submissions: allSubmissions,
            lessonProgresses: allLessonProgresses
        };
        (0, shared_1.setCache)(cacheKey, result);
        res.json(result);
    }
    catch (error) {
        console.error('Optimized Student stats error:', error);
        res.status(500).json({ error: 'Error fetching dashboard stats' });
    }
}));
// Admin/School Submissions List
router.get('/api/admin/submissions', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { schoolId, examId, page = '1', limit = '50' } = req.query;
        const take = Math.min(parseInt(limit) || 50, 200); // max 200 per page
        const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take;
        const where = {};
        if (examId)
            where.examId = examId;
        if (req.user.role === 'SCHOOL_ADMIN') {
            where.exam = {
                OR: [
                    { schoolId: req.user.schoolId },
                    { schools: { some: { id: req.user.schoolId } } }
                ]
            };
        }
        else if (schoolId) {
            where.user = { schoolId };
        }
        const [submissions, total] = yield Promise.all([
            prisma_1.default.examSubmission.findMany({
                where,
                include: {
                    user: { select: { name: true, username: true, school: { select: { name: true } } } },
                    exam: { select: { title: true, type: true } }
                },
                orderBy: { createdAt: 'desc' },
                take,
                skip,
            }),
            prisma_1.default.examSubmission.count({ where }),
        ]);
        res.json({
            submissions,
            pagination: {
                total,
                page: Math.max(parseInt(page) || 1, 1),
                limit: take,
                totalPages: Math.ceil(total / take),
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching submissions' });
    }
}));
// Update Lesson Progress
router.post('/api/progress/lesson/:lessonId', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT', 'SCHOOL_ADMIN', 'TEACHER', 'SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { lessonId } = req.params;
        const { watchedSeconds } = req.body;
        const userId = req.user.id;
        if (watchedSeconds === undefined || watchedSeconds === null) {
            return res.status(400).json({ error: 'watchedSeconds is required' });
        }
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id: lessonId },
            include: { course: { include: { enrollments: { where: { studentId: userId }, select: { id: true } } } } }
        });
        if (!lesson)
            return res.status(404).json({ error: 'Lesson not found' });
        const course = lesson.course;
        const courseGradeTargets = (0, shared_1.parseStringArray)(course.grades);
        if (course.grade)
            courseGradeTargets.push(course.grade);
        const matchesCourseGrade = courseGradeTargets.length === 0 || courseGradeTargets.includes(req.user.grade);
        const hasCourseAccess = (course.isCentral && matchesCourseGrade) ||
            (course.schoolId === req.user.schoolId && matchesCourseGrade) ||
            course.enrollments.length > 0;
        if (!hasCourseAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }
        let existingProgress = yield prisma_1.default.lessonProgress.findUnique({
            where: { userId_lessonId: { userId, lessonId } }
        });
        const totalWatched = Math.max((existingProgress === null || existingProgress === void 0 ? void 0 : existingProgress.watchedSeconds) || 0, watchedSeconds);
        let isCompleted;
        if (lesson.duration > 0) {
            // Mark complete at 80% (relaxed from 90% for better UX)
            isCompleted = totalWatched >= (lesson.duration * 0.8);
        }
        else {
            // If duration is unknown, mark as complete after 10 seconds (relaxed from 30s)
            isCompleted = totalWatched >= 10;
        }
        // Mark progress for internal tracking without heavy logging
        if (existingProgress) {
            existingProgress = yield prisma_1.default.lessonProgress.update({
                where: { id: existingProgress.id },
                data: {
                    watchedSeconds: Math.max(existingProgress.watchedSeconds, watchedSeconds),
                    isCompleted: existingProgress.isCompleted || isCompleted
                }
            });
        }
        else {
            existingProgress = yield prisma_1.default.lessonProgress.create({
                data: {
                    userId,
                    lessonId,
                    watchedSeconds,
                    isCompleted
                }
            });
        }
        // Now update CourseProgress
        const courseLessons = yield prisma_1.default.lesson.findMany({
            where: { courseId: lesson.courseId },
            select: { id: true }
        });
        const completedLessons = yield prisma_1.default.lessonProgress.count({
            where: {
                userId,
                lessonId: { in: courseLessons.map(l => l.id) },
                isCompleted: true
            }
        });
        const progressPercent = courseLessons.length > 0
            ? Math.round((completedLessons / courseLessons.length) * 100)
            : 0;
        yield prisma_1.default.courseProgress.upsert({
            where: { userId_courseId: { userId, courseId: lesson.courseId } },
            update: { progressPercent, lastAccessedAt: new Date() },
            create: { userId, courseId: lesson.courseId, progressPercent }
        });
        // Invalidate student stats cache
        shared_1.statsCache.delete(`student_stats_${userId}`);
        res.json({ success: true, progress: existingProgress, totalCourseProgress: progressPercent });
    }
    catch (error) {
        console.error('Error updating lesson progress:', error);
        res.status(500).json({ error: 'Error updating progress' });
    }
}));
// Student XP Summary (Gamification breakdown)
router.get('/api/student/xp-summary', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const user = yield prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, xp: true }
        });
        const histories = yield prisma_1.default.xPHistory.findMany({
            where: { userId }
        });
        const lessonIds = Array.from(new Set(histories.filter(h => h.sourceType.startsWith('LESSON_')).map(h => h.sourceId)));
        const lessons = yield prisma_1.default.lesson.findMany({
            where: { id: { in: lessonIds } },
            select: { id: true, courseId: true, domain: true, title: true, course: { select: { title: true } } }
        });
        const lessonMap = new Map(lessons.map(l => [l.id, l]));
        const examIds = Array.from(new Set(histories.filter(h => h.sourceType === 'EXAM').map(h => h.sourceId)));
        const exams = yield prisma_1.default.exam.findMany({
            where: { id: { in: examIds } },
            select: { id: true, courseId: true, title: true, course: { select: { title: true } } }
        });
        const examMap = new Map(exams.map(e => [e.id, e]));
        const courseXP = {};
        const skillsXP = { title: "مهارات كليفر (Skills Hub)", xp: 0 };
        histories.forEach(h => {
            var _a, _b;
            let courseId = '';
            let courseTitle = '';
            if (h.sourceType.startsWith('LESSON_')) {
                const lesson = lessonMap.get(h.sourceId);
                if (lesson && lesson.courseId) {
                    courseId = lesson.courseId;
                    courseTitle = ((_a = lesson.course) === null || _a === void 0 ? void 0 : _a.title) || 'كورس غير معروف';
                }
            }
            else if (h.sourceType === 'EXAM') {
                const exam = examMap.get(h.sourceId);
                if (exam && exam.courseId) {
                    courseId = exam.courseId;
                    courseTitle = ((_b = exam.course) === null || _b === void 0 ? void 0 : _b.title) || 'كورس غير معروف';
                }
            }
            else if (h.sourceType === 'INTERACTIVE_ACTIVITY') {
                skillsXP.xp += h.xp;
                return;
            }
            if (courseId) {
                if (!courseXP[courseId]) {
                    courseXP[courseId] = { courseId, title: courseTitle, xp: 0 };
                }
                courseXP[courseId].xp += h.xp;
            }
        });
        res.json({
            totalXP: (user === null || user === void 0 ? void 0 : user.xp) || 0,
            courseXP: Object.values(courseXP),
            skillsXP
        });
    }
    catch (error) {
        console.error('Error fetching XP summary:', error);
        res.status(500).json({ error: 'Error fetching XP summary', details: error.message });
    }
}));
// Submit Lesson Question Answer (Gamification)
router.post('/api/progress/lesson/:lessonId/submit-answer', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT', 'SCHOOL_ADMIN', 'TEACHER', 'SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { lessonId } = req.params;
        const { questionId, blockType, selectedAnswer } = req.body;
        const userId = req.user.id;
        if (!questionId || !blockType) {
            return res.status(400).json({ error: 'questionId and blockType are required.' });
        }
        const lesson = yield prisma_1.default.lesson.findUnique({
            where: { id: lessonId }
        });
        if (!lesson) {
            return res.status(404).json({ error: 'Lesson not found' });
        }
        // Parse blocks array based on blockType
        let blocksArray = [];
        if (blockType === 'slides') {
            blocksArray = lesson.slides || [];
        }
        else if (blockType === 'assignments') {
            blocksArray = lesson.assignments || [];
        }
        else if (blockType === 'questions') {
            blocksArray = lesson.questions || [];
        }
        else {
            return res.status(400).json({ error: 'Invalid blockType. Must be slides, assignments, or questions.' });
        }
        if (typeof blocksArray === 'string') {
            try {
                blocksArray = JSON.parse(blocksArray);
            }
            catch (_a) {
                blocksArray = [];
            }
        }
        if (!Array.isArray(blocksArray))
            blocksArray = [];
        // Find the question block
        let block = blocksArray.find((b) => String(b.id) === String(questionId));
        if (!block && /^\d+$/.test(String(questionId))) {
            block = blocksArray[parseInt(questionId)];
        }
        if (!block) {
            return res.status(404).json({ error: 'Question block not found.' });
        }
        const isCorrect = (0, shared_1.isAnswerCorrect)(block, selectedAnswer);
        // Track attempt number
        const attemptsCount = yield prisma_1.default.xPHistory.count({
            where: {
                userId,
                sourceId: lessonId,
                questionId,
                isBonus: false
            }
        });
        const attemptNum = attemptsCount + 1;
        const isFirstAttempt = attemptNum === 1;
        let defaultXP = 10;
        if (block.level) {
            const lvl = String(block.level).toLowerCase();
            if (lvl === 'easy' || lvl === 'foundation')
                defaultXP = 2;
            else if (lvl === 'medium' || lvl === 'on level')
                defaultXP = 4;
            else if (lvl === 'hard' || lvl === 'challenging' || lvl === 'advanced')
                defaultXP = 10;
        }
        const earnedXP = (isFirstAttempt && isCorrect) ? (block.xpPoints !== undefined ? Number(block.xpPoints) : defaultXP) : 0;
        const sourceType = blockType === 'questions' ? 'LESSON_QUIZ' : blockType === 'slides' ? 'LESSON_SLIDE' : 'LESSON_ASSIGNMENT';
        // Log regular attempt in XPHistory
        yield prisma_1.default.xPHistory.create({
            data: {
                userId,
                xp: earnedXP,
                sourceType,
                sourceId: lessonId,
                questionId,
                isCorrect,
                attemptNum
            }
        });
        // Compute streak of correct first attempts inside this blockType
        const firstAttempts = yield prisma_1.default.xPHistory.findMany({
            where: {
                userId,
                sourceId: lessonId,
                sourceType,
                attemptNum: 1,
                isBonus: false
            },
            orderBy: { createdAt: 'desc' }
        });
        let currentStreak = 0;
        for (const attempt of firstAttempts) {
            if (attempt.isCorrect) {
                currentStreak++;
            }
            else {
                break;
            }
        }
        // Award streak bonus
        let bonusXP = 0;
        if (isFirstAttempt && isCorrect && (currentStreak === 5 || currentStreak === 10)) {
            const bonusType = `streak_${currentStreak}`;
            const alreadyHasBonus = (yield prisma_1.default.xPHistory.count({
                where: {
                    userId,
                    sourceId: lessonId,
                    sourceType,
                    questionId: bonusType,
                    isBonus: true
                }
            })) > 0;
            if (!alreadyHasBonus) {
                bonusXP = currentStreak === 5 ? 10 : 30;
                yield prisma_1.default.xPHistory.create({
                    data: {
                        userId,
                        xp: bonusXP,
                        sourceType,
                        sourceId: lessonId,
                        questionId: bonusType,
                        isCorrect: true,
                        attemptNum: 1,
                        isBonus: true
                    }
                });
            }
        }
        const totalXPToAward = earnedXP + bonusXP;
        if (totalXPToAward > 0) {
            yield prisma_1.default.user.update({
                where: { id: userId },
                data: { xp: { increment: totalXPToAward } }
            });
        }
        const totalLessonXP = yield prisma_1.default.xPHistory.aggregate({
            where: { userId, sourceId: lessonId },
            _sum: { xp: true }
        });
        // Invalidate student stats cache
        shared_1.statsCache.delete(`student_stats_${userId}`);
        res.json({
            isCorrect,
            earnedXP,
            bonusXP,
            currentStreak: isFirstAttempt ? currentStreak : 0,
            totalLessonXP: totalLessonXP._sum.xp || 0
        });
    }
    catch (error) {
        console.error('Error submitting answer progress:', error);
        res.status(500).json({ error: 'Error submitting answer progress', details: error.message });
    }
}));
// ==========================================
// 🏆 XP SUMMARY (for gamification reports)
// ==========================================
router.get('/api/student/xp-summary', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        // Aggregate total XP for the user
        const [totalAgg, byLesson] = yield Promise.all([
            prisma_1.default.xPHistory.aggregate({
                where: { userId },
                _sum: { xp: true }
            }),
            prisma_1.default.xPHistory.findMany({
                where: { userId },
                select: { xp: true, sourceId: true }
            })
        ]);
        const totalXP = totalAgg._sum.xp || 0;
        // Group by lesson source, then join with lesson course info
        const lessonIds = [...new Set(byLesson.map(h => h.sourceId).filter(Boolean))];
        const lessonDetails = lessonIds.length > 0 ? yield prisma_1.default.lesson.findMany({
            where: { id: { in: lessonIds } },
            select: { id: true, title: true, courseId: true, course: { select: { id: true, title: true } } }
        }) : [];
        const lessonMap = new Map(lessonDetails.map(l => [l.id, l]));
        const courseXPMap = new Map();
        for (const h of byLesson) {
            const lesson = lessonMap.get(h.sourceId || '');
            if (lesson === null || lesson === void 0 ? void 0 : lesson.course) {
                const cid = lesson.course.id;
                if (!courseXPMap.has(cid)) {
                    courseXPMap.set(cid, { courseId: cid, title: lesson.course.title, xp: 0 });
                }
                courseXPMap.get(cid).xp += h.xp || 0;
            }
        }
        // Skills XP (non-lesson sources)
        const skillsXP = byLesson.filter(h => !lessonMap.has(h.sourceId || '')).reduce((acc, h) => acc + (h.xp || 0), 0);
        res.json({
            totalXP,
            courseXP: Array.from(courseXPMap.values()),
            skillsXP: { xp: skillsXP }
        });
    }
    catch (error) {
        console.error('Error fetching XP summary:', error);
        res.status(500).json({ error: 'Error fetching XP summary', totalXP: 0, courseXP: [], skillsXP: { xp: 0 } });
    }
}));
exports.default = router;
