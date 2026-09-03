const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function main() {
  try {
    const raw = JSON.parse(fs.readFileSync('d:/pj/porj/corse/FACTORS_ONLY.json', 'utf8'));
    const lessonData = raw.data.lesson[0];
    const courseData = raw.data.course[0];

    // First ensure the course exists or create it
    const course = await prisma.course.upsert({
      where: { id: courseData.id },
      update: {}, // don't overwrite if it exists
      create: {
        id: courseData.id,
        title: courseData.title,
        grade: courseData.grade,
        isCentral: false,
        schoolId: courseData.schoolId
      }
    });

    console.log('Course verified/created:', course.title);

    // Now insert the lesson directly
    const lesson = await prisma.lesson.upsert({
      where: { id: lessonData.id },
      update: {
        title: lessonData.title,
        courseId: courseData.id,
        questions: lessonData.questions,
        slides: lessonData.slides,
        attachments: lessonData.attachments,
        isCentral: false,
        isVisible: true
      },
      create: {
        id: lessonData.id,
        courseId: courseData.id,
        title: lessonData.title,
        questions: lessonData.questions,
        slides: lessonData.slides,
        attachments: lessonData.attachments,
        isCentral: false,
        isVisible: true
      }
    });

    console.log('✅ SUCCESS! Lesson forced into database:', lesson.title);
  } catch(e) {
    console.error('❌ Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
