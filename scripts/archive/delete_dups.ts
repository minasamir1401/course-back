import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.exam.deleteMany({
    where: {
      id: { in: ['72808921-29d7-4443-8673-f80f082d3794', 'd8ccedf6-d54b-498e-8b00-9048527f4ec4'] }
    }
  });
  console.log('Deleted duplicates');
}

main().finally(() => prisma.$disconnect());
