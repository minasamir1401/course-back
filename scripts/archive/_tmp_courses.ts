import prisma from './src/lib/prisma';

async function main() {
  const courses = await prisma.course.findMany({
    select: {
      id: true,
      title: true,
      schoolId: true,
      isCentral: true,
      lessons: {
        select: {
          id: true,
          title: true,
          order: true,
          slides: true,
          questions: true,
          assignments: true,
        },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });
  console.log(JSON.stringify(courses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
