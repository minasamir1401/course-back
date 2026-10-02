process.env.JWT_SECRET = 'question-deletion-role-test-key-2026';
require('ts-node/register/transpile-only');

const prismaMock = {
  exam: { findUnique: jest.fn(), update: jest.fn() },
  question: { count: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  teacherCourse: { findFirst: jest.fn() },
  examModule: { findMany: jest.fn(async () => []) },
  subExam: { findMany: jest.fn(async () => []) },
  systemSetting: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('../../../src/lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock('../../../src/lib/redis', () => ({
  cacheGetJSON: jest.fn(async () => null),
  cacheSetJSON: jest.fn(async () => {}),
  cacheDelete: jest.fn(async () => {}),
}));

const { putExamHandler5 } = require('../../../src/controllers/exams.controller');

const response = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.exam.findUnique.mockResolvedValue({
    id: 'exam-1', creatorId: 'school-admin-1', schoolId: 'school-1',
    isCentral: false, deletedAt: null, schools: [{ id: 'school-1' }],
    _count: { submissions: 0 },
  });
  prismaMock.question.count.mockResolvedValue(1);
  prismaMock.systemSetting.findUnique.mockResolvedValue({ value: 'false' });
  prismaMock.question.findMany.mockReset().mockResolvedValueOnce([{ id: 'question-1', order: 0, text: 'Saved question', type: 'TEXT' }]).mockResolvedValue([]);
  prismaMock.question.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.exam.update.mockResolvedValue({ id: 'exam-1' });
  prismaMock.$transaction.mockImplementation(callback => callback(prismaMock));
});

test.each(['SCHOOL_ADMIN', 'TEACHER'])('%s cannot delete a persisted question when policy is locked', async (role) => {
  const res = response();
  await putExamHandler5({
    params: { id: 'exam-1' },
    user: { id: 'school-admin-1', role, schoolId: 'school-1' },
    body: { deletedQuestionIds: ['question-1'] },
  }, res);

  expect(res.statusCode).toBe(403);
  expect(res.body.error).toMatch(/Super Admin/);
});

test.each(['SCHOOL_ADMIN', 'TEACHER', 'SUPER_ADMIN'])('%s can soft-delete with the correct policy and exam access', async (role) => {
  prismaMock.systemSetting.findUnique.mockResolvedValue({ value: role === 'SUPER_ADMIN' ? 'false' : 'true' });
  const res = response();
  await putExamHandler5({ params: { id: 'exam-1' }, query: {},
    user: { id: 'school-admin-1', role, schoolId: 'school-1' },
    body: { questions: [], deletedQuestionIds: ['question-1'] },
  }, res);
  expect(res.statusCode).toBe(200);
  expect(prismaMock.question.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['question-1'] }, examId: 'exam-1' }, data: { deletedAt: expect.any(Date) },
  });
});

test('open policy does not allow deletion from another school', async () => {
  prismaMock.systemSetting.findUnique.mockResolvedValue({ value: 'true' });
  const res = response();
  await putExamHandler5({ params: { id: 'exam-1' },
    user: { id: 'foreign-admin', role: 'SCHOOL_ADMIN', schoolId: 'school-2' },
    body: { deletedQuestionIds: ['question-1'] },
  }, res);
  expect(res.statusCode).toBe(403);
  expect(prismaMock.$transaction).not.toHaveBeenCalled();
});
