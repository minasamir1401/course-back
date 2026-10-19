import { metadataForDisplay } from '../utils/bilingualMetadata';
import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { examMatchesStudent } from '../shared';
import { canViewExam } from '../controllers/examControllerSupport';
import { egyptDay, reportRange } from '../utils/egyptTime';
import { attemptPassed, attemptPolicy, passingThreshold, ratio, roundMetric, selectAttempts } from '../utils/reportMetrics';

export class ReportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function reportFilters(user: any, query: Record<string, any>) {
  const string = (key: string) => typeof query[key] === 'string' ? query[key].trim() : '';
  const schoolId = user.role === 'SUPER_ADMIN' ? string('schoolId') : user.schoolId;
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'STUDENT' && !schoolId) throw new ReportError('Your account has no school', 403);
  return {
    ...reportRange(query), policy: attemptPolicy(query.attemptPolicy), schoolId: schoolId || '',
    grade: string('grade'), classroomId: string('classroomId'), subject: string('subject'),
    courseId: string('courseId'), examId: string('examId'), subExamId: string('subExamId'),
    page: Math.max(1, Number.parseInt(string('page')) || 1), limit: Math.min(100, Math.max(1, Number.parseInt(string('limit')) || 25)),
    search: string('search').slice(0, 100),
  };
}

export function reportSubmissionWhere(user: any, filters: ReturnType<typeof reportFilters>) {
  const AND: any[] = [{ user: { role: 'STUDENT', deletedAt: null } }, { createdAt: { gte: filters.start, lt: filters.end } }];
  if (user.role === 'STUDENT') AND.push({ userId: user.id, exam: { resultVisibility: { not: 'HIDE_ALL' } } });
  if (filters.schoolId) AND.push({ OR: [
    { schoolIdAtSubmission: filters.schoolId },
    { schoolIdAtSubmission: null, user: { schoolId: filters.schoolId } },
  ] });
  if (filters.grade) AND.push({ OR: [
    { gradeAtSubmission: filters.grade },
    { gradeAtSubmission: null, user: { grade: filters.grade } },
  ] });
  if (filters.classroomId) AND.push({ OR: [
    { reportSnapshot: { path: ['classroomId'], equals: filters.classroomId } },
    { reportSnapshot: { equals: Prisma.DbNull }, user: { classroomId: filters.classroomId } },
  ] });
  if (user.role === 'TEACHER') AND.push({ user: { classroom: { teacherId: user.id } } });
  if (filters.examId) AND.push({ examId: filters.examId });
  if (filters.subExamId) AND.push({ subExamId: filters.subExamId });
  if (filters.courseId || filters.subject) AND.push({ exam: {
    ...(filters.courseId ? { courseId: filters.courseId } : {}),
    ...(filters.subject ? { OR: [{ subjects: { contains: JSON.stringify(filters.subject) } }, { subjects: filters.subject }] } : {}),
  } });
  return { AND };
}

const reportInclude = {
  user: { select: { id: true, name: true, username: true, grade: true, schoolId: true, classroomId: true, school: { select: { name: true } } } },
  exam: { select: { id: true, title: true, type: true, subjects: true, passingScore: true, courseId: true } },
};

export async function reportOptions(user: any) {
  const studentWhere: any = { role: 'STUDENT', deletedAt: null, ...(user.role !== 'SUPER_ADMIN' ? { schoolId: user.schoolId } : {}),
    ...(user.role === 'STUDENT' ? { id: user.id } : {}), ...(user.role === 'TEACHER' ? { classroom: { teacherId: user.id } } : {}) };
  const schoolWhere = user.role === 'SUPER_ADMIN' ? {} : { id: user.schoolId || '__none__' };
  const [schools, grades, classrooms, exams] = await Promise.all([
    prisma.school.findMany({ where: schoolWhere, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: studentWhere, distinct: ['grade'], select: { grade: true } }),
    prisma.classroom.findMany({ where: { ...(user.role !== 'SUPER_ADMIN' ? { schoolId: user.schoolId || '__none__' } : {}),
      ...(user.role === 'TEACHER' ? { teacherId: user.id } : {}) }, select: { id: true, name: true, schoolId: true, grade: true }, orderBy: { name: 'asc' } }),
    prisma.exam.findMany({ where: { deletedAt: null, ...(user.role === 'STUDENT' ? { status: 'PUBLISHED', resultVisibility: { not: 'HIDE_ALL' } } : {}), ...(user.role === 'SUPER_ADMIN' ? {} : { OR: [
      { isCentral: true }, { schoolId: user.schoolId || '__none__' }, { schools: { some: { id: user.schoolId || '__none__' } } },
    ] }) }, select: { id: true, title: true, type: true, subjects: true, grade: true, grades: true, schoolId: true, isCentral: true,
      schools: { select: { id: true } }, courseId: true, course: { select: { id: true, title: true } }, modules: { select: { subExams: { select: { id: true, title: true } } } } }, orderBy: { title: 'asc' } }),
  ]);
  const visibleExams = user.role === 'STUDENT' ? exams.filter(exam => examMatchesStudent(exam, user)) : exams;
  return { schools, grades: grades.map(item => item.grade).filter(Boolean).sort(), classrooms,
    courses: [...new Map(visibleExams.filter(exam => exam.course).map(exam => [exam.course!.id, exam.course])).values()],
    exams: visibleExams, subjects: [...new Set(visibleExams.flatMap(exam => {
      try { const values = JSON.parse(exam.subjects || '[]'); return Array.isArray(values) ? values : [values]; }
      catch { return exam.subjects ? [exam.subjects] : []; }
    }).filter(Boolean))].sort() };
}

export async function generateReport(user: any, query: Record<string, any>, db: any = prisma) {
  const filters = reportFilters(user, query);
  let exam: any = null;
  if (filters.examId) {
    exam = await db.exam.findUnique({ where: { id: filters.examId }, include: { schools: { select: { id: true } }, modules: { include: { subExams: true } } } });
    if (!exam || !await canViewExam(user, exam)) throw new ReportError('Exam not accessible', 403);
    if (user.role === 'STUDENT' && !examMatchesStudent(exam, user)) throw new ReportError('Exam not assigned to you', 403);
    if (filters.subExamId && !exam.modules.some((module: any) => module.subExams.some((child: any) => child.id === filters.subExamId))) {
      throw new ReportError('Exam section does not belong to this exam');
    }
  }
  const rows: any[] = await db.examSubmission.findMany({ where: reportSubmissionWhere(user, filters), include: reportInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10001 });
  if (rows.length > 10000) throw new ReportError('Too many attempts. Narrow the dates, school, or exam before generating this report.', 422);
  const childIds = [...new Set(rows.map(row => row.subExamId).filter(Boolean))];
  const children = childIds.length ? await db.subExam.findMany({ where: { id: { in: childIds } }, select: { id: true, title: true, passingScore: true } }) : [];
  const childMap = new Map(children.map((child: any) => [child.id, child]));
  for (const row of rows) row.subExam = childMap.get(row.subExamId);
  const selected = selectAttempts(rows, filters.policy);
  // Fetch answers only for selected attempts, with a separate safety bound; never send answers in the JSON report.
  const answers: any[] = selected.length ? await db.studentAnswer.findMany({ where: { submissionId: { in: selected.map(row => row.id) } }, take: 200001,
    select: { submissionId: true, isCorrect: true, questionSnapshot: true,
      question: { select: { id: true, text: true, type: true, points: true, skill: true, skillEn: true, standard: true, standardEn: true, learningOutcome: true, learningOutcomeEn: true, textEn: true, moduleId: true, subExamId: true } } } }) : [];
  if (answers.length > 200000) throw new ReportError('Too many answers. Narrow the dates or exam before generating this report.', 422);
  const bySubmission = new Map<string, any[]>();
  for (const answer of answers) { const list = bySubmission.get(answer.submissionId) || []; list.push(answer); bySubmission.set(answer.submissionId, list); }
  for (const row of selected) {
    row.answers = bySubmission.get(row.id) || [];
    row.totalQuestions = row.reportSnapshot?.totalQuestions ?? row.answers.length;
    row.correctAnswers = row.reportSnapshot?.correctAnswers ?? row.answers.filter((answer: any) => answer.isCorrect).length;
  }
  const graded = selected.filter(row => typeof row.percentage === 'number');
  const uniqueStudents = new Set(selected.map(row => row.userId)).size;
  const passes = graded.filter(attemptPassed).length;
  const skills = new Map<string, any>(), questions = new Map<string, any>(), schools = new Map<string, any>(), timeline = new Map<string, any>();
  for (const row of selected) {
    const day = egyptDay(row.createdAt);
    const activity = timeline.get(day) || { day, attempts: 0, sum: 0, graded: 0 };
    activity.attempts++;
    if (typeof row.percentage === 'number') { activity.sum += row.percentage; activity.graded++; }
    timeline.set(day, activity);
    const schoolId = row.schoolIdAtSubmission || row.user.schoolId || '__unassigned__';
    const school = schools.get(schoolId) || { id: schoolId, name: row.reportSnapshot?.schoolName || row.user.school?.name || '—', students: new Set(), count: 0, sum: 0, graded: 0, passed: 0 };
    school.students.add(row.userId); school.count++;
    if (typeof row.percentage === 'number') { school.sum += row.percentage; school.graded++; if (attemptPassed(row)) school.passed++; }
    schools.set(schoolId, school);
    for (const answer of row.answers) {
      const q = metadataForDisplay(answer.questionSnapshot, answer.question) || answer.question;
      if (!q) continue;
      const key = `${q.id}:${q.revision || 'legacy'}`;
      const item = questions.get(key) || { id: key, questionId: q.id, text: q.text, textEn: q.textEn, type: q.type, moduleId: q.moduleId, subExamId: q.subExamId, points: q.points, total: 0, correct: 0 };
      item.total++; if (answer.isCorrect) item.correct++;
      questions.set(key, item);
      const field = q.skill || q.skillEn ? "skill" : "learningOutcome";
      const skillKey = q[field + "En"] || q[field];
      if (!skillKey) continue;
      const skill = skills.get(skillKey) || { name: skillKey, nameAr: q[field], nameEn: q[field + "En"], total: 0, correct: 0, students: new Set() };
      skill.total++; skill.students.add(row.userId); if (answer.isCorrect) skill.correct++;
      skills.set(skillKey, skill);
    }
  }
  const studentWhere: any = { role: 'STUDENT', deletedAt: null, status: 'ACTIVE',
    ...(filters.schoolId ? { schoolId: filters.schoolId } : {}), ...(filters.grade ? { grade: filters.grade } : {}),
    ...(filters.classroomId ? { classroomId: filters.classroomId } : {}), ...(user.role === 'STUDENT' ? { id: user.id } : {}),
    ...(user.role === 'TEACHER' ? { classroom: { teacherId: user.id } } : {}),
  };
  // Participation has a denominator only for a particular assigned exam; other views show unique participants.
  let eligibleCount: number | null = null;
  let eligibleParticipants: number | null = null;
  if (exam) {
    const students = await db.user.findMany({ where: studentWhere, select: { id: true, grade: true, schoolId: true } });
    const ids = new Set(students.filter((student: any) => examMatchesStudent(exam, { ...student, role: 'STUDENT' })).map((student: any) => student.id));
    eligibleCount = ids.size;
    eligibleParticipants = new Set(selected.filter(row => ids.has(row.userId)).map(row => row.userId)).size;
  }
  const students = selected.map(row => ({
    id: row.id, userId: row.userId, name: row.user.name, username: row.user.username,
    schoolId: row.schoolIdAtSubmission || row.user.schoolId, schoolName: row.reportSnapshot?.schoolName || row.user.school?.name || '—',
    grade: row.gradeAtSubmission || row.user.grade, examId: row.examId, subExamId: row.subExamId,
    examTitle: row.reportSnapshot?.examTitle || row.subExam?.title || row.exam.title, subject: row.reportSnapshot?.subject || row.exam.subjects,
    score: row.totalScore, percentage: row.percentage, passingScore: passingThreshold(row), passed: typeof row.percentage === 'number' ? attemptPassed(row) : null,
    totalTime: row.totalTime, correctAnswers: row.correctAnswers, totalQuestions: row.totalQuestions,
    createdAt: row.createdAt, historicalSnapshot: Boolean(row.reportSnapshot),
  }));
  const matching = students.filter(row => !filters.search || [row.name, row.username, row.examTitle].some(value => value?.toLowerCase().includes(filters.search.toLowerCase())));
  const skillRows = [...skills.values()].map(skill => ({ name: skill.name, nameAr: skill.nameAr, nameEn: skill.nameEn, answers: skill.total, students: skill.students.size,
    correctRate: ratio(skill.correct, skill.total), sufficientEvidence: skill.total >= 5 }));
  return {
    exam: exam ? { id: exam.id, title: exam.title } : null,
    generatedAt: new Date().toISOString(), timeZone: filters.timeZone,
    filters: { ...filters, start: filters.start.toISOString(), end: filters.end.toISOString() },
    summary: { totalAttempts: rows.length, selectedAttempts: selected.length, uniqueStudents, eligibleCount,
      participationRate: eligibleCount == null ? null : ratio(eligibleParticipants || 0, eligibleCount),
      eligibleParticipants, participationBasis: 'current-assigned-students',
      averageScore: graded.length ? roundMetric(graded.reduce((sum, row) => sum + row.percentage, 0) / graded.length) : null,
      passRate: ratio(passes, graded.length), passed: passes, gradedAttempts: graded.length,
      legacyAttempts: selected.filter(row => !row.reportSnapshot).length,
      averageExamSeconds: selected.some(row => row.totalTime != null) ? Math.round(selected.filter(row => row.totalTime != null).reduce((sum, row) => sum + row.totalTime, 0) / selected.filter(row => row.totalTime != null).length) : null },
    timeline: [...timeline.values()].sort((a, b) => a.day.localeCompare(b.day)).map(item => ({ day: item.day, attempts: item.attempts, averageScore: item.graded ? roundMetric(item.sum / item.graded) : null })),
    skills: skillRows.sort((a, b) => (a.correctRate ?? 0) - (b.correctRate ?? 0)),
    questions: [...questions.values()].map(q => ({ ...q, correctRate: ratio(q.correct, q.total) })).sort((a, b) => (a.correctRate ?? 0) - (b.correctRate ?? 0)),
    modules: (exam?.modules || []).map((module: any) => {
      const entries = [...questions.values()].filter(question => question.moduleId === module.id);
      const totalAnswers = entries.reduce((sum, question) => sum + question.total, 0);
      return { id: module.id, title: module.title, totalAnswers, correctRate: ratio(entries.reduce((sum, question) => sum + question.correct, 0), totalAnswers) };
    }),
    subExams: (exam?.modules || []).flatMap((module: any) => (module.subExams || []).map((child: any) => {
      const entries = [...questions.values()].filter(question => question.subExamId === child.id);
      const totalAnswers = entries.reduce((sum, question) => sum + question.total, 0);
      return { id: child.id, title: child.title, moduleId: module.id, totalAnswers, correctRate: ratio(entries.reduce((sum, question) => sum + question.correct, 0), totalAnswers) };
    })),
    schools: user.role === 'SUPER_ADMIN' ? [...schools.values()].map(school => ({ id: school.id, name: school.name, uniqueStudents: school.students.size, selectedAttempts: school.count,
      averageScore: school.graded ? roundMetric(school.sum / school.graded) : null, passRate: ratio(school.passed, school.graded) })) : [],
    students: matching.slice((filters.page - 1) * filters.limit, filters.page * filters.limit),
    pagination: { page: filters.page, limit: filters.limit, total: matching.length, pages: Math.ceil(matching.length / filters.limit) },
    // Kept in-process for full filtered exports; the router never exposes this internal field as JSON.
    exportRows: matching,
  };
}
