import prisma from '../lib/prisma';
import { examMatchesStudent } from '../shared';
import { canViewExam } from '../controllers/examControllerSupport';
import { attemptPassed, selectAttempts, ratio } from '../utils/reportMetrics';
import { reportFilters, ReportError } from './reporting.service';

export async function examAttendance(user: any, query: Record<string, any>) {
  const filters = reportFilters(user, query);
  if (!filters.examId || !filters.schoolId) throw new ReportError('Select a school and exam');
  const exam = await prisma.exam.findUnique({ where: { id: filters.examId }, include: { schools: { select: { id: true } }, modules: { include: { subExams: true } } } });
  if (!exam || !await canViewExam(user, exam)) throw new ReportError('Exam not accessible', 403);
  const child = filters.subExamId ? exam.modules.flatMap(module => module.subExams).find(item => item.id === filters.subExamId) : null;
  if (filters.subExamId && !child) throw new ReportError('Invalid exam section');
  const candidates = await prisma.user.findMany({ where: { schoolId: filters.schoolId, role: 'STUDENT', deletedAt: null, status: 'ACTIVE',
    ...(filters.grade ? { grade: filters.grade } : {}), ...(filters.classroomId ? { classroomId: filters.classroomId } : {}),
    ...(user.role === 'TEACHER' ? { classroom: { teacherId: user.id } } : {}) },
    select: { id: true, name: true, username: true, grade: true, schoolId: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 50001 });
  if (candidates.length > 50000) throw new ReportError('Narrow the grade or class filter', 422);
  const students = candidates.filter(student => examMatchesStudent(exam, { ...student, role: 'STUDENT' }));
  const submissions = await prisma.examSubmission.findMany({ where: { examId: exam.id,
    subExamId: filters.subExamId || null, userId: { in: students.map(student => student.id) } },
    select: { id: true, userId: true, examId: true, subExamId: true, totalScore: true, percentage: true, reportSnapshot: true, createdAt: true,
      answers: { select: { isCorrect: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50001 });
  if (submissions.length > 50000) throw new ReportError('Too many attempts for this exam section', 422);
  const chosen = new Map(selectAttempts(submissions, filters.policy).map(row => [row.userId, row]));
  const deadline = child?.cutOffDate || exam.endDate;
  const start = child?.publishDate || exam.startDate;
  const now = new Date();
  const missingStatus = deadline && deadline < now ? 'MISSED' : start && start > now ? 'UPCOMING' : 'PENDING';
  const allRows = students.map(student => {
    const submission = chosen.get(student.id);
    return { ...student, status: submission ? 'SUBMITTED' : missingStatus,
      submissionId: submission?.id, score: submission?.totalScore ?? null, percentage: submission?.percentage ?? null,
      passed: submission ? attemptPassed({ ...submission, exam, subExam: child, correctAnswers: submission.answers.filter(answer => answer.isCorrect).length, totalQuestions: submission.answers.length }) : null,
      submittedAt: submission?.createdAt ?? null };
  });
  const attendedCount = allRows.filter(row => row.status === 'SUBMITTED').length;
  const status = typeof query.status === 'string' ? query.status : '';
  const matching = allRows.filter(row => (!status || row.status === status) && (!filters.search || [row.name, row.username].some(value => value.toLowerCase().includes(filters.search.toLowerCase()))));
  const rows = matching.slice((filters.page - 1) * filters.limit, filters.page * filters.limit);
  return { rows, attended: rows.filter(row => row.status === 'SUBMITTED'), missed: rows.filter(row => row.status !== 'SUBMITTED'),
    total: students.length, attendedCount, missedCount: allRows.filter(row => row.status === 'MISSED').length,
    pendingCount: allRows.filter(row => row.status === 'PENDING' || row.status === 'UPCOMING').length,
    participationRate: ratio(attendedCount, students.length), exam: { id: exam.id, title: child?.title || exam.title, startDate: start, endDate: deadline },
    generatedAt: now.toISOString(), timeZone: 'Africa/Cairo', filters, missingStatus, periodBasis: 'all-attempts-for-selected-exam',
    pagination: { page: filters.page, limit: filters.limit, total: matching.length, pages: Math.ceil(matching.length / filters.limit), hasMore: filters.page * filters.limit < matching.length }, exportRows: matching };
}
