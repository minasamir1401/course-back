import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const course = await prisma.course.findFirst({
    where: { title: { contains: 'SAAT physics', mode: 'insensitive' } },
    include: {
      lessons: true,
      _count: { select: { lessons: true } }
    }
  });

  console.log(JSON.stringify(course, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
