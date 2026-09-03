const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const exams = await prisma.exam.findMany({ where: { folderId: null }, include: { _count: { select: { questions: true } } } });
  console.log('Standalone exams count:', exams.length);
  console.log('Standalone exams with questions:', exams.filter(e => e._count.questions > 0).length);
  const examWithQuestions = exams.find(e => e._count.questions > 0);
  if (examWithQuestions) console.log('Example ID:', examWithQuestions.id, 'Count:', examWithQuestions._count.questions);
}
main().finally(() => prisma.$disconnect());
