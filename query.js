const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const exams = await prisma.exam.findMany({
    include: {
      modules: {
        include: {
          subExams: true
        }
      }
    }
  });
  console.log(JSON.stringify(exams, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
