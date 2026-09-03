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
  statsCache, CACHE_TTL, setCache, getCache, getStudentGradeAndStage, examMatchesStudent,
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

// --- Extracted from lines 3851-3979 ---
router.get('/api/reports/school', verifyToken, checkRole(['SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER']), checkSchoolAccess, async (req: any, res: any) => {
  const targetSchoolId = req.user.role === 'SUPER_ADMIN' ? req.query.schoolId : req.user.schoolId;

  try {
    const cacheKey = `school_reports_${targetSchoolId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    // ✅ PERF FIX: Use parallel count + aggregate instead of loading ALL submissions into RAM
    const [studentsCount, teachersCount, submissionStats] = await Promise.all([
      prisma.user.count({ where: { schoolId: targetSchoolId as string, role: 'STUDENT' } }),
      prisma.user.count({ where: { schoolId: targetSchoolId as string, role: 'TEACHER' } }),
      prisma.examSubmission.aggregate({
        where: { user: { schoolId: targetSchoolId as string } },
        _avg: { percentage: true },
        _count: { id: true },
      }),
    ]);

    const averageScore = Math.round(submissionStats._avg.percentage || 0);
    const totalExamsTaken = submissionStats._count.id;

    const stats = { schoolId: targetSchoolId, studentsCount, teachersCount, averageScore, totalExamsTaken };
    setCache(cacheKey, stats);
    res.json(stats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error generating report' });
  }
});

// Student Dashboard Stats
router.get('/api/student/dashboard-stats', verifyToken, checkRole(['STUDENT']), async (req: any, res: any) => {
  try {
    const studentId = req.user.id;
    const cacheKey = `student_dashboard_${studentId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const student = await prisma.user.findUnique({
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

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Count upcoming exams in the student's school
    const upcomingExamsCount = await prisma.exam.count({
      where: {
        schoolId: student.schoolId,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Placeholder for "upcoming/recent"
      }
    });

    const stats = {
      name: student.name,
      schoolName: student.school?.name,
      coursesCount: student._count.studentEnrollments,
      examsTaken: student._count.examSubmissions,
      upcomingExams: upcomingExamsCount,
      overallProgress: 0 // Placeholder
    };

    setCache(cacheKey, stats);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching dashboard stats' });
  }
});


// (Removed redundant route definition)


// ==========================================
// 📊 STATS & REPORTS
// ==========================================

// Exam Attendance Report
router.get('/api/reports/exam-attendance', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), async (req: Request, res: Response) => {
  try {
    const { schoolId, grade, examId } = req.query;

    if (!examId) return res.status(400).json({ error: 'examId is required' });

    let targetSchoolId = schoolId as string;
    if (req.user.role === 'SCHOOL_ADMIN') {
      targetSchoolId = req.user.schoolId;
    }

    if (!targetSchoolId) return res.status(400).json({ error: 'schoolId is required' });

    // Pagination params — max 200 per page to prevent large payloads
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
    const skip = (page - 1) * limit;

    // Build user filter
    const userWhere: any = { role: 'STUDENT', schoolId: targetSchoolId };
    if (grade) {
      userWhere.grade = grade;
    }

    // Count total students for pagination metadata
    const totalStudents = await prisma.user.count({ where: userWhere });

    // Get paginated students
    const students = await prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true, username: true, grade: true },
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    });

    // Get all submissions for this exam for the current page of students
    const submissions = await prisma.examSubmission.findMany({
      where: {
        examId: examId as string,
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

    const attended: any[] = [];
    const missed: any[] = [];

    for (const student of students) {
      if (submissionMap.has(student.id)) {
        const sub = submissionMap.get(student.id);
        attended.push({ ...student, score: sub.totalScore, percentage: sub.percentage, submittedAt: sub.createdAt });
      } else {
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
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Error generating report' });
  }
});


// Student Stats (Admins can also view their own stats for testing)

export default router;
