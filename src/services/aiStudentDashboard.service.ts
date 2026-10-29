import { buildStudentCourseWhere, examMatchesStudent } from '../shared';
import { attemptPassed } from '../utils/reportMetrics';

const plain = (value: unknown, limit = 300) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const cairo = (value: Date | string | null | undefined) => value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : null;
const href = (value: unknown) => typeof value === 'string' && /^\/(?:exams|lessons|courses|reports|calendar|notifications|certificates)(?:[/?]|$)/.test(value) && !/[\\\s]/.test(value) ? value : null;

/** The same owner, latest-attempt policy, passing rule and course scope used by
 * the student dashboard. Never forward raw snapshots, answer keys or inbox
 * recipients. Reading context does not mark notifications read. */
export async function studentDashboardContext(user: any, db: any, now = new Date()) {
  const courseWhere = { ...buildStudentCourseWhere(user), deletedAt: null };
  const resultsWhere = { userId: user.id, exam: { deletedAt: null, resultVisibility: { not: 'HIDE_ALL' } } };
  const [totalAttempts, latest, courses, progress, candidates, notifications, unread, assignedLessons] = await Promise.all([
    db.examSubmission.count({ where: resultsWhere }),
    db.examSubmission.findMany({ where: resultsWhere, distinct: ['examId', 'subExamId'], orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, examId: true, subExamId: true, percentage: true, reportSnapshot: true, createdAt: true,
        exam: { select: { title: true, passingScore: true } }, answers: { select: { isCorrect: true } } } }),
    db.course.findMany({ where: courseWhere, orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, subject: true, _count: { select: { lessons: { where: { deletedAt: null } } } } } }),
    db.lessonProgress.findMany({ where: { userId: user.id, lesson: { deletedAt: null, course: courseWhere } }, orderBy: { updatedAt: 'desc' },
      select: { isCompleted: true, activeStudySeconds: true, updatedAt: true,
        lesson: { select: { id: true, title: true, courseId: true, isVisible: true, publishDate: true, cutOffDate: true } } } }),
    db.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', OR: [{ isCentral: true }, { schoolId: user.schoolId || '__none__' }, { schools: { some: { id: user.schoolId || '__none__' } } }] },
      select: { id: true, title: true, type: true, subjects: true, grade: true, grades: true, isCentral: true, schoolId: true,
        schools: { select: { id: true } }, startDate: true, endDate: true, submissions: { where: { userId: user.id }, take: 1, select: { id: true } } } }),
    db.studentNotification.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20,
      select: { kind: true, titleAr: true, titleEn: true, body: true, href: true, createdAt: true, readAt: true } }),
    db.studentNotification.count({ where: { userId: user.id, readAt: null } }),
    db.lesson.findMany({ where: { deletedAt: null, isVisible: true, course: courseWhere },
      select: { id: true, title: true, courseId: true, publishDate: true, cutOffDate: true, assignments: true } }),
  ]);
  const childIds = [...new Set(latest.map((row: any) => row.subExamId).filter(Boolean))];
  const children = childIds.length ? await db.subExam.findMany({ where: { id: { in: childIds } }, select: { id: true, title: true, passingScore: true } }) : [];
  const selected = latest.filter((row: any) => row.percentage != null).map((row: any) => ({ ...row,
    subExam: children.find((child: any) => child.id === row.subExamId), totalQuestions: row.reportSnapshot?.totalQuestions ?? row.answers.length,
    correctAnswers: row.reportSnapshot?.correctAnswers ?? row.answers.filter((answer: any) => answer.isCorrect).length,
  }));
  const completed = new Map<string, number>();
  for (const row of progress) if (row.isCompleted) completed.set(row.lesson.courseId, (completed.get(row.lesson.courseId) || 0) + 1);
  const courseRows = courses.map((course: any) => ({ title: plain(course.title), subject: plain(course.subject), href: `/courses/${course.id}`,
    totalLessons: course._count.lessons, completedLessons: completed.get(course.id) || 0,
    progressPercent: course._count.lessons ? Math.round(100 * (completed.get(course.id) || 0) / course._count.lessons) : 0,
  }));
  const totalLessons = courseRows.reduce((sum: number, course: any) => sum + course.totalLessons, 0);
  const completedLessons = courseRows.reduce((sum: number, course: any) => sum + course.completedLessons, 0);
  const exams = candidates.filter((exam: any) => examMatchesStudent(exam, { ...user, role: 'STUDENT' }));
  const lessonTasks = assignedLessons.flatMap((lesson: any) => {
    let assignments = lesson.assignments;
    try { if (typeof assignments === 'string') assignments = JSON.parse(assignments); } catch { return []; }
    if (!Array.isArray(assignments) || !assignments.length || (lesson.cutOffDate && lesson.cutOffDate < now)) return [];
    // Assignment content may include answers; send the count and schedule only.
    return [{ title: plain(lesson.title), questionCount: assignments.length, startsAt: iso(lesson.publishDate), dueAt: iso(lesson.cutOffDate), dueAtCairo: cairo(lesson.cutOffDate),
      status: lesson.publishDate && lesson.publishDate > now ? 'UPCOMING' : 'AVAILABLE', href: `/lessons/${lesson.id}?courseId=${lesson.courseId}` }];
  }).slice(0, 15);
  return {
    generatedAt: now.toISOString(), timeZone: 'Africa/Cairo',
    metrics: { totalAttempts, selectedAttempts: selected.length, attemptPolicy: 'latest per exam and sub-exam',
      averageScore: selected.length ? Math.round(selected.reduce((sum: number, row: any) => sum + row.percentage, 0) / selected.length) : null,
      passRate: selected.length ? Math.round(100 * selected.filter(attemptPassed).length / selected.length) : null,
      overallCourseProgress: totalLessons ? Math.round(100 * completedLessons / totalLessons) : 0,
      totalLessons, completedLessons, activeStudySeconds: progress.reduce((sum: number, row: any) => sum + (row.activeStudySeconds || 0), 0),
      upcomingExams: exams.filter((exam: any) => exam.startDate && exam.startDate > now).length },
    courses: courseRows.slice(0, 40),
    recentResults: selected.slice(0, 10).map((row: any) => ({ title: plain(row.reportSnapshot?.examTitle || row.subExam?.title || row.exam.title),
      percentage: row.percentage, passed: attemptPassed(row), date: iso(row.createdAt), href: `/reports?examId=${encodeURIComponent(row.examId)}${row.subExamId ? `&subExamId=${encodeURIComponent(row.subExamId)}` : ''}` })),
    tasks: exams.filter((exam: any) => !exam.submissions.length && (!exam.endDate || exam.endDate >= now))
      .sort((a: any, b: any) => (a.endDate?.getTime() || Infinity) - (b.endDate?.getTime() || Infinity)).slice(0, 15)
      .map((exam: any) => ({ title: plain(exam.title), type: exam.type, subject: plain(exam.subjects), startsAt: iso(exam.startDate), dueAt: iso(exam.endDate), dueAtCairo: cairo(exam.endDate),
        status: exam.startDate && exam.startDate > now ? 'UPCOMING' : 'AVAILABLE', href: `/exams/${exam.id}/details` })),
    lastStudied: progress.filter((row: any) => row.lesson.isVisible && (!row.lesson.publishDate || row.lesson.publishDate <= now) && (!row.lesson.cutOffDate || row.lesson.cutOffDate > now))
      .slice(0, 5).map((row: any) => ({ title: plain(row.lesson.title), completed: row.isCompleted, lastActivity: iso(row.updatedAt), href: `/lessons/${row.lesson.id}?courseId=${row.lesson.courseId}` })),
    lessonTasks,
    notifications: { unread, sampleLimit: 20, items: notifications.map((notice: any) => ({ title: plain(notice.titleAr), titleEn: plain(notice.titleEn), body: plain(notice.body, 700),
      kind: plain(notice.kind, 60), unread: !notice.readAt, date: iso(notice.createdAt), href: href(notice.href) })) },
    coverage: { coursesShown: Math.min(courseRows.length, 40), totalCourses: courseRows.length, resultPolicy: 'Latest released attempt per exam/sub-exam across recorded results; matches dashboard aggregation.',
      note: 'Notifications and upcoming tasks are read only; no notice has been marked read and no task has been submitted. Skill evidence below has a separate bounded sample; do not confuse its sample size with all dashboard attempts.' },
  };
}
