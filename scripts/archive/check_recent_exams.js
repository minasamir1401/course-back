const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const exams = await prisma.exam.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, title: true, createdAt: true }
  });
  console.log('RECENT EXAMS:', exams);
}
main().finally(() => prisma.$disconnect());
