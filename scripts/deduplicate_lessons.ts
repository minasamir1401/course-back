import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Starting lesson deduplication process...');

  // Group lessons by courseId and title
  const lessons = await prisma.lesson.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      courseId: true,
      slides: true,
      questions: true,
      updatedAt: true
    }
  });

  const lessonGroups = new Map<string, typeof lessons>();

  for (const lesson of lessons) {
    // Generate a unique key for grouping (CourseID + Lesson Title)
    // Normalize the title to avoid small whitespace differences
    const key = `${lesson.courseId}_${lesson.title.trim().toLowerCase()}`;
    if (!lessonGroups.has(key)) {
      lessonGroups.set(key, []);
    }
    lessonGroups.get(key)!.push(lesson);
  }

  let totalDeleted = 0;

  for (const [key, group] of lessonGroups.entries()) {
    if (group.length > 1) {
      console.log(`\n⚠️ Found duplicate lessons for key: ${key}`);
      console.log(`   Count: ${group.length}`);

      // Sort group to find the "best" lesson to keep.
      // Criteria: 
      // 1. Most slides + questions (the most complete one)
      // 2. If tie, the most recently updated.
      group.sort((a, b) => {
        const getCount = (item: any) => {
          let count = 0;
          try {
            const s = typeof item.slides === 'string' ? JSON.parse(item.slides) : (item.slides || []);
            const q = typeof item.questions === 'string' ? JSON.parse(item.questions) : (item.questions || []);
            count += (Array.isArray(s) ? s.length : 0);
            count += (Array.isArray(q) ? q.length : 0);
          } catch (e) {
            // Ignore parse errors
          }
          return count;
        };

        const scoreA = getCount(a);
        const scoreB = getCount(b);

        if (scoreA !== scoreB) {
          return scoreB - scoreA; // Descending order (highest score first)
        }

        // If tie, pick the newest
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      const lessonToKeep = group[0];
      const lessonsToDelete = group.slice(1);

      console.log(`   ✅ Keeping lesson: ${lessonToKeep.id} (updated: ${lessonToKeep.updatedAt})`);
      
      for (const toDelete of lessonsToDelete) {
        console.log(`   🗑️ Deleting lesson: ${toDelete.id} (updated: ${toDelete.updatedAt})`);
        
        // Soft delete the duplicate
        await prisma.lesson.update({
          where: { id: toDelete.id },
          data: { deletedAt: new Date() }
        });
        totalDeleted++;
      }
    }
  }

  console.log(`\n🎉 Deduplication complete! Soft deleted ${totalDeleted} duplicate lessons.`);
}

main()
  .catch((e) => {
    console.error('❌ Error during deduplication:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
