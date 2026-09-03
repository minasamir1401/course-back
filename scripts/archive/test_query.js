const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const exam = await prisma.exam.findUnique({
    where: { id: '9db5a747-99a6-474f-998b-afeb1dfc18c2' },
    include: { modules: true }
  });
  console.log(JSON.stringify(exam, null, 2));
}
main().finally(() => prisma.$disconnect());
