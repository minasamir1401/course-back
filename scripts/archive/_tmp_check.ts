import prisma from './src/lib/prisma';

async function main() {
  const courseId = '720851c3-ea4a-451e-ae5f-85c0490aa359';
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      lessons: {
        select: {
          id: true,
          title: true,
          order: true,
          isVisible: true,
          isCentral: true
        }
      },
      school: true,
      schools: true
    }
  });
  console.log('Course details:');
  console.log(JSON.stringify(course, null, 2));

  console.log('\nAll courses with same title (or similar):');
  const similar = await prisma.course.findMany({
    where: { title: { contains: 'NAFS_Math' } },
    select: {
      id: true,
      title: true,
      schoolId: true,
      isCentral: true,
      _count: { select: { lessons: true } }
    }
  });
  console.log(JSON.stringify(similar, null, 2));

  console.log('\nSchool admins:');
  const admins = await prisma.user.findMany({
    where: { role: 'SCHOOL_ADMIN' },
    select: {
      id: true,
      name: true,
      username: true,
      schoolId: true
    }
  });
  console.log(JSON.stringify(admins, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
