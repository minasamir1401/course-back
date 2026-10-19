"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const reporting_service_1 = require("../services/reporting.service");
const attendance_service_1 = require("../services/attendance.service");
const reportMetrics_1 = require("../utils/reportMetrics");
const egyptTime_1 = require("../utils/egyptTime");
const dashboardSeries_1 = require("../utils/dashboardSeries");
const shared_1 = require("../shared");
const XLSX = __importStar(require("xlsx"));
const router = (0, express_1.Router)();
const reportRoles = (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT']);
const adminRoles = (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']);
const fail = (res, error) => {
    var _a, _b;
    if (!(error instanceof reporting_service_1.ReportError))
        console.error('Report generation failed:', error);
    return res.status(error instanceof reporting_service_1.ReportError ? error.status : ((_a = error.message) === null || _a === void 0 ? void 0 : _a.match(/date|time|range|policy/i)) ? 400 : 500)
        .json({ error: error instanceof reporting_service_1.ReportError || ((_b = error.message) === null || _b === void 0 ? void 0 : _b.match(/date|time|range|policy/i)) ? error.message : 'Could not generate report' });
};
router.get('/api/reports/options', auth_1.verifyToken, reportRoles, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        res.json(yield (0, reporting_service_1.reportOptions)(req.user));
    }
    catch (error) {
        fail(res, error);
    }
}));
router.get('/api/reports/overview', auth_1.verifyToken, reportRoles, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const _a = yield (0, reporting_service_1.generateReport)(req.user, req.query), { exportRows } = _a, report = __rest(_a, ["exportRows"]);
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(report);
    }
    catch (error) {
        fail(res, error);
    }
}));
router.get('/api/reports/exam-attendance', auth_1.verifyToken, adminRoles, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const _a = yield (0, attendance_service_1.examAttendance)(req.user, req.query), { exportRows } = _a, report = __rest(_a, ["exportRows"]);
        res.json(report);
    }
    catch (error) {
        fail(res, error);
    }
}));
router.get('/api/reports/export', auth_1.verifyToken, reportRoles, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const attendance = req.query.kind === 'attendance';
        if (attendance && req.user.role === 'STUDENT')
            return res.status(403).json({ error: 'Access denied' });
        const report = attendance ? yield (0, attendance_service_1.examAttendance)(req.user, req.query) : yield (0, reporting_service_1.generateReport)(req.user, req.query);
        const columns = attendance ? ['name', 'username', 'grade', 'status', 'score', 'percentage', 'passed', 'submittedAt']
            : ['name', 'username', 'schoolName', 'grade', 'examTitle', 'score', 'percentage', 'passed', 'totalTime', 'createdAt', 'historicalSnapshot'];
        const ar = req.query.language === 'ar';
        const labels = { name: 'الاسم', username: 'اسم المستخدم', schoolName: 'المدرسة', grade: 'الصف', examTitle: 'الاختبار', score: 'الدرجة', percentage: 'النسبة المئوية', passed: 'اجتاز', totalTime: 'الوقت بالثواني', createdAt: 'تاريخ التسليم — مصر', historicalSnapshot: 'نسخة محفوظة وقت التسليم', status: 'الحالة', submittedAt: 'تاريخ التسليم — مصر' };
        const heading = (column) => ar ? labels[column] || column : column;
        if (req.query.format === 'xlsx') {
            const book = XLSX.utils.book_new();
            const data = report.exportRows.map((row) => Object.fromEntries(columns.map(column => {
                var _a;
                return [heading(column),
                    column.endsWith('At') && row[column] ? new Date(row[column]).toLocaleString('en-GB', { timeZone: egyptTime_1.REPORT_TIME_ZONE, hour12: false }) : (_a = row[column]) !== null && _a !== void 0 ? _a : null];
            })));
            XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data, { header: columns.map(heading) }), 'Results');
            XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([
                { item: 'Time zone', value: egyptTime_1.REPORT_TIME_ZONE }, { item: 'Generated at', value: report.generatedAt },
                { item: 'Scope', value: attendance ? (ar ? 'كل محاولات الاختبار أو القسم المحدد؛ الطلاب المسندون حاليًا' : 'All attempts of selected exam / section; current assigned students') : (ar ? 'المحاولات المعتمدة خلال الفترة المحددة بتوقيت مصر' : 'Selected attempts within inclusive Egyptian calendar dates') },
                ...Object.entries(report.filters || {}).filter(([key]) => !['page', 'limit', 'start', 'end'].includes(key)).map(([item, value]) => ({ item, value: String(value) })),
            ].map(row => ar ? { 'البيان': { 'Time zone': 'المنطقة الزمنية', 'Generated at': 'وقت الإنشاء', Scope: 'نطاق التقرير', from: 'من تاريخ', to: 'إلى تاريخ', schoolId: 'معرف المدرسة', grade: 'الصف', classroomId: 'معرف الفصل', courseId: 'معرف المقرر', examId: 'معرف الاختبار', subExamId: 'معرف الاختبار الفرعي', subject: 'المادة', attemptPolicy: 'سياسة المحاولات', search: 'البحث', timeZone: 'المنطقة الزمنية' }[row.item] || row.item, 'القيمة': row.item === 'attemptPolicy' ? { latest: 'أحدث محاولة', first: 'أول محاولة', best: 'أفضل محاولة', all: 'كل المحاولات' }[String(row.value)] || row.value : row.value } : row)), ar ? 'سياق التقرير' : 'Report context');
            if (!attendance)
                XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet((report.skills || []).map((skill) => ({ [ar ? 'المهارة بالعربية' : 'Skill (Ar)']: skill.nameAr || skill.name, [ar ? 'المهارة بالإنجليزية' : 'Skill (En)']: skill.nameEn || skill.name, [ar ? 'عدد الإجابات' : 'Answers']: skill.answers, [ar ? 'نسبة الصحيح' : 'Correct rate']: skill.correctRate }))), ar ? 'المهارات' : 'Skills');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="klevro-report.xlsx"');
            res.setHeader('Cache-Control', 'private, no-store');
            return res.send(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
        }
        const rows = report.exportRows.map((row) => columns.map(column => {
            const value = row[column];
            return (0, reportMetrics_1.csvCell)(value instanceof Date || column.endsWith('At') && value ? new Date(value).toLocaleString('en-GB', { timeZone: egyptTime_1.REPORT_TIME_ZONE, hour12: false }) : value);
        }).join(','));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="klevro-report-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.send('\uFEFF' + columns.map(heading).map(reportMetrics_1.csvCell).join(',') + '\r\n' + rows.join('\r\n'));
    }
    catch (error) {
        fail(res, error);
    }
}));
router.get('/api/reports/school', auth_1.verifyToken, adminRoles, auth_1.checkSchoolAccess, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const schoolId = req.user.role === 'SUPER_ADMIN' ? String(req.query.schoolId || '') : req.user.schoolId;
        if (!schoolId)
            throw new reporting_service_1.ReportError('schoolId is required');
        const [report, studentsCount, teachersCount, classesCount, performanceData, upcomingExams] = yield Promise.all([
            (0, reporting_service_1.generateReport)(req.user, Object.assign(Object.assign({}, req.query), { schoolId })),
            prisma_1.default.user.count({ where: { schoolId, role: 'STUDENT', deletedAt: null } }),
            prisma_1.default.user.count({ where: { schoolId, role: 'TEACHER', deletedAt: null } }),
            prisma_1.default.classroom.count({ where: { schoolId } }), (0, dashboardSeries_1.schoolPerformanceSeries)(prisma_1.default, schoolId),
            prisma_1.default.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', startDate: { gt: new Date() },
                    OR: [{ isCentral: true, schoolId: null, schools: { none: {} } }, { schoolId }, { schools: { some: { id: schoolId } } }] },
                select: { id: true, title: true, startDate: true }, orderBy: { startDate: 'asc' }, take: 5 }),
        ]);
        res.json({ schoolId, studentsCount, teachersCount, classesCount, averageScore: report.summary.averageScore,
            passRate: report.summary.passRate, uniqueStudents: report.summary.uniqueStudents, totalExamsTaken: report.summary.totalAttempts,
            performanceData, upcomingExams, generatedAt: report.generatedAt, filters: report.filters, timeZone: egyptTime_1.REPORT_TIME_ZONE });
    }
    catch (error) {
        fail(res, error);
    }
}));
router.get('/api/student/dashboard-stats', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const user = yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, include: { school: { select: { name: true } } } });
        if (!user)
            return res.status(404).json({ error: 'Student not found' });
        const courseWhere = Object.assign(Object.assign({}, (0, shared_1.buildStudentCourseWhere)(user)), { deletedAt: null });
        const [courses, lessons, completed, attempts, upcoming] = yield Promise.all([
            prisma_1.default.course.count({ where: courseWhere }), prisma_1.default.lesson.count({ where: { deletedAt: null, course: courseWhere } }),
            prisma_1.default.lessonProgress.count({ where: { userId: user.id, isCompleted: true, lesson: { deletedAt: null, course: courseWhere } } }),
            prisma_1.default.examSubmission.count({ where: { userId: user.id } }),
            prisma_1.default.exam.findMany({ where: { deletedAt: null, status: 'PUBLISHED', startDate: { gt: new Date() } }, include: { schools: { select: { id: true } } } }),
        ]);
        res.json({ name: user.name, schoolName: (_a = user.school) === null || _a === void 0 ? void 0 : _a.name, coursesCount: courses, examsTaken: attempts,
            upcomingExams: upcoming.filter(exam => (0, shared_1.examMatchesStudent)(exam, user)).length, overallProgress: lessons ? Math.round(completed / lessons * 100) : null,
            generatedAt: new Date().toISOString(), timeZone: egyptTime_1.REPORT_TIME_ZONE });
    }
    catch (error) {
        fail(res, error);
    }
}));
exports.default = router;
