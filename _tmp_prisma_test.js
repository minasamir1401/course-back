const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const where = { deletedAt: null };
  where.OR = [
    { isCentral: true }
  ];
  console.log(where);
  const exams = await prisma.exam.findMany({ where, select: { id: true, title: true, deletedAt: true } });
  console.log("Exams returned with deletedAt !== null: ", exams.filter(e => e.deletedAt !== null).length);
}
main().catch(console.error).finally(() => prisma.$disconnect());
