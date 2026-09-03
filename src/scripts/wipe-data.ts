import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

async function requireConfirmation(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      '\n🔴 DANGER: This will PERMANENTLY wipe ALL data except SUPER_ADMIN accounts.\n' +
      '   All lessons, courses, exams, users, classrooms will be deleted.\n' +
      '   Type exactly "WIPE_ALL_DATA" to proceed, or anything else to cancel:\n> ',
      (answer) => {
        rl.close();
        if (answer.trim() !== 'WIPE_ALL_DATA') {
          console.log('❌ Cancelled. No data was deleted.');
          process.exit(0);
        }
        resolve();
      }
    );
  });
}

async function main() {
  console.log('⚠️ STARTING DATABASE WIPE (EXCEPT SUPER ADMIN) ⚠️\n');

  try {
    // 1. Delete all progress and submissions
    console.log('🧹 Deleting progress, submissions, and history...');
    await prisma.studentAnswer.deleteMany();
    await prisma.examSubmission.deleteMany();
    await prisma.blockAnswer.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.xPHistory.deleteMany();
    await prisma.lessonProgress.deleteMany();
    await prisma.courseProgress.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.deletedTombstone.deleteMany();

    // 2. Delete all questions and exams
    console.log('🧹 Deleting questions and exams...');
    await prisma.question.deleteMany();
    await prisma.exam.deleteMany();

    // 3. Delete all interactive content and lessons
    console.log('🧹 Deleting interactive activities, sections, blocks, and lessons...');
    await prisma.interactiveActivity.deleteMany();
    await prisma.skillLesson.deleteMany();
    await prisma.skillCluster.deleteMany();
    await prisma.dynamicSection.deleteMany();
    await prisma.lessonBlock.deleteMany();
    await prisma.lesson.deleteMany();

    // 4. Delete enrollments and courses
    console.log('🧹 Deleting enrollments, teacher assignments, and courses...');
    await prisma.studentEnrollment.deleteMany();
    await prisma.teacherCourse.deleteMany();
    await prisma.course.deleteMany();

    // 5. Delete classrooms
    console.log('🧹 Deleting classrooms...');
    await prisma.classroom.deleteMany();

    // 6. Delete all users EXCEPT SUPER_ADMIN
    console.log('🧹 Deleting all dummy users (Keeping SUPER_ADMIN)...');
    const deleteUsersResult = await prisma.user.deleteMany({
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
  } catch (error) {
    console.error('❌ Error wiping data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

requireConfirmation().then(() => main());
