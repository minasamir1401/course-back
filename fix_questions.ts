import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const res = await prisma.question.updateMany({
    where: {
      type: {
        notIn: ['MCQ', 'TRUE_FALSE', 'MULTI_SELECT']
      }
    },
    data: {
      type: 'MCQ'
    }
  });
  console.log('Updated ' + res.count + ' questions');
}
main().catch(console.error).finally(() => prisma.$disconnect());
