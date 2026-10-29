require('ts-node/register/transpile-only');
const { studentDashboardContext } = require('../../../src/services/aiStudentDashboard.service');
const { deriveLearningEvidence, studentAiPromptContext } = require('../../../src/services/aiLearning.service');
const now = new Date('2026-10-27T12:00:00Z');

test('dashboard context uses latest released scores, real progress, assigned tasks and the owner inbox', async () => {
  const result = (id, percentage, correct, total) => ({ id, examId: id, subExamId: null, percentage, createdAt: now,
    reportSnapshot: { examTitle: id, correctAnswers: correct, totalQuestions: total, passingScore: 50, apiKey: 'do-not-forward' },
    answers: Array.from({ length: total }, (_, i) => ({ isCorrect: i < correct })), exam: { title: id, passingScore: 50 } });
  const task = { id: 'task', title: 'Assignment due', type: 'Assignment', schoolId: 'school-a', schools: [], startDate: new Date('2026-10-28T12:00:00Z'), endDate: new Date('2026-10-30T12:00:00Z'), submissions: [] };
  const db = {
    examSubmission: { count: jest.fn(async () => 7), findMany: jest.fn(async () => [result('first', 80, 8, 10), result('second', 40, 4, 10)]) },
    course: { findMany: jest.fn(async () => [{ id: 'c', title: 'Math', subject: 'Math', _count: { lessons: 8 } }]) },
    lessonProgress: { findMany: jest.fn(async () => Array.from({ length: 2 }, (_, i) => ({ isCompleted: true, activeStudySeconds: 200, updatedAt: now,
      lesson: { id: `l${i}`, title: 'Completed lesson', courseId: 'c', isVisible: true } }))) },
    exam: { findMany: jest.fn(async () => [task, { ...task, id: 'foreign', title: 'Other school secret', schoolId: 'school-b' }]) },
    studentNotification: { findMany: jest.fn(async () => [{ titleAr: 'موعدك القادم', titleEn: 'Upcoming deadline', body: '<b>Read your lesson</b>', href: 'javascript:bad()', readAt: null, createdAt: now }]), count: jest.fn(async () => 4) },
    lesson: { findMany: jest.fn(async () => [{ id: 'homework', title: 'Lesson assignment', courseId: 'c', assignments: [{ correctAnswer: 'never-forward-the-answer' }] }]) },
  };
  const context = await studentDashboardContext({ id: 'me', schoolId: 'school-a', grade: 'Grade 3' }, db, now);
  expect(context.metrics).toMatchObject({ totalAttempts: 7, selectedAttempts: 2, averageScore: 60, passRate: 50, overallCourseProgress: 25, activeStudySeconds: 400, upcomingExams: 1 });
  expect(context.tasks).toHaveLength(1); expect(context.tasks[0].title).toBe('Assignment due');
  expect(context.notifications).toMatchObject({ unread: 4, items: [{ title: 'موعدك القادم', body: 'Read your lesson', href: null }] });
  expect(context.lessonTasks[0]).toMatchObject({ title: 'Lesson assignment', questionCount: 1 });
  expect(JSON.stringify(context)).not.toMatch(/Other school secret|do-not-forward|never-forward-the-answer|javascript/);
  expect(db.examSubmission.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'me', exam: { resultVisibility: { not: 'HIDE_ALL' } } }, distinct: ['examId', 'subExamId'] });
  expect(db.lessonProgress.findMany.mock.calls[0][0].where.userId).toBe('me');
  expect(db.studentNotification.findMany.mock.calls[0][0].where).toEqual({ userId: 'me' });
  expect(db.studentNotification.count.mock.calls[0][0].where).toEqual({ userId: 'me', readAt: null });
});

test('retakes do not inflate skill evidence and review questions contain only released, whitelisted content', () => {
  const question = { text: 'Compute 8 - 3', skill: 'Subtraction', correctAnswer: 'answer-key', apiKey: 'secret-key' };
  const attempt = (id, date, correct, examId = 'exam', visibility = 'SHOW_ALL') => ({ id, userId: 'me', examId, createdAt: new Date(date), percentage: correct ? 100 : 0,
    exam: { title: 'Exam', resultVisibility: visibility, showAnswers: true }, answers: [{ isCorrect: correct, selectedAnswer: '4', timeTaken: 20, questionSnapshot: question }] });
  const evidence = deriveLearningEvidence([
    attempt('new', '2026-10-27', false), attempt('old', '2026-10-26', true), attempt('score-only', '2026-10-25', false, 'score', 'SHOW_SCORE'),
  ], []);
  expect(evidence.sampleSize).toBe(2); expect(evidence.skills).toHaveLength(1);
  expect(evidence.skills[0]).toMatchObject({ total: 1, correct: 0, evidenceLevel: 'LIMITED' });
  expect(evidence.reviewIssues).toHaveLength(1);
  expect(evidence.reviewIssues[0]).toMatchObject({ question: 'Compute 8 - 3', selectedAnswer: '4', timeTakenSeconds: 20 });
  expect(JSON.stringify(evidence)).not.toMatch(/answer-key|secret-key/);
});

test('five answers are required for strength labels, matching the report evidence threshold', () => {
  const exam = { title: 'Math', resultVisibility: 'SHOW_ALL', showAnswers: true };
  const answers = Array.from({ length: 4 }, () => ({ isCorrect: true, question: { text: 'Known question', skill: 'Fractions' } }));
  expect(deriveLearningEvidence([{ exam, answers }], []).strengths).toHaveLength(0);
  expect(deriveLearningEvidence([{ exam, answers: [...answers, answers[0]] }], []).strengths).toMatchObject([{ name: 'Fractions', total: 5 }]);
});

test('model context distinguishes assessment count from answer count instead of sending ambiguous sampleSize', () => {
  const context = studentAiPromptContext({ student: { name: 'Synthetic' }, dashboard: { metrics: { averageScore: 62 } },
    insight: { evidence: { sampleSize: 2, assessedAnswersCount: 15, skills: [{ name: 'Fractions', total: 5 }] }, narrative: null } });
  expect(context.evidence.assessmentsAnalyzed).toBe(2);
  expect(context.evidence.assessedAnswersCount).toBe(15);
  expect(context.evidence).not.toHaveProperty('sampleSize');
  expect(context.dashboard.metrics.averageScore).toBe(62);
});
