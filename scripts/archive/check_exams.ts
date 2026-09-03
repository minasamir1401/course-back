import prisma from './src/lib/prisma';

async function main() {
  const exams = await prisma.exam.findMany({
    select: {
      id: true,
      title: true,
      _count: {
        select: {
          questions: true
        }
      },
      questions: {
        select: {
          id: true,
          text: true,
          type: true,
          options: true
        }
      }
    }
  });

  console.log("EXAMS IN DB:", JSON.stringify(exams, null, 2));
}

main().finally(async () => {
  await prisma.$disconnect();
});
