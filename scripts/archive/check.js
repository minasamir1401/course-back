const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function check() {
  const qs = await prisma.question.findMany({ select: { type: true }, distinct: ['type'] });
  console.log(qs);
}
check().finally(() => prisma.$disconnect());
