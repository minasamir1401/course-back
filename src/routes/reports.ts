import { Router } from 'express';
import prisma from '../lib/prisma';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import { generateReport, reportOptions, ReportError } from '../services/reporting.service';
import { examAttendance } from '../services/attendance.service';
import { csvCell } from '../utils/reportMetrics';
import { REPORT_TIME_ZONE } from '../utils/egyptTime';
import { schoolPerformanceSeries } from '../utils/dashboardSeries';
import { buildStudentCourseWhere, examMatchesStudent } from '../shared';
import * as XLSX from 'xlsx';

const router = Router();
const reportRoles = checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT']);
const adminRoles = checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']);
const fail = (res: any, error: any) => {
  if (!(error instanceof ReportError)) console.error('Report generation failed:', error);
  return res.status(error instanceof ReportError ? error.status : error.message?.match(/date|time|range|policy/i) ? 400 : 500)
    .json({ error: error instanceof ReportError || error.message?.match(/date|time|range|policy/i) ? error.message : 'Could not generate report' });
};

router.get('/api/reports/options', verifyToken, reportRoles, async (req: any, res: any) => {
  try { res.json(await reportOptions(req.user)); } catch (error) { fail(res, error); }
});
router.get('/api/reports/overview', verifyToken, reportRoles, async (req: any, res: any) => {
  try {
    const { exportRows, ...report } = await generateReport(req.user, req.query);
    res.setHeader('Cache-Control', 'private, no-store'); res.json(report);
  } catch (error) { fail(res, error); }
});
router.get('/api/reports/exam-attendance', verifyToken, adminRoles, async (req: any, res: any) => {
  try { const { exportRows, ...report } = await examAttendance(req.user, req.query); res.json(report); }
  catch (error) { fail(res, error); }
});
router.get('/api/reports/export', verifyToken, reportRoles, async (req: any, res: any) => {
  try {
    const attendance = req.query.kind === 'attendance';
    if (attendance && req.user.role === 'STUDENT') return res.status(403).json({ error: 'Access denied' });
    const report = attendance ? await examAttendance(req.user, req.query) : await generateReport(req.user, req.query);
    const columns = attendance ? ['name', 'username', 'grade', 'status', 'score', 'percentage', 'passed', 'submittedAt']
      : ['name', 'username', 'schoolName', 'grade', 'examTitle', 'score', 'percentage', 'passed', 'totalTime', 'createdAt', 'historicalSnapshot'];
    const ar = req.query.language === 'ar';
    const labels: Record<string, string> = { name: 'الاسم', username: 'اسم المستخدم', schoolName: 'المدرسة', grade: 'الصف', examTitle: 'الاختبار', score: 'الدرجة', percentage: 'النسبة المئوية', passed: 'اجتاز', totalTime: 'الوقت بالثواني', createdAt: 'تاريخ التسليم — مصر', historicalSnapshot: 'نسخة محفوظة وقت التسليم', status: 'الحالة', submittedAt: 'تاريخ التسليم — مصر' };
    const heading = (column: string) => ar ? labels[column] || column : column;
    if (req.query.format === 'xlsx') {
      const book = XLSX.utils.book_new();
      const data = report.exportRows.map((row: any) => Object.fromEntries(columns.map(column => [heading(column),
        column.endsWith('At') && row[column] ? new Date(row[column]).toLocaleString('en-GB', { timeZone: REPORT_TIME_ZONE, hour12: false }) : row[column] ?? null])));
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data, { header: columns.map(heading) }), 'Results');
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([
        { item: 'Time zone', value: REPORT_TIME_ZONE }, { item: 'Generated at', value: report.generatedAt },
        { item: 'Scope', value: attendance ? (ar ? 'كل محاولات الاختبار أو القسم المحدد؛ الطلاب المسندون حاليًا' : 'All attempts of selected exam / section; current assigned students') : (ar ? 'المحاولات المعتمدة خلال الفترة المحددة بتوقيت مصر' : 'Selected attempts within inclusive Egyptian calendar dates') },
        ...Object.entries((report as any).filters || {}).filter(([key]) => !['page', 'limit', 'start', 'end'].includes(key)).map(([item, value]) => ({ item, value: String(value) })),
      ].map(row => ar ? { 'البيان': ({ 'Time zone': 'المنطقة الزمنية', 'Generated at': 'وقت الإنشاء', Scope: 'نطاق التقرير', from: 'من تاريخ', to: 'إلى تاريخ', schoolId: 'معرف المدرسة', grade: 'الصف', classroomId: 'معرف الفصل', courseId: 'معرف المقرر', examId: 'معرف الاختبار', subExamId: 'معرف الاختبار الفرعي', subject: 'المادة', attemptPolicy: 'سياسة المحاولات', search: 'البحث', timeZone: 'المنطقة الزمنية' } as any)[row.item] || row.item, 'القيمة': row.item === 'attemptPolicy' ? ({ latest: 'أحدث محاولة', first: 'أول محاولة', best: 'أفضل محاولة', all: 'كل المحاولات' } as any)[String(row.value)] || row.value : row.value } : row)), ar ? 'سياق التقرير' : 'Report context');
      if (!attendance) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(((report as any).skills || []).map((skill: any) => ({ [ar ? 'المهارة بالعربية' : 'Skill (Ar)']: skill.nameAr || skill.name, [ar ? 'المهارة بالإنجليزية' : 'Skill (En)']: skill.nameEn || skill.name, [ar ? 'عدد الإجابات' : 'Answers']: skill.answers, [ar ? 'نسبة الصحيح' : 'Correct rate']: skill.correctRate }))), ar ? 'المهارات' : 'Skills');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="klevro-report.xlsx"');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    }
    const rows = report.exportRows.map((row: any) => columns.map(column => {
      const value = row[column];
      return csvCell(value instanceof Date || column.endsWith('At') && value ? new Date(value).toLocaleString('en-GB', { timeZone: REPORT_TIME_ZONE, hour12: false }) : value);
    }).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="klevro-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send('\uFEFF' + columns.map(heading).map(csvCell).join(',') + '\r\n' + rows.join('\r\n'));
  } catch (error) { fail(res, error); }
});
router.get('/api/reports/school', verifyToken, adminRoles, checkSchoolAccess, async (req: any, res: any) => {
  try {
    const schoolId = req.user.role === 'SUPER_ADMIN' ? String(req.query.schoolId || '') : req.user.schoolId;
    if (!schoolId) throw new ReportError('schoolId is required');
    const [report, studentsCount, teachersCount, classesCount, performanceData, upcomingExams] = await Promise.all([
      generateReport(req.user, { ...req.query, schoolId }),
      prisma.user.count({ where: { schoolId, role: 'STUDENT', deletedAt: null } }),
      prisma.user.count({ where: { schoolId, role: 'TEACHER', deletedAt: null } }),
      prisma.classroom.count({ where: { schoolId } }), schoolPerformanceSeries(prisma, schoolId),
      prisma.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', startDate: { gt: new Date() },
        OR: [{ isCentral: true, schoolId: null, schools: { none: {} } }, { schoolId }, { schools: { some: { id: schoolId } } }] },
        select: { id: true, title: true, startDate: true }, orderBy: { startDate: 'asc' }, take: 5 }),
    ]);
    res.json({ schoolId, studentsCount, teachersCount, classesCount, averageScore: report.summary.averageScore,
      passRate: report.summary.passRate, uniqueStudents: report.summary.uniqueStudents, totalExamsTaken: report.summary.totalAttempts,
      performanceData, upcomingExams, generatedAt: report.generatedAt, filters: report.filters, timeZone: REPORT_TIME_ZONE });
  } catch (error) { fail(res, error); }
});
router.get('/api/student/dashboard-stats', verifyToken, checkRole(['STUDENT']), async (req: any, res: any) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { school: { select: { name: true } } } });
    if (!user) return res.status(404).json({ error: 'Student not found' });
    const courseWhere = { ...buildStudentCourseWhere(user), deletedAt: null };
    const [courses, lessons, completed, attempts, upcoming] = await Promise.all([
      prisma.course.count({ where: courseWhere }), prisma.lesson.count({ where: { deletedAt: null, course: courseWhere } }),
      prisma.lessonProgress.count({ where: { userId: user.id, isCompleted: true, lesson: { deletedAt: null, course: courseWhere } } }),
      prisma.examSubmission.count({ where: { userId: user.id } }),
      prisma.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', startDate: { gt: new Date() } }, include: { schools: { select: { id: true } } } }),
    ]);
    res.json({ name: user.name, schoolName: user.school?.name, coursesCount: courses, examsTaken: attempts,
      upcomingExams: upcoming.filter(exam => examMatchesStudent(exam, user)).length, overallProgress: lessons ? Math.round(completed / lessons * 100) : null,
      generatedAt: new Date().toISOString(), timeZone: REPORT_TIME_ZONE });
  } catch (error) { fail(res, error); }
});
export default router;
