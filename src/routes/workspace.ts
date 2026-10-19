import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma';
import { verifyToken, checkRole } from '../middleware/auth';
import { buildStudentCourseWhere, examMatchesStudent } from '../shared';
import { egyptDay, reportRange } from '../utils/egyptTime';

const router = Router();
const workspaceRoles = checkRole(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']);
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

router.get('/api/workspace/calendar', verifyToken, workspaceRoles, async (req: any, res: any) => {
  try {
    const range = reportRange(req.query);
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, role: true, schoolId: true, grade: true } });
    if (!user) return res.status(404).json({ error: 'Account not found' });
    const [exams, lessons] = await Promise.all([
      prisma.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', ...(user.role === 'SUPER_ADMIN' ? {} : { OR: [ { isCentral: true }, { schoolId: user.schoolId || '__none__' }, { schools: { some: { id: user.schoolId || '__none__' } } } ] }) },
        select: { id: true, title: true, type: true, grade: true, grades: true, isCentral: true, schoolId: true, schools: { select: { id: true } }, startDate: true, endDate: true,
          modules: { select: { subExams: { select: { id: true, title: true, publishDate: true, cutOffDate: true } } } } } }),
      prisma.lesson.findMany({ where: { deletedAt: null, isVisible: true, course: { ...buildStudentCourseWhere(user), deletedAt: null },
        OR: [{ publishDate: { gte: range.start, lt: range.end } }, { cutOffDate: { gte: range.start, lt: range.end } }] },
        select: { id: true, title: true, courseId: true, publishDate: true, cutOffDate: true } }),
    ]);
    const events: any[] = [];
    const add = (id: string, title: string, kind: string, date: Date | null, href: string) => {
      if (date && date >= range.start && date < range.end) events.push({ id, title, kind, at: date.toISOString(), day: egyptDay(date), href });
    };
    for (const exam of exams.filter(exam => user.role !== 'STUDENT' || examMatchesStudent(exam, user))) {
      const href = user.role === 'STUDENT' ? `/exams/${exam.id}/details` : `/${user.role === 'SUPER_ADMIN' ? 'super-admin' : 'school-admin'}/exams/analytics/${exam.id}`;
      add(exam.id + '-start', exam.title, 'EXAM_START', exam.startDate, href); add(exam.id + '-end', exam.title, 'EXAM_END', exam.endDate, href);
      for (const child of exam.modules.flatMap(module => module.subExams)) {
        const childHref = user.role === 'STUDENT' ? `/exams/${exam.id}?subExamId=${child.id}` : href;
        add(child.id + '-start', child.title, 'EXAM_START', child.publishDate, childHref); add(child.id + '-end', child.title, 'EXAM_END', child.cutOffDate, childHref);
      }
    }
    for (const lesson of lessons) { add(lesson.id + '-start', lesson.title, 'LESSON_START', lesson.publishDate, `/lessons/${lesson.id}?courseId=${lesson.courseId}`); add(lesson.id + '-end', lesson.title, 'LESSON_END', lesson.cutOffDate, `/lessons/${lesson.id}?courseId=${lesson.courseId}`); }
    res.json({ events: events.sort((a, b) => a.at.localeCompare(b.at)), from: range.from, to: range.to, timeZone: range.timeZone, generatedAt: new Date().toISOString() });
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get('/api/workspace/assignments', verifyToken, checkRole(['STUDENT']), async (req: any, res: any) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Student not found' });
    const [exams, lessons] = await Promise.all([
      prisma.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', type: { in: ['Assignment', 'ASSIGNMENT', 'Homework', 'HOMEWORK', 'واجب'] } }, include: { schools: { select: { id: true } }, submissions: { where: { userId: user.id }, select: { id: true } } } }),
      prisma.lesson.findMany({ where: { deletedAt: null, isVisible: true, course: { ...buildStudentCourseWhere(user), deletedAt: null } },
        select: { id: true, title: true, courseId: true, assignments: true, publishDate: true, cutOffDate: true, progresses: { where: { userId: user.id }, select: { isCompleted: true } } } }),
    ]);
    const now = new Date();
    const status = (date: Date | null, end: Date | null, completed: boolean) => completed ? 'COMPLETED' : end && end < now ? 'CLOSED' : date && date > now ? 'UPCOMING' : 'AVAILABLE';
    const tasks: any[] = exams.filter(exam => examMatchesStudent(exam, user)).map(exam => ({ id: exam.id, title: exam.title,
      status: status(exam.startDate, exam.endDate, exam.submissions.length > 0), dueAt: exam.endDate, href: `/exams/${exam.id}/details`, kind: 'EXAM' }));
    for (const lesson of lessons) {
      let assignments: any = lesson.assignments;
      try { if (typeof assignments === 'string') assignments = JSON.parse(assignments); } catch { assignments = []; }
      if (!Array.isArray(assignments) || !assignments.length) continue;
      tasks.push({ id: lesson.id, title: lesson.title, dueAt: lesson.cutOffDate, status: status(lesson.publishDate, lesson.cutOffDate, false),
        href: `/lessons/${lesson.id}?courseId=${lesson.courseId}`, kind: 'LESSON', questionCount: assignments.length });
    }
    res.json({ tasks, generatedAt: now.toISOString(), timeZone: 'Africa/Cairo' });
  } catch { res.status(500).json({ error: 'Could not load assignments' }); }
});

router.post('/api/auth/change-password', verifyToken, workspaceRoles, writeLimiter, async (req: any, res: any) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 72) return res.status(400).json({ error: 'Use a new password of 10–72 characters' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !await bcrypt.compare(currentPassword, user.password)) return res.status(403).json({ error: 'Current password is incorrect' });
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword, 12) } });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Password could not be changed' }); }
});
export default router;
