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
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const readline = __importStar(require("readline"));
const prisma = new client_1.PrismaClient();
function requireConfirmation() {
    return __awaiter(this, void 0, void 0, function* () {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => {
            rl.question('\n🔴 DANGER: This will PERMANENTLY wipe ALL data except SUPER_ADMIN accounts.\n' +
                '   All lessons, courses, exams, users, classrooms will be deleted.\n' +
                '   Type exactly "WIPE_ALL_DATA" to proceed, or anything else to cancel:\n> ', (answer) => {
                rl.close();
                if (answer.trim() !== 'WIPE_ALL_DATA') {
                    console.log('❌ Cancelled. No data was deleted.');
                    process.exit(0);
                }
                resolve();
            });
        });
    });
}
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
requireConfirmation().then(() => main());
