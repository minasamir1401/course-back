import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken, checkRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// GET /api/deduplicate/scan
// Requires SUPER_ADMIN
router.get('/scan', verifyToken, checkRole(['SUPER_ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const results = {
      courses: [] as any[],
      exams: [] as any[],
      lessons: [] as any[],
      questions: [] as any[],
      bankQuestions: [] as any[],
    };

    // 1. Scan Courses (Group by title, description, subject)
    const duplicateCoursesGroups = (await prisma.course.groupBy({
      by: ['title', 'description', 'subject'],
      _count: { id: true }
    })).filter(g => g._count.id > 1);

    for (const group of duplicateCoursesGroups) {
      const courses = await prisma.course.findMany({
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
    const duplicateExamsGroups = (await prisma.exam.groupBy({
      by: ['title', 'courseId'],
      _count: { id: true }
    })).filter(g => g._count.id > 1);

    for (const group of duplicateExamsGroups) {
      const exams = await prisma.exam.findMany({
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
    const duplicateLessonsGroups = (await prisma.lesson.groupBy({
      by: ['title', 'courseId'],
      _count: { id: true }
    })).filter(g => g._count.id > 1);

    for (const group of duplicateLessonsGroups) {
      const lessons = await prisma.lesson.findMany({
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
    const duplicateQuestionsGroups = (await prisma.question.groupBy({
      by: ['text', 'examId'],
      _count: { id: true }
    })).filter(g => g._count.id > 1);

    for (const group of duplicateQuestionsGroups) {
      const questions = await prisma.question.findMany({
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
  } catch (error) {
    next(error);
  }
});

// POST /api/deduplicate/clean
// Expects { courses: string[], exams: string[], lessons: string[], questions: string[] }
router.post('/clean', verifyToken, checkRole(['SUPER_ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { courses = [], exams = [], lessons = [], questions = [] } = req.body;
    const deleted = { courses: 0, exams: 0, lessons: 0, questions: 0 };

    await prisma.$transaction(async (tx) => {
      if (questions.length > 0) {
        const result = await tx.question.deleteMany({ where: { id: { in: questions } } });
        deleted.questions = result.count;
      }
      if (lessons.length > 0) {
        const result = await tx.lesson.deleteMany({ where: { id: { in: lessons } } });
        deleted.lessons = result.count;
      }
      if (exams.length > 0) {
        const result = await tx.exam.deleteMany({ where: { id: { in: exams } } });
        deleted.exams = result.count;
      }
      if (courses.length > 0) {
        const result = await tx.course.deleteMany({ where: { id: { in: courses } } });
        deleted.courses = result.count;
      }
    });

    res.json({ message: 'Duplicates cleaned successfully', deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
