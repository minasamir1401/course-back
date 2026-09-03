const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  console.time('count');
  await prisma.course.count();
  console.timeEnd('count');

  console.time('findMany');
  const courses = await prisma.course.findMany({
    skip: 0,
    take: 12,
    select: {
      id: true,
      title: true,
      _count: { select: { lessons: true, enrollments: true, exams: true } },
      school: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  console.timeEnd('findMany');
  console.log(`Found ${courses.length} courses`);

  console.time('stats');
  await Promise.all([
    prisma.course.count(),
    prisma.lesson.count(),
    prisma.course.groupBy({
      by: ['subject'],
      where: { subject: { not: null } }
    })
  ]);
  console.timeEnd('stats');

  await prisma.$disconnect();
}

test();
