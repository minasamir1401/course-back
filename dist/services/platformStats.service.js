"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformStats = platformStats;
const prisma_1 = __importDefault(require("../lib/prisma"));
const egyptTime_1 = require("../utils/egyptTime");
const dashboardSeries_1 = require("../utils/dashboardSeries");
function platformStats() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date(), today = (0, egyptTime_1.egyptDay)(now), since = (0, egyptTime_1.egyptDayStart)((0, egyptTime_1.addCalendarDays)(today, -29));
        const active = { deletedAt: null };
        const [schoolsCount, studentsCount, teachersCount, usersCount, coursesCount, classroomsCount, activeStudents, activeExams, centralExamsCount, recent, allSchools, newSchools, newStudents, examsActivityData] = yield Promise.all([
            prisma_1.default.school.count(), prisma_1.default.user.count({ where: Object.assign(Object.assign({}, active), { role: 'STUDENT' }) }), prisma_1.default.user.count({ where: Object.assign(Object.assign({}, active), { role: 'TEACHER' }) }),
            prisma_1.default.user.count({ where: active }), prisma_1.default.course.count({ where: Object.assign(Object.assign({}, active), { isCentral: true }) }), prisma_1.default.classroom.count(),
            prisma_1.default.user.count({ where: Object.assign(Object.assign({}, active), { role: 'STUDENT', OR: [{ examSubmissions: { some: { createdAt: { gte: since } } } },
                        { lessonProgresses: { some: { updatedAt: { gte: since } } } }, { activityAttempts: { some: { createdAt: { gte: since } } } }] }) }),
            prisma_1.default.exam.count({ where: Object.assign(Object.assign({}, active), { status: 'PUBLISHED', AND: [{ OR: [{ startDate: null }, { startDate: { lte: now } }] }, { OR: [{ endDate: null }, { endDate: { gte: now } }] }] }) }),
            prisma_1.default.exam.count({ where: Object.assign(Object.assign({}, active), { isCentral: true }) }),
            prisma_1.default.school.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { _count: { select: { users: { where: Object.assign(Object.assign({}, active), { role: 'STUDENT' }) } } } } }),
            prisma_1.default.school.findMany({ select: { id: true, name: true, _count: { select: { users: { where: Object.assign(Object.assign({}, active), { role: 'STUDENT' }) } } } } }),
            prisma_1.default.school.count({ where: { createdAt: { gte: since } } }), prisma_1.default.user.count({ where: Object.assign(Object.assign({}, active), { role: 'STUDENT', createdAt: { gte: since } }) }),
            (0, dashboardSeries_1.examActivitySeries)(prisma_1.default, now),
        ]);
        return { schoolsCount, studentsCount, teachersCount, usersCount, coursesCount, classroomsCount, activeExams, centralExamsCount,
            activeStudents, interactionRate: studentsCount ? Math.round(activeStudents / studentsCount * 100) : null, newSchools, newStudents,
            recentSchools: recent.map(school => ({ id: school.id, name: school.name, students: school._count.users, status: school.status, createdAt: school.createdAt })),
            schoolPerformanceData: allSchools.map(school => ({ id: school.id, name: school.name, students: school._count.users })).sort((a, b) => b.students - a.students).slice(0, 5),
            examsActivityData, generatedAt: now.toISOString(), timeZone: 'Africa/Cairo', from: (0, egyptTime_1.addCalendarDays)(today, -29), to: today };
    });
}
