import prisma from '../lib/prisma';

/**
 * Helper functions to permanently delete soft-deleted entities with full relational cleanup.
 * Standard Prisma deleteMany does NOT cascade relations in PostgreSQL, causing foreign key errors.
 */

export async function permanentlyDeleteQuestion(id: string): Promise<boolean> {
  try {
    // 1. Delete student answers for this question
    await prisma.studentAnswer.deleteMany({ where: { questionId: id } }).catch(() => {});
    // 2. Delete XPHistory for this question
    await prisma.xPHistory.deleteMany({ where: { questionId: id } }).catch(() => {});
    // 3. Delete Question
    await prisma.question.delete({ where: { id } });
    return true;
  } catch (error) {
    console.error(`Error permanently deleting question ${id}:`, error);
    return false;
  }
}

export async function permanentlyDeleteLesson(id: string): Promise<boolean> {
  try {
    // 1. Delete LessonProgress
    await prisma.lessonProgress.deleteMany({ where: { lessonId: id } }).catch(() => {});

    // 2. Delete LessonBlocks and sub-tables (DynamicSection, BlockAnswer)
    const blocks = await prisma.lessonBlock.findMany({
      where: { lessonId: id },
      select: { id: true },
    });
    const blockIds = blocks.map((b) => b.id);
    if (blockIds.length > 0) {
      await prisma.dynamicSection.deleteMany({ where: { blockId: { in: blockIds } } }).catch(() => {});
      await prisma.blockAnswer.deleteMany({ where: { blockId: { in: blockIds } } }).catch(() => {});
      await prisma.lessonBlock.deleteMany({ where: { id: { in: blockIds } } }).catch(() => {});
    }

    // 3. Delete XPHistory
    await prisma.xPHistory.deleteMany({ where: { sourceId: id } }).catch(() => {});

    // 4. Delete Lesson
    await prisma.lesson.delete({ where: { id } });
    return true;
  } catch (error) {
    console.error(`Error permanently deleting lesson ${id}:`, error);
    return false;
  }
}

export async function permanentlyDeleteExam(id: string): Promise<boolean> {
  try {
    // 1. Disconnect schools relation
    await prisma.exam.update({
      where: { id },
      data: { schools: { set: [] } },
    }).catch(() => {});

    // 2. Submissions and student answers
    await prisma.studentAnswer.deleteMany({
      where: { submission: { examId: id } },
    }).catch(() => {});
    await prisma.examSubmission.deleteMany({ where: { examId: id } }).catch(() => {});

    // 3. Questions
    const questions = await prisma.question.findMany({
      where: { examId: id },
      select: { id: true },
    });
    for (const q of questions) {
      await permanentlyDeleteQuestion(q.id);
    }

    // 4. SubExams & ExamModules
    await prisma.subExam.deleteMany({ where: { module: { examId: id } } }).catch(() => {});
    await prisma.examModule.deleteMany({ where: { examId: id } }).catch(() => {});

    // 5. Delete Exam
    await prisma.exam.delete({ where: { id } });
    return true;
  } catch (error) {
    console.error(`Error permanently deleting exam ${id}:`, error);
    return false;
  }
}

export async function permanentlyDeleteCourse(id: string): Promise<boolean> {
  try {
    // 1. Disconnect schools relation (Many-to-Many join table _CourseToSchool)
    await prisma.course.update({
      where: { id },
      data: { schools: { set: [] } },
    }).catch(() => {});

    // 2. CourseProgress
    await prisma.courseProgress.deleteMany({ where: { courseId: id } }).catch(() => {});

    // 3. StudentEnrollment
    await prisma.studentEnrollment.deleteMany({ where: { courseId: id } }).catch(() => {});

    // 4. TeacherCourse
    await prisma.teacherCourse.deleteMany({ where: { courseId: id } }).catch(() => {});

    // 5. Lessons in course
    const lessons = await prisma.lesson.findMany({
      where: { courseId: id },
      select: { id: true },
    });
    for (const l of lessons) {
      await permanentlyDeleteLesson(l.id);
    }

    // 6. Exams in course
    const exams = await prisma.exam.findMany({
      where: { courseId: id },
      select: { id: true },
    });
    for (const e of exams) {
      await permanentlyDeleteExam(e.id);
    }

    // 7. Delete Course
    await prisma.course.delete({ where: { id } });
    return true;
  } catch (error) {
    console.error(`Error permanently deleting course ${id}:`, error);
    return false;
  }
}

export async function permanentlyDeleteUser(id: string): Promise<boolean> {
  try {
    // 1. Disconnect classrooms where teacher
    await prisma.classroom.updateMany({
      where: { teacherId: id },
      data: { teacherId: null },
    }).catch(() => {});

    // 2. Disconnect children where parent
    await prisma.user.updateMany({
      where: { parentId: id },
      data: { parentId: null },
    }).catch(() => {});

    // 3. Disconnect schools if any
    await prisma.user.update({
      where: { id },
      data: { school: { disconnect: true } },
    }).catch(() => {});

    // 4. Delete user
    await prisma.user.delete({ where: { id } });
    return true;
  } catch (error) {
    console.error(`Error permanently deleting user ${id}:`, error);
    return false;
  }
}
