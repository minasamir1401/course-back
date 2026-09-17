process.env.JWT_SECRET = 'question-deletion-role-test-key-2026';
require('ts-node/register/transpile-only');

const prismaMock = {
  exam: { findUnique: jest.fn() },
  question: { count: jest.fn() },
  teacherCourse: { findFirst: jest.fn() },
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
});

test.each(['SCHOOL_ADMIN', 'TEACHER'])('%s cannot delete a persisted question', async (role) => {
  const res = response();
  await putExamHandler5({
    params: { id: 'exam-1' },
    user: { id: 'school-admin-1', role, schoolId: 'school-1' },
    body: { deletedQuestionIds: ['question-1'] },
  }, res);

  expect(res.statusCode).toBe(403);
  expect(res.body.error).toMatch(/Super Admin/);
});
