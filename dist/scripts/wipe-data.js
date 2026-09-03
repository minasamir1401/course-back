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
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('⚠️ STARTING DATABASE WIPE (EXCEPT SUPER ADMIN) ⚠️\n');
        try {
            // 1. Delete all progress and submissions
            console.log('🧹 Deleting progress, submissions, and history...');
            yield prisma.studentAnswer.deleteMany();
            yield prisma.examSubmission.deleteMany();
            yield prisma.blockAnswer.deleteMany();
            yield prisma.activityAttempt.deleteMany();
            yield prisma.xPHistory.deleteMany();
            yield prisma.lessonProgress.deleteMany();
            yield prisma.courseProgress.deleteMany();
            yield prisma.activityLog.deleteMany();
            yield prisma.deletedTombstone.deleteMany();
            // 2. Delete all questions and exams
            console.log('🧹 Deleting questions and exams...');
            yield prisma.question.deleteMany();
            yield prisma.exam.deleteMany();
            // 3. Delete all interactive content and lessons
            console.log('🧹 Deleting interactive activities, sections, blocks, and lessons...');
            yield prisma.interactiveActivity.deleteMany();
            yield prisma.skillLesson.deleteMany();
            yield prisma.skillCluster.deleteMany();
            yield prisma.dynamicSection.deleteMany();
            yield prisma.lessonBlock.deleteMany();
            yield prisma.lesson.deleteMany();
            // 4. Delete enrollments and courses
            console.log('🧹 Deleting enrollments, teacher assignments, and courses...');
            yield prisma.studentEnrollment.deleteMany();
            yield prisma.teacherCourse.deleteMany();
            yield prisma.course.deleteMany();
            // 5. Delete classrooms
            console.log('🧹 Deleting classrooms...');
            yield prisma.classroom.deleteMany();
            // 6. Delete all users EXCEPT SUPER_ADMIN
            console.log('🧹 Deleting all dummy users (Keeping SUPER_ADMIN)...');
            const deleteUsersResult = yield prisma.user.deleteMany({
                where: {
                    role: {
                        not: 'SUPER_ADMIN'
                    }
                }
            });
            console.log(`✅ Deleted ${deleteUsersResult.count} users.`);
            console.log('\n✨ DATABASE WIPE COMPLETE! ✨');
            console.log('All dummy data (lessons, courses, exams, users) has been permanently removed.');
            console.log('Only the Super Admin accounts and the main School remain.');
        }
        catch (error) {
            console.error('❌ Error wiping data:', error);
        }
        finally {
            yield prisma.$disconnect();
        }
    });
}
main();
