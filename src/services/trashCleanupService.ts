import prisma from '../lib/prisma';

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
    const deletedCourses = await prisma.course.deleteMany({
      where: {
        deletedAt: {
          not: null,
          lte: fifteenDaysAgo
        }
      }
    });

    // Hard delete lessons that are IN TRASH (deletedAt is not null) AND older than 15 days
    // 🔒 SAFETY: The `not: null` condition is CRITICAL — it ensures we NEVER touch active lessons.
    const deletedLessons = await prisma.lesson.deleteMany({
      where: {
        deletedAt: {
          not: null,
          lte: fifteenDaysAgo
        }
      }
    });

    if (deletedCourses.count > 0 || deletedLessons.count > 0) {
      console.log(`🗑️ [Trash Cleanup] Permanently deleted ${deletedCourses.count} courses and ${deletedLessons.count} lessons from the Nile that were older than 15 days.`);
    }
  } catch (error: any) {
    console.error('❌ [Trash Cleanup] Error cleaning up expired trash:', error.message);
  }
}
