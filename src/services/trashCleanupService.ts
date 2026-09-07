import prisma from '../lib/prisma';
import { permanentlyDeleteCourse, permanentlyDeleteLesson } from './trashDeleteHelper';

/**
 * Service to automatically clean up soft-deleted courses and lessons that have been in the trash
 * (The Nile) for more than 15 days. This preserves the database from bloating over time while
 * giving the administration a 15-day window to restore deleted items.
 */
export async function cleanupExpiredTrash() {
  try {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    // Hard delete courses that are IN TRASH (deletedAt is not null) AND older than 15 days
    // 🔒 SAFETY: The `not: null` condition is CRITICAL — it ensures we NEVER touch active courses.
    const expiredCourses = await prisma.course.findMany({
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
      const ok = await permanentlyDeleteCourse(c.id);
      if (ok) deletedCoursesCount++;
    }

    // Hard delete lessons that are IN TRASH (deletedAt is not null) AND older than 15 days
    // 🔒 SAFETY: The `not: null` condition is CRITICAL — it ensures we NEVER touch active lessons.
    const expiredLessons = await prisma.lesson.findMany({
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
      const ok = await permanentlyDeleteLesson(l.id);
      if (ok) deletedLessonsCount++;
    }

    if (deletedCoursesCount > 0 || deletedLessonsCount > 0) {
      console.log(`🗑️ [Trash Cleanup] Permanently deleted ${deletedCoursesCount} courses and ${deletedLessonsCount} lessons from the Nile that were older than 15 days.`);
    }
  } catch (error: any) {
    console.error('❌ [Trash Cleanup] Error cleaning up expired trash:', error.message);
  }
}
