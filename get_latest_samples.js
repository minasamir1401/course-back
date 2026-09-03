const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== Latest 3 Exams ===");
  const exams = await prisma.exam.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3
  });
  console.log(JSON.stringify(exams, null, 2));

  console.log("\n=== Latest 3 Questions ===");
  const questions = await prisma.question.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3
  });
  console.log(JSON.stringify(questions, null, 2));

  console.log("\n=== Latest 3 Activity Logs ===");
  const logs = await prisma.activityLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: 3
  });
  console.log(JSON.stringify(logs, null, 2));
  
  console.log("\n=== Latest 3 Users ===");
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3
  });
  console.log(JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
