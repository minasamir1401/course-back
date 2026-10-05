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
function examActivitySeries(db_1) {
    return __awaiter(this, arguments, void 0, function* (db, now = new Date()) {
        return Promise.all(Array.from({ length: 7 }, (_, i) => {
            const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6 + i)), end = new Date(start.getTime() + 86400000);
            return Promise.all([
                db.exam.count({ where: { deletedAt: null, createdAt: { gte: start, lt: end } } }),
                db.examSubmission.count({ where: { createdAt: { gte: start, lt: end } } })
            ]).then(([exams, submissions]) => ({ date: start.toISOString(), exams, submissions }));
        }));
    });
}
function schoolPerformanceSeries(db_1, schoolId_1) {
    return __awaiter(this, arguments, void 0, function* (db, schoolId, now = new Date()) {
        return Promise.all(Array.from({ length: 6 }, (_, i) => {
            const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)), end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
            return db.examSubmission.aggregate({ where: { user: { schoolId, deletedAt: null }, createdAt: { gte: start, lt: end } }, _avg: { percentage: true }, _count: { id: true } })
                .then((result) => ({ date: start.toISOString(), score: result._avg.percentage == null ? null : Math.round(result._avg.percentage), attempts: result._count.id }));
        }));
    });
}
