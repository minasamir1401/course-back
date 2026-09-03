const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function assertNoDuplicate(model, field, where) {
  const rows = await model.groupBy({ by: [field], where, _count: { [field]: true }, having: { [field]: { _count: { gt: 1 } } } });
  expect(rows).toEqual([]);
}

describe('read-only Prisma data integrity', () => {
  afterAll(async () => prisma.$disconnect());

  test('active course titles are not duplicated', async () => {
    await assertNoDuplicate(prisma.course, 'title', { deletedAt: null });
  });

  test('active exam titles are not duplicated within the same course', async () => {
    const duplicates = await prisma.exam.groupBy({
      by: ['courseId', 'title'],
      where: { deletedAt: null },
      _count: { title: true },
      having: { title: { _count: { gt: 1 } } },
    });
    expect(duplicates).toEqual([]);
  });

  test('questions have non-empty exam references', async () => {
    const questions = await prisma.question.findMany({ select: { id: true, examId: true } });
    expect(questions.filter(question => !question.examId)).toEqual([]);
  });
});
