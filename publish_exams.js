const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.exam.updateMany({ data: { status: 'PUBLISHED' } });
  console.log('All exams published');
}
main().finally(() => prisma.$disconnect());
