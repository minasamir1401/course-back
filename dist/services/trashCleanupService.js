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
exports.cleanupExpiredTrash = cleanupExpiredTrash;
const prisma_1 = __importDefault(require("../lib/prisma"));
const trashDeleteHelper_1 = require("./trashDeleteHelper");
/**
 * Service to automatically clean up soft-deleted courses and lessons that have been in the trash
 * (The Nile) for more than 15 days. This preserves the database from bloating over time while
 * giving the administration a 15-day window to restore deleted items.
 */
function cleanupExpiredTrash() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const fifteenDaysAgo = new Date();
            fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
            // Hard delete courses that are IN TRASH (deletedAt is not null) AND older than 15 days
            // 🔒 SAFETY: The `not: null` condition is CRITICAL — it ensures we NEVER touch active courses.
            const expiredCourses = yield prisma_1.default.course.findMany({
                where: {
                    deletedAt: {
                        not: null,
                        lte: fifteenDaysAgo,
                    },
                },
                select: { id: true },
            });
            let deletedCoursesCount = 0;
            for (const c of expiredCourses) {
                const ok = yield (0, trashDeleteHelper_1.permanentlyDeleteCourse)(c.id);
                if (ok)
                    deletedCoursesCount++;
            }
            // Hard delete lessons that are IN TRASH (deletedAt is not null) AND older than 15 days
            // 🔒 SAFETY: The `not: null` condition is CRITICAL — it ensures we NEVER touch active lessons.
            const expiredLessons = yield prisma_1.default.lesson.findMany({
                where: {
                    deletedAt: {
                        not: null,
                        lte: fifteenDaysAgo,
                    },
                },
                select: { id: true },
            });
            let deletedLessonsCount = 0;
            for (const l of expiredLessons) {
                const ok = yield (0, trashDeleteHelper_1.permanentlyDeleteLesson)(l.id);
                if (ok)
                    deletedLessonsCount++;
            }
            if (deletedCoursesCount > 0 || deletedLessonsCount > 0) {
                console.log(`🗑️ [Trash Cleanup] Permanently deleted ${deletedCoursesCount} courses and ${deletedLessonsCount} lessons from the Nile that were older than 15 days.`);
            }
        }
        catch (error) {
            console.error('❌ [Trash Cleanup] Error cleaning up expired trash:', error.message);
        }
    });
}
