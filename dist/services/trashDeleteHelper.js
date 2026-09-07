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
exports.permanentlyDeleteQuestion = permanentlyDeleteQuestion;
exports.permanentlyDeleteLesson = permanentlyDeleteLesson;
exports.permanentlyDeleteExam = permanentlyDeleteExam;
exports.permanentlyDeleteCourse = permanentlyDeleteCourse;
exports.permanentlyDeleteUser = permanentlyDeleteUser;
const prisma_1 = __importDefault(require("../lib/prisma"));
/**
 * Helper functions to permanently delete soft-deleted entities with full relational cleanup.
 * Standard Prisma deleteMany does NOT cascade relations in PostgreSQL, causing foreign key errors.
 */
function permanentlyDeleteQuestion(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // 1. Delete student answers for this question
            yield prisma_1.default.studentAnswer.deleteMany({ where: { questionId: id } }).catch(() => { });
            // 2. Delete XPHistory for this question
            yield prisma_1.default.xPHistory.deleteMany({ where: { questionId: id } }).catch(() => { });
            // 3. Delete Question
            yield prisma_1.default.question.delete({ where: { id } });
            return true;
        }
        catch (error) {
            console.error(`Error permanently deleting question ${id}:`, error);
            return false;
        }
    });
}
function permanentlyDeleteLesson(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // 1. Delete LessonProgress
            yield prisma_1.default.lessonProgress.deleteMany({ where: { lessonId: id } }).catch(() => { });
            // 2. Delete LessonBlocks and sub-tables (DynamicSection, BlockAnswer)
            const blocks = yield prisma_1.default.lessonBlock.findMany({
                where: { lessonId: id },
                select: { id: true },
            });
            const blockIds = blocks.map((b) => b.id);
            if (blockIds.length > 0) {
                yield prisma_1.default.dynamicSection.deleteMany({ where: { blockId: { in: blockIds } } }).catch(() => { });
                yield prisma_1.default.blockAnswer.deleteMany({ where: { blockId: { in: blockIds } } }).catch(() => { });
                yield prisma_1.default.lessonBlock.deleteMany({ where: { id: { in: blockIds } } }).catch(() => { });
            }
            // 3. Delete XPHistory
            yield prisma_1.default.xPHistory.deleteMany({ where: { sourceId: id } }).catch(() => { });
            // 4. Delete Lesson
            yield prisma_1.default.lesson.delete({ where: { id } });
            return true;
        }
        catch (error) {
            console.error(`Error permanently deleting lesson ${id}:`, error);
            return false;
        }
    });
}
function permanentlyDeleteExam(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // 1. Disconnect schools relation
            yield prisma_1.default.exam.update({
                where: { id },
                data: { schools: { set: [] } },
            }).catch(() => { });
            // 2. Submissions and student answers
            yield prisma_1.default.studentAnswer.deleteMany({
                where: { submission: { examId: id } },
            }).catch(() => { });
            yield prisma_1.default.examSubmission.deleteMany({ where: { examId: id } }).catch(() => { });
            // 3. Questions
            const questions = yield prisma_1.default.question.findMany({
                where: { examId: id },
                select: { id: true },
            });
            for (const q of questions) {
                yield permanentlyDeleteQuestion(q.id);
            }
            // 4. SubExams & ExamModules
            yield prisma_1.default.subExam.deleteMany({ where: { module: { examId: id } } }).catch(() => { });
            yield prisma_1.default.examModule.deleteMany({ where: { examId: id } }).catch(() => { });
            // 5. Delete Exam
            yield prisma_1.default.exam.delete({ where: { id } });
            return true;
        }
        catch (error) {
            console.error(`Error permanently deleting exam ${id}:`, error);
            return false;
        }
    });
}
function permanentlyDeleteCourse(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // 1. Disconnect schools relation (Many-to-Many join table _CourseToSchool)
            yield prisma_1.default.course.update({
                where: { id },
                data: { schools: { set: [] } },
            }).catch(() => { });
            // 2. CourseProgress
            yield prisma_1.default.courseProgress.deleteMany({ where: { courseId: id } }).catch(() => { });
            // 3. StudentEnrollment
            yield prisma_1.default.studentEnrollment.deleteMany({ where: { courseId: id } }).catch(() => { });
            // 4. TeacherCourse
            yield prisma_1.default.teacherCourse.deleteMany({ where: { courseId: id } }).catch(() => { });
            // 5. Lessons in course
            const lessons = yield prisma_1.default.lesson.findMany({
                where: { courseId: id },
                select: { id: true },
            });
            for (const l of lessons) {
                yield permanentlyDeleteLesson(l.id);
            }
            // 6. Exams in course
            const exams = yield prisma_1.default.exam.findMany({
                where: { courseId: id },
                select: { id: true },
            });
            for (const e of exams) {
                yield permanentlyDeleteExam(e.id);
            }
            // 7. Delete Course
            yield prisma_1.default.course.delete({ where: { id } });
            return true;
        }
        catch (error) {
            console.error(`Error permanently deleting course ${id}:`, error);
            return false;
        }
    });
}
function permanentlyDeleteUser(id) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // 1. Disconnect classrooms where teacher
            yield prisma_1.default.classroom.updateMany({
                where: { teacherId: id },
                data: { teacherId: null },
            }).catch(() => { });
            // 2. Disconnect children where parent
            yield prisma_1.default.user.updateMany({
                where: { parentId: id },
                data: { parentId: null },
            }).catch(() => { });
            // 3. Disconnect schools if any
            yield prisma_1.default.user.update({
                where: { id },
                data: { school: { disconnect: true } },
            }).catch(() => { });
            // 4. Delete user
            yield prisma_1.default.user.delete({ where: { id } });
            return true;
        }
        catch (error) {
            console.error(`Error permanently deleting user ${id}:`, error);
            return false;
        }
    });
}
