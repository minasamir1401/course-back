const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const exams = await prisma.exam.findMany({ select: { id: true, title: true, status: true } });
  console.log(exams);
}
main().finally(() => prisma.$disconnect());
