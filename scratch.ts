import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const courseId = '20b38848-5531-4b50-9e8d-cfaa748c5970';
  const lessons = await prisma.lesson.findMany({
    where: { courseId },
    include: { blocks: true }
  });
  console.log('Total lessons:', lessons.length);
  if (lessons.length > 0) {
    const l = lessons[0];
    console.log('Lesson 0 Title:', l.title);
    console.log('Lesson 0 questions field:', l.questions?.substring(0, 100));
    console.log('Lesson 0 slides field:', l.slides?.substring(0, 100));
    console.log('Lesson 0 assignments field:', l.assignments?.substring(0, 100));
    console.log('Lesson 0 Blocks count:', l.blocks.length);
    if (l.blocks.length > 0) {
      console.log('Block 0:', l.blocks[0]);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
