import { addCalendarDays, egyptDay, egyptDayStart } from './egyptTime';
import { selectAttempts } from './reportMetrics';

export async function examActivitySeries(db: any, now = new Date()) {
  const today = egyptDay(now);
  return Promise.all(Array.from({ length: 7 }, (_, index) => {
    const day = addCalendarDays(today, index - 6), start = egyptDayStart(day), end = egyptDayStart(addCalendarDays(day, 1));
    return Promise.all([
      db.exam.count({ where: { deletedAt: null, createdAt: { gte: start, lt: end } } }),
      db.examSubmission.count({ where: { createdAt: { gte: start, lt: end }, user: { role: 'STUDENT', deletedAt: null } } }),
    ]).then(([exams, submissions]) => ({ date: start.toISOString(), day, exams, submissions }));
  }));
}

export async function schoolPerformanceSeries(db: any, schoolId: string, now = new Date()) {
  const day = egyptDay(now), monthAnchor = new Date(`${day.slice(0, 7)}-15T12:00Z`);
  return Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const anchor = new Date(monthAnchor); anchor.setUTCMonth(anchor.getUTCMonth() - 5 + index);
    const startDay = anchor.toISOString().slice(0, 7) + '-01';
    anchor.setUTCMonth(anchor.getUTCMonth() + 1);
    const nextDay = anchor.toISOString().slice(0, 7) + '-01';
    const start = egyptDayStart(startDay), end = egyptDayStart(nextDay);
    const rows = await db.examSubmission.findMany({ where: { user: { role: 'STUDENT', deletedAt: null }, createdAt: { gte: start, lt: end },
      OR: [{ schoolIdAtSubmission: schoolId }, { schoolIdAtSubmission: null, user: { schoolId } }] },
      select: { id: true, userId: true, examId: true, subExamId: true, createdAt: true, percentage: true } });
    const selected = selectAttempts(rows, 'latest').filter(row => row.percentage != null);
    return { date: start.toISOString(), score: selected.length ? Math.round(selected.reduce((sum, row) => sum + (row.percentage || 0), 0) / selected.length) : null, attempts: rows.length };
  }));
}
