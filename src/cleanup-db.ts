import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.school.deleteMany({
    where: { name: "" }
  });
  console.log('Deleted empty schools:', result.count);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
