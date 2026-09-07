import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import { 
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields, 
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, getCache, getCacheAsync, invalidateCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses
} from '../shared';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const router = Router();

// --- Extracted from lines 3980-4304 ---
router.get('/api/student/stats', verifyToken, checkRole(['STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const userId = req.user.id;

    // 1. Check cache (Redis first, fallback to local memory)
    const cacheKey = `student_stats_${userId}`;
    const cached = await getCacheAsync(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      return res.json(cached.data);
    }

    // 2. Fetch Student Basic Info
    const student = await prisma.user.findUnique({
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

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // 2. Build course filters
    const courseWhere = buildStudentCourseWhere(student);

    // 3. Fetch all dashboard data in PARALLEL
    const [
      allSubmissions,
      allLessonProgresses,
      avgScoreData,
      availableCourses,
      courseProgresses,
      upcomingExamsCount
    ] = await Promise.all([
      prisma.examSubmission.findMany({
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
      prisma.lessonProgress.findMany({
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
      prisma.examSubmission.aggregate({
        where: { userId },
        _avg: { percentage: true }
      }),
      prisma.course.findMany({
        where: courseWhere,
        select: { id: true, title: true, subject: true, coverImage: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.courseProgress.findMany({ where: { userId } }),
      prisma.exam.count({
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
      ? await prisma.lesson.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds } },
        _count: { _all: true },
        _sum: { duration: true }
      })
      : [];

    // Build question count map by fetching lessons with non-null questions
    const lessonsWithQuestions = courseIds.length > 0
      ? await prisma.lesson.findMany({
        where: { courseId: { in: courseIds }, questions: { not: 'DbNull' as any } },
        select: { courseId: true, questions: true }
      })
      : [];

    const questionCountMap: Record<string, number> = {};
    for (const l of lessonsWithQuestions) {
      if (!l.questions || !l.courseId) continue;
      try {
        const parsed = typeof l.questions === 'string' ? JSON.parse(l.questions) : l.questions;
        const count = Array.isArray(parsed) ? parsed.length : 0;
        questionCountMap[l.courseId] = (questionCountMap[l.courseId] || 0) + count;
      } catch {
        // ignore malformed JSON
      }
    }

    // 4. Efficiently map progress
    const completedCountMap: Record<string, number> = {};
    completedLessonsData.forEach(lp => {
      const cid = lp.lesson.courseId;
      if (cid) completedCountMap[cid] = (completedCountMap[cid] || 0) + 1;
    });
    const lessonCountMap = Object.fromEntries(lessonCounts.map((item: any) => [item.courseId, item._count._all]));
    const lessonDurationMap = Object.fromEntries(lessonCounts.map((item: any) => [item.courseId, item._sum?.duration || 0]));
    const progressMap = Object.fromEntries(courseProgresses.map((progress: any) => [progress.courseId, progress]));

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
      schoolName: student.school?.name,
      classroomName: student.classroom ? student.classroom.name.split(' | ')[0] : null,
      teacherName: student.classroom?.teacher?.name || null,
      totalExams: allSubmissions.length,
      avgScore: Math.round(avgScoreData._avg.percentage || 0),
      upcomingExams: upcomingExamsCount,
      overallCourseProgress,
      courseProgresses: coursesWithProgress,
      recentExams: allSubmissions.slice(0, 5).map((s: any) => ({
        id: s.id,
        examTitle: s.exam.title,
        score: s.totalScore,
        percentage: s.percentage,
        date: s.createdAt
      })),
      submissions: allSubmissions,
      lessonProgresses: allLessonProgresses
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('Optimized Student stats error:', error);
    res.status(500).json({ error: 'Error fetching dashboard stats' });
  }
});

// Admin/School Submissions List
router.get('/api/admin/submissions', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), async (req: any, res: any) => {
  try {
    const { schoolId, examId, page = '1', limit = '50' } = req.query;
    const take = Math.min(parseInt(limit as string) || 50, 200); // max 200 per page
    const skip = (Math.max(parseInt(page as string) || 1, 1) - 1) * take;

    const where: any = {};

    if (examId) where.examId = examId;

    if (req.user.role === 'SCHOOL_ADMIN') {
      where.exam = {
        OR: [
          { schoolId: req.user.schoolId },
          { schools: { some: { id: req.user.schoolId } } }
        ]
      };
    } else if (schoolId) {
      where.user = { schoolId };
    }

    const [submissions, total] = await Promise.all([
      prisma.examSubmission.findMany({
        where,
        include: {
          user: { select: { name: true, username: true, school: { select: { name: true } } } },
          exam: { select: { title: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.examSubmission.count({ where }),
    ]);

    res.json({
      submissions,
      pagination: {
        total,
        page: Math.max(parseInt(page as string) || 1, 1),
        limit: take,
        totalPages: Math.ceil(total / take),
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching submissions' });
  }
});

// Update Lesson Progress
router.post('/api/progress/lesson/:lessonId', verifyToken, checkRole(['STUDENT', 'SCHOOL_ADMIN', 'TEACHER', 'SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { lessonId } = req.params;
    const { watchedSeconds } = req.body;
    const userId = req.user.id;

    if (watchedSeconds === undefined || watchedSeconds === null) {
      return res.status(400).json({ error: 'watchedSeconds is required' });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { course: { include: { enrollments: { where: { studentId: userId }, select: { id: true } } } } }
    });

    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    const course = lesson.course;
    const courseGradeTargets = parseStringArray(course.grades);
    if (course.grade) courseGradeTargets.push(course.grade);
    const matchesCourseGrade = courseGradeTargets.length === 0 || courseGradeTargets.includes(req.user.grade);
    const hasCourseAccess =
      (course.isCentral && matchesCourseGrade) ||
      (course.schoolId === req.user.schoolId && matchesCourseGrade) ||
      course.enrollments.length > 0;

    if (!hasCourseAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let existingProgress = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } }
    });

    const totalWatched = Math.max(existingProgress?.watchedSeconds || 0, watchedSeconds);
    let isCompleted: boolean;

    if (lesson.duration > 0) {
      // Mark complete at 80% (relaxed from 90% for better UX)
      isCompleted = totalWatched >= (lesson.duration * 0.8);
    } else {
      // If duration is unknown, mark as complete after 10 seconds (relaxed from 30s)
      isCompleted = totalWatched >= 10;
    }

    // Mark progress for internal tracking without heavy logging

    if (existingProgress) {
      existingProgress = await prisma.lessonProgress.update({
        where: { id: existingProgress.id },
        data: {
          watchedSeconds: Math.max(existingProgress.watchedSeconds, watchedSeconds),
          isCompleted: existingProgress.isCompleted || isCompleted
        }
      });
    } else {
      existingProgress = await prisma.lessonProgress.create({
        data: {
          userId,
          lessonId,
          watchedSeconds,
          isCompleted
        }
      });
    }

    // Now update CourseProgress
    const courseLessons = await prisma.lesson.findMany({
      where: { courseId: lesson.courseId },
      select: { id: true }
    });

    const completedLessons = await prisma.lessonProgress.count({
      where: {
        userId,
        lessonId: { in: courseLessons.map(l => l.id) },
        isCompleted: true
      }
    });

    const progressPercent = courseLessons.length > 0
      ? Math.round((completedLessons / courseLessons.length) * 100)
      : 0;

    await prisma.courseProgress.upsert({
      where: { userId_courseId: { userId, courseId: lesson.courseId } },
      update: { progressPercent, lastAccessedAt: new Date() },
      create: { userId, courseId: lesson.courseId, progressPercent }
    });

    // Invalidate student stats cache across cluster
    await invalidateCache(`student_stats_${userId}`);

    res.json({ success: true, progress: existingProgress, totalCourseProgress: progressPercent });
  } catch (error) {
    console.error('Error updating lesson progress:', error);
    res.status(500).json({ error: 'Error updating progress' });
  }
});



// Student XP Summary (Gamification breakdown)
router.get('/api/student/xp-summary', verifyToken, checkRole(['STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, xp: true }
    });

    const histories = await prisma.xPHistory.findMany({
      where: { userId }
    });

    const lessonIds = Array.from(new Set(histories.filter(h => h.sourceType.startsWith('LESSON_')).map(h => h.sourceId)));
    const lessons = await prisma.lesson.findMany({
      where: { id: { in: lessonIds } },
      select: { id: true, courseId: true, domain: true, title: true, course: { select: { title: true } } }
    });
    const lessonMap = new Map(lessons.map(l => [l.id, l]));

    const examIds = Array.from(new Set(histories.filter(h => h.sourceType === 'EXAM').map(h => h.sourceId)));
    const exams = await prisma.exam.findMany({
      where: { id: { in: examIds } },
      select: { id: true, courseId: true, title: true, course: { select: { title: true } } }
    });
    const examMap = new Map(exams.map(e => [e.id, e]));

    const courseXP: Record<string, { courseId: string; title: string; xp: number }> = {};
    const skillsXP = { title: "مهارات كليفر (Skills Hub)", xp: 0 };

    histories.forEach(h => {
      let courseId = '';
      let courseTitle = '';

      if (h.sourceType.startsWith('LESSON_')) {
        const lesson = lessonMap.get(h.sourceId);
        if (lesson && lesson.courseId) {
          courseId = lesson.courseId;
          courseTitle = lesson.course?.title || 'كورس غير معروف';
        }
      } else if (h.sourceType === 'EXAM') {
        const exam = examMap.get(h.sourceId);
        if (exam && exam.courseId) {
          courseId = exam.courseId;
          courseTitle = exam.course?.title || 'كورس غير معروف';
        }
      } else if (h.sourceType === 'INTERACTIVE_ACTIVITY') {
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
      totalXP: user?.xp || 0,
      courseXP: Object.values(courseXP),
      skillsXP
    });
  } catch (error: any) {
    console.error('Error fetching XP summary:', error);
    res.status(500).json({ error: 'Error fetching XP summary', details: error.message });
  }
});

// Submit Lesson Question Answer (Gamification)
router.post('/api/progress/lesson/:lessonId/submit-answer', verifyToken, checkRole(['STUDENT', 'SCHOOL_ADMIN', 'TEACHER', 'SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { lessonId } = req.params;
    const { questionId, blockType, selectedAnswer } = req.body;
    const userId = req.user.id;

    if (!questionId || !blockType) {
      return res.status(400).json({ error: 'questionId and blockType are required.' });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId }
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Parse blocks array based on blockType
    let blocksArray: any[] = [];
    if (blockType === 'slides') {
      blocksArray = (lesson.slides as any) || [];
    } else if (blockType === 'assignments') {
      blocksArray = (lesson.assignments as any) || [];
    } else if (blockType === 'questions') {
      blocksArray = (lesson.questions as any) || [];
    } else {
      return res.status(400).json({ error: 'Invalid blockType. Must be slides, assignments, or questions.' });
    }

    if (typeof blocksArray === 'string') {
      try { blocksArray = JSON.parse(blocksArray); } catch { blocksArray = []; }
    }
    if (!Array.isArray(blocksArray)) blocksArray = [];

    // Find the question block
    let block = blocksArray.find((b: any) => String(b.id) === String(questionId));
    if (!block && /^\d+$/.test(String(questionId))) {
      block = blocksArray[parseInt(questionId)];
    }

    if (!block) {
      return res.status(404).json({ error: 'Question block not found.' });
    }

    const isCorrect = isAnswerCorrect(block, selectedAnswer);

    // Track attempt number
    const attemptsCount = await prisma.xPHistory.count({
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
      if (lvl === 'easy' || lvl === 'foundation') defaultXP = 2;
      else if (lvl === 'medium' || lvl === 'on level') defaultXP = 4;
      else if (lvl === 'hard' || lvl === 'challenging' || lvl === 'advanced') defaultXP = 10;
    }
    const earnedXP = (isFirstAttempt && isCorrect) ? (block.xpPoints !== undefined ? Number(block.xpPoints) : defaultXP) : 0;
    const sourceType = blockType === 'questions' ? 'LESSON_QUIZ' : blockType === 'slides' ? 'LESSON_SLIDE' : 'LESSON_ASSIGNMENT';

    // Log regular attempt in XPHistory
    await prisma.xPHistory.create({
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
    const firstAttempts = await prisma.xPHistory.findMany({
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
      } else {
        break;
      }
    }

    // Award streak bonus
    let bonusXP = 0;
    if (isFirstAttempt && isCorrect && (currentStreak === 5 || currentStreak === 10)) {
      const bonusType = `streak_${currentStreak}`;
      const alreadyHasBonus = await prisma.xPHistory.count({
        where: {
          userId,
          sourceId: lessonId,
          sourceType,
          questionId: bonusType,
          isBonus: true
        }
      }) > 0;

      if (!alreadyHasBonus) {
        bonusXP = currentStreak === 5 ? 10 : 30;
        await prisma.xPHistory.create({
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
      await prisma.user.update({
        where: { id: userId },
        data: { xp: { increment: totalXPToAward } }
      });
    }

    const totalLessonXP = await prisma.xPHistory.aggregate({
      where: { userId, sourceId: lessonId },
      _sum: { xp: true }
    });

    // Invalidate student stats cache across cluster
    await invalidateCache(`student_stats_${userId}`);

    res.json({
      isCorrect,
      earnedXP,
      bonusXP,
      currentStreak: isFirstAttempt ? currentStreak : 0,
      totalLessonXP: totalLessonXP._sum.xp || 0
    });
  } catch (error: any) {
    console.error('Error submitting answer progress:', error);
    res.status(500).json({ error: 'Error submitting answer progress', details: error.message });
  }
});

// ==========================================
// 🏆 XP SUMMARY (for gamification reports)
// ==========================================
router.get('/api/student/xp-summary', verifyToken, checkRole(['STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const userId = req.user.id;

    // Aggregate total XP for the user
    const [totalAgg, byLesson] = await Promise.all([
      prisma.xPHistory.aggregate({
        where: { userId },
        _sum: { xp: true }
      }),
      prisma.xPHistory.findMany({
        where: { userId },
        select: { xp: true, sourceId: true }
      })
    ]);

    const totalXP = totalAgg._sum.xp || 0;

    // Group by lesson source, then join with lesson course info
    const lessonIds = [...new Set(byLesson.map(h => h.sourceId).filter(Boolean))];
    const lessonDetails = lessonIds.length > 0 ? await prisma.lesson.findMany({
      where: { id: { in: lessonIds } },
      select: { id: true, title: true, courseId: true, course: { select: { id: true, title: true } } }
    }) : [];

    const lessonMap = new Map(lessonDetails.map(l => [l.id, l]));
    const courseXPMap = new Map<string, { courseId: string; title: string; xp: number }>();

    for (const h of byLesson) {
      const lesson = lessonMap.get(h.sourceId || '');
      if (lesson?.course) {
        const cid = lesson.course.id;
        if (!courseXPMap.has(cid)) {
          courseXPMap.set(cid, { courseId: cid, title: lesson.course.title, xp: 0 });
        }
        courseXPMap.get(cid)!.xp += h.xp || 0;
      }
    }

    // Skills XP (non-lesson sources)
    const skillsXP = byLesson.filter(h => !lessonMap.has(h.sourceId || '')).reduce((acc, h) => acc + (h.xp || 0), 0);

    res.json({
      totalXP,
      courseXP: Array.from(courseXPMap.values()),
      skillsXP: { xp: skillsXP }
    });
  } catch (error: any) {
    console.error('Error fetching XP summary:', error);
    res.status(500).json({ error: 'Error fetching XP summary', totalXP: 0, courseXP: [], skillsXP: { xp: 0 } });
  }
});

export default router;
