process.env.JWT_SECRET = 'performance-tests-only-secret-not-for-production-2026';
require('ts-node/register/transpile-only');
jest.mock('../../src/lib/prisma', () => ({ __esModule: true, default: {
  exam: { findUnique: jest.fn() }, examSubmission: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  studentAnswer: { groupBy: jest.fn(), findMany: jest.fn(async () => [{ submissionId: "s", isCorrect: true, question: { id: "q", moduleId: "m", subExamId: "child", points: 1 } }]) }, subExam: { findUnique: jest.fn(), findMany: jest.fn(async () => []) }, user: { findMany: jest.fn(async () => []) },
} }));
const db = require('../../src/lib/prisma').default;
const controller = require('../../src/controllers/exams.controller');
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
test('analytics uses bounded, selected student attempts and preserves percentages', async () => {
  db.exam.findUnique.mockResolvedValue({ id: 'e', title: 'Exam', passingScore: 50, schools: [], modules: [{ id: 'm', title: 'Module', subExams: [{ id: 'child', title: 'Child', moduleId: 'm' }] }], questions: [{ id: 'q', moduleId: 'm', subExamId: 'child', points: 1 }] });
  db.examSubmission.findMany.mockResolvedValue([{ id: 's', userId: 'u', examId: 'e', createdAt: new Date(), percentage: 100, totalScore: 1, answers: [{ isCorrect: true, question: { id: 'q', moduleId: 'm', subExamId: 'child', points: 1 } }], exam: { title: 'Exam', passingScore: 50 }, user: { id: 'u', name: 'Student', schoolId: 'school', school: { name: 'School' } } }]);
  db.studentAnswer.groupBy.mockResolvedValue([{ questionId: 'q', isCorrect: true, _count: { _all: 1 } }]);
  const res = response();
  await controller.getExamHandler9({ params: { id: 'e' }, user: { role: 'SUPER_ADMIN' } }, res);
  expect(res.code).toBe(200);
  expect(res.body.modules[0].correctRate).toBe(100);
  expect(res.body.subExams[0].totalAnswers).toBe(1);
  expect(db.examSubmission.findMany.mock.calls[0][0].take).toBe(10001);
  expect(db.examSubmission.findMany.mock.calls[0][0].where.AND).toContainEqual({ user: { role: 'STUDENT', deletedAt: null } });
  expect(res.body.overall.uniqueStudents).toBe(1);
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

test('admin result preserves the saved section threshold, title, questions and score after edits', async () => {
  db.subExam.findUnique.mockResolvedValue({ id: 'child', title: 'Edited section', passingScore: 20 });
  db.examSubmission.findUnique.mockResolvedValue({ id: 'saved', userId: 'u', subExamId: 'child', totalScore: 7, percentage: 70,
    schoolIdAtSubmission: 'old-school', user: { schoolId: 'new-school' },
    reportSnapshot: { examTitle: 'Original section', passingScore: 80, totalPoints: 10, correctAnswers: 1, totalQuestions: 1, passed: false },
    exam: { title: 'Edited exam', passingScore: 10 },
    answers: [{ isCorrect: true, questionSnapshot: { id: 'q', text: 'Original question', points: 10 }, question: { id: 'q', text: 'Edited question', points: 100 } }] });
  const res = response();
  await controller.getExamHandler14({ params: { id: 'saved' }, user: { role: 'SCHOOL_ADMIN', schoolId: 'old-school' } }, res);
  expect(res.code).toBe(200);
  expect(res.body).toMatchObject({ totalScore: 7, percentage: 70, passed: false, historicalSnapshot: true,
    exam: { title: 'Original section', passingScore: 80, totalPoints: 10 }, subExam: { title: 'Original section', passingScore: 80 } });
  expect(res.body.answers[0].question.text).toBe('Original question');
});

test('HIDE_ALL never reveals stored grades or answers through the result endpoint', async () => {
  db.examSubmission.findUnique.mockResolvedValue({ id: 'hidden', userId: 'u', subExamId: null, totalScore: 10, percentage: 100,
    user: { schoolId: 'school' }, reportSnapshot: { totalPoints: 10 },
    exam: { title: 'Exam', resultVisibility: 'HIDE_ALL' }, answers: [] });
  const res = response();
  await controller.getExamHandler14({ params: { id: 'hidden' }, user: { id: 'u', role: 'STUDENT' } }, res);
  expect(res.body.policy).toBe('HIDE_ALL');
  for (const field of ['totalScore', 'percentage', 'reportSnapshot', 'answers']) expect(res.body).not.toHaveProperty(field);
});
