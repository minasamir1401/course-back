process.env.JWT_SECRET = 'performance-tests-only-secret-not-for-production-2026';
require('ts-node/register/transpile-only');
jest.mock('../../src/lib/prisma', () => ({ __esModule: true, default: {
  exam: { findUnique: jest.fn() }, examSubmission: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  studentAnswer: { groupBy: jest.fn() }, subExam: { findUnique: jest.fn() },
} }));
const db = require('../../src/lib/prisma').default;
const controller = require('../../src/controllers/exams.controller');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('analytics aggregates answer rows in the database and preserves percentages', async () => {
  db.exam.findUnique.mockResolvedValue({ id: 'e', title: 'Exam', passingScore: 50, schools: [], modules: [{ id: 'm', title: 'Module', subExams: [{ id: 'child', title: 'Child', moduleId: 'm' }] }], questions: [{ id: 'q', moduleId: 'm', subExamId: 'child', points: 1 }] });
  db.examSubmission.findMany.mockResolvedValue([{ id: 's', percentage: 100, totalScore: 1, user: { id: 'u', name: 'Student', schoolId: 'school', school: { name: 'School' } } }]);
  db.studentAnswer.groupBy.mockResolvedValue([{ questionId: 'q', isCorrect: true, _count: { _all: 1 } }]);
  const res = response();
  await controller.getExamHandler9({ params: { id: 'e' }, user: { role: 'SUPER_ADMIN' } }, res);
  expect(res.code).toBe(200);
  expect(res.body.modules[0].correctRate).toBe(100);
  expect(res.body.subExams[0].totalAnswers).toBe(1);
  expect(db.examSubmission.findMany.mock.calls[0][0].include.answers).toBeUndefined();
  expect(db.studentAnswer.groupBy.mock.calls[0][0].where.submission).toEqual({ examId: 'e' });
});
test('result preserves score without loading the entire parent question bank', async () => {
  db.examSubmission.findUnique.mockResolvedValue({ id: 's', userId: 'u', examId: 'e', subExamId: null, createdAt: new Date(), exam: { title: 'Exam', resultVisibility: 'SHOW_SCORE' }, user: { schoolId: 'school' }, answers: [{ questionId: 'q', isCorrect: true, question: { id: 'q', points: 2, xpPoints: 10, order: 0 } }] });
  db.examSubmission.count.mockResolvedValue(0);
  const res = response();
  await controller.getExamHandler14({ params: { id: 's' }, user: { id: 'u', role: 'STUDENT' } }, res);
  expect(res.body.percentage).toBe(100);
  expect(res.body.totalScore).toBe(2);
  expect(res.body.answers).toEqual([]);
  expect(db.examSubmission.findUnique.mock.calls[0][0].include.exam).toBe(true);
});
