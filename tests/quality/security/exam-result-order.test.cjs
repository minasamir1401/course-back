process.env.JWT_SECRET = 'exam-order-test-secret-not-for-production-2026';
require('ts-node/register/transpile-only');
const mockDb = { examSubmission: { findUnique: jest.fn() }, subExam: { findUnique: jest.fn() } };
jest.mock('../../../src/lib/prisma', () => ({ __esModule: true, default: mockDb }));
jest.mock('../../../src/lib/redis', () => ({ cacheGetJSON: jest.fn(async () => null), cacheSetJSON: jest.fn(async () => {}) }));
const { buildSubmissionSnapshot, historicalSubmission, snapshotQuestion } = require('../../../src/utils/submissionSnapshot');
const { getExamHandler14 } = require('../../../src/controllers/exams.controller');
const questions = () => Array.from({ length: 4 }, (_, index) => ({ id: `q${index + 1}`, order: index, text: `Question ${index + 1}`, textEn: `Question ${index + 1}`, type: 'MCQ', options: '["A","B"]', correctAnswer: 'A', points: 1, createdAt: new Date(`2026-10-01T00:00:0${index}Z`) }));
const fixture = () => {
  const source = questions();
  const answers = [3, 0, 2, 1].map(index => ({ id: `a${index}`, questionId: source[index].id, selectedAnswer: index === 2 ? 'B' : 'A', isCorrect: index !== 2, questionSnapshot: snapshotQuestion(source[index]), question: { ...source[index], order: 30 - index, text: 'Edited after submission' } }));
  return { id: 'attempt', examId: 'exam', userId: 'student', totalScore: 3, percentage: 75, user: { name: 'Student', role: 'STUDENT', schoolId: 'school' }, schoolIdAtSubmission: 'school',
    exam: { title: 'Exam', passingScore: 50, resultVisibility: 'SHOW_ALL' }, answers,
    reportSnapshot: buildSubmissionSnapshot({ title: 'Exam', passingScore: 50 }, null, {}, source, answers, 75, 30) };
};
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('new attempts freeze the delivered question sequence independently of answer click order', () => {
  const data = fixture();
  expect(data.reportSnapshot.questionOrder).toEqual(['q1', 'q2', 'q3', 'q4']);
  const original = JSON.stringify(data);
  const result = historicalSubmission(data);
  expect(result.answers.map(item => item.question.id)).toEqual(['q1', 'q2', 'q3', 'q4']);
  expect(result.answers.map(item => item.selectedAnswer)).toEqual(['A', 'A', 'B', 'A']);
  expect(result).toMatchObject({ totalScore: 3, percentage: 75, correctAnswers: 3, totalQuestions: 4 });
  expect(JSON.stringify(data)).toBe(original);
});
test('frozen sequence wins over changed live order and even inconsistent legacy order numbers', () => {
  const data = fixture();
  data.reportSnapshot.questionOrder = ['q3', 'q1', 'q4', 'q2'];
  expect(historicalSubmission(data).answers.map(item => item.question.id)).toEqual(['q3', 'q1', 'q4', 'q2']);
});
test('version-one attempts use frozen order, including zero, rather than answer creation or live question order', () => {
  const data = fixture(); delete data.reportSnapshot.questionOrder; data.reportSnapshot.version = 1;
  const result = historicalSubmission(data);
  expect(result.answers.map(item => item.question.text)).toEqual(['Question 1', 'Question 2', 'Question 3', 'Question 4']);
  expect(result.totalScore).toBe(3); expect(result.percentage).toBe(75);
});
test('legacy ties use the same question creation/id tie breakers as delivery, without mutating source records', () => {
  const data = fixture(); delete data.reportSnapshot;
  for (const answer of data.answers) { delete answer.questionSnapshot; answer.question.order = 0; }
  expect(historicalSubmission(data).answers.map(item => item.questionId)).toEqual(['q1', 'q2', 'q3', 'q4']);
  for (const answer of data.answers) delete answer.question.createdAt;
  expect(historicalSubmission(data).answers.map(item => item.questionId)).toEqual(['q1', 'q2', 'q3', 'q4']);
});
test('missing metadata and partial or duplicate sequence IDs do not drop answers or invent grades', () => {
  const data = fixture(); data.reportSnapshot.questionOrder = ['q4', 'q4', null, 'missing'];
  expect(historicalSubmission(data).answers.map(item => item.questionId)).toEqual(['q4', 'q1', 'q2', 'q3']);
  expect(historicalSubmission({ answers: [{ id: 'a', selectedAnswer: '', question: null }], totalScore: 0, percentage: 0 }).answers).toHaveLength(1);
});
test.each(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT'])('result API preserves the question sequence and recorded grades for %s', async role => {
  mockDb.examSubmission.findUnique.mockResolvedValue(fixture());
  const res = response();
  await getExamHandler14({ params: { id: 'attempt' }, user: { id: 'student', role, schoolId: 'school' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.answers.map(item => item.question.id)).toEqual(['q1', 'q2', 'q3', 'q4']);
  expect(res.body).toMatchObject({ totalScore: 3, percentage: 75, correctAnswers: 3 });
});
test('score-only policy still hides the question review after ordering is fixed', async () => {
  const data = fixture(); data.exam.resultVisibility = 'SHOW_SCORE';
  mockDb.examSubmission.findUnique.mockResolvedValue(data);
  const res = response(); await getExamHandler14({ params: { id: 'attempt' }, user: { id: 'student', role: 'STUDENT', schoolId: 'school' } }, res);
  expect(res.body.answers).toEqual([]); expect(res.body.percentage).toBe(75);
});
