import prisma from '../lib/prisma';
import { addCalendarDays, egyptDay, egyptDayStart } from '../utils/egyptTime';
import { examActivitySeries } from '../utils/dashboardSeries';

export async function platformStats() {
  const now = new Date(), today = egyptDay(now), since = egyptDayStart(addCalendarDays(today, -29));
  const active = { deletedAt: null };
  const [schoolsCount, studentsCount, teachersCount, usersCount, coursesCount, classroomsCount, activeStudents, activeExams, centralExamsCount, recent, allSchools, newSchools, newStudents, examsActivityData] = await Promise.all([
    prisma.school.count(), prisma.user.count({ where: { ...active, role: 'STUDENT' } }), prisma.user.count({ where: { ...active, role: 'TEACHER' } }),
    prisma.user.count({ where: active }), prisma.course.count({ where: { ...active, isCentral: true } }), prisma.classroom.count(),
    prisma.user.count({ where: { ...active, role: 'STUDENT', OR: [ { examSubmissions: { some: { createdAt: { gte: since } } } },
      { lessonProgresses: { some: { updatedAt: { gte: since } } } }, { activityAttempts: { some: { createdAt: { gte: since } } } } ] } }),
    prisma.exam.count({ where: { ...active, status: 'PUBLISHED', AND: [ { OR: [{ startDate: null }, { startDate: { lte: now } }] }, { OR: [{ endDate: null }, { endDate: { gte: now } }] } ] } }),
    prisma.exam.count({ where: { ...active, isCentral: true } }),
    prisma.school.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { _count: { select: { users: { where: { ...active, role: 'STUDENT' } } } } } }),
    prisma.school.findMany({ select: { id: true, name: true, _count: { select: { users: { where: { ...active, role: 'STUDENT' } } } } } }),
    prisma.school.count({ where: { createdAt: { gte: since } } }), prisma.user.count({ where: { ...active, role: 'STUDENT', createdAt: { gte: since } } }),
    examActivitySeries(prisma, now),
  ]);
  return { schoolsCount, studentsCount, teachersCount, usersCount, coursesCount, classroomsCount, activeExams, centralExamsCount,
    activeStudents, interactionRate: studentsCount ? Math.round(activeStudents / studentsCount * 100) : null, newSchools, newStudents,
    recentSchools: recent.map(school => ({ id: school.id, name: school.name, students: school._count.users, status: school.status, createdAt: school.createdAt })),
    schoolPerformanceData: allSchools.map(school => ({ id: school.id, name: school.name, students: school._count.users })).sort((a, b) => b.students - a.students).slice(0, 5),
    examsActivityData, generatedAt: now.toISOString(), timeZone: 'Africa/Cairo', from: addCalendarDays(today, -29), to: today };
}
