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
Object.defineProperty(exports, "__esModule", { value: true });
exports.examActivitySeries = examActivitySeries;
exports.schoolPerformanceSeries = schoolPerformanceSeries;
const egyptTime_1 = require("./egyptTime");
const reportMetrics_1 = require("./reportMetrics");
function examActivitySeries(db_1) {
    return __awaiter(this, arguments, void 0, function* (db, now = new Date()) {
        const today = (0, egyptTime_1.egyptDay)(now);
        return Promise.all(Array.from({ length: 7 }, (_, index) => {
            const day = (0, egyptTime_1.addCalendarDays)(today, index - 6), start = (0, egyptTime_1.egyptDayStart)(day), end = (0, egyptTime_1.egyptDayStart)((0, egyptTime_1.addCalendarDays)(day, 1));
            return Promise.all([
                db.exam.count({ where: { deletedAt: null, createdAt: { gte: start, lt: end } } }),
                db.examSubmission.count({ where: { createdAt: { gte: start, lt: end }, user: { role: 'STUDENT', deletedAt: null } } }),
            ]).then(([exams, submissions]) => ({ date: start.toISOString(), day, exams, submissions }));
        }));
    });
}
function schoolPerformanceSeries(db_1, schoolId_1) {
    return __awaiter(this, arguments, void 0, function* (db, schoolId, now = new Date()) {
        const day = (0, egyptTime_1.egyptDay)(now), monthAnchor = new Date(`${day.slice(0, 7)}-15T12:00Z`);
        return Promise.all(Array.from({ length: 6 }, (_, index) => __awaiter(this, void 0, void 0, function* () {
            const anchor = new Date(monthAnchor);
            anchor.setUTCMonth(anchor.getUTCMonth() - 5 + index);
            const startDay = anchor.toISOString().slice(0, 7) + '-01';
            anchor.setUTCMonth(anchor.getUTCMonth() + 1);
            const nextDay = anchor.toISOString().slice(0, 7) + '-01';
            const start = (0, egyptTime_1.egyptDayStart)(startDay), end = (0, egyptTime_1.egyptDayStart)(nextDay);
            const rows = yield db.examSubmission.findMany({ where: { user: { role: 'STUDENT', deletedAt: null }, createdAt: { gte: start, lt: end },
                    OR: [{ schoolIdAtSubmission: schoolId }, { schoolIdAtSubmission: null, user: { schoolId } }] },
                select: { id: true, userId: true, examId: true, subExamId: true, createdAt: true, percentage: true } });
            const selected = (0, reportMetrics_1.selectAttempts)(rows, 'latest').filter(row => row.percentage != null);
            return { date: start.toISOString(), score: selected.length ? Math.round(selected.reduce((sum, row) => sum + (row.percentage || 0), 0) / selected.length) : null, attempts: rows.length };
        })));
    });
}
