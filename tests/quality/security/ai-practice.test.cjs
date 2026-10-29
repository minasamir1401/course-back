process.env.JWT_SECRET = 'practice-test-session-secret-not-for-production-2026';
require('ts-node/register/transpile-only');
const mockDb = {
  aiMessage: { findFirst: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), createMany: jest.fn() },
  aiConversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  systemSetting: { findUnique: jest.fn() }, $transaction: jest.fn(),
};
jest.mock('../../../src/lib/prisma', () => ({ __esModule: true, default: mockDb }));
jest.mock('../../../src/lib/redis', () => ({ checkRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../../src/middleware/auth', () => ({
  verifyToken: (req, res, next) => { if (!req.headers['x-test-user']) return res.sendStatus(401); req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'] || 'STUDENT' }; next(); },
  checkRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
}));
const learning = require('../../../src/services/aiLearning.service');
const routing = require('../../../src/services/aiRouting.service');
const service = require('../../../src/services/aiPractice.service');
const { practiceRequest, parsePractice, encodePractice, publicPractice, serializeAiMessage, practiceHistoryText, gradePractice, savedPractice } = service;
const express = require('express'), request = require('supertest');
const app = express(); app.use(express.json()); app.use(require('../../../src/routes/ai').default);
const fixture = () => ({ version: 1, title: 'تدريب النسب', introduction: 'جرّب بنفسك', layout: 'step', questions: [
  { type: 'single_choice', prompt: 'ربع 200؟', options: ['50', '25', '100'], correctAnswers: [0], hint: 'اقسم على أربعة', explanation: 'PRIVATE_EXPLANATION_ONE 200 ÷ 4 = 50' },
  { type: 'multiple_choice', prompt: 'اختر الأعداد الزوجية', options: ['2', '3', '4'], correctAnswers: [0, 2], hint: 'تقبل القسمة على اثنين', explanation: 'PRIVATE_EXPLANATION_TWO 2 و4 عددان زوجيان' },
  { type: 'short_answer', prompt: 'اكتب 25 كنسبة مئوية', acceptedAnswers: ['25%'], hint: 'اكتب علامة النسبة', explanation: 'PRIVATE_EXPLANATION_THREE 25%' },
] });
const document = () => parsePractice(JSON.stringify(fixture()), 3);
beforeEach(() => { jest.clearAllMocks(); mockDb.systemSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ enabled: true, publicEnabled: true }) }); });

test.each(['اعملي تدريب واساله', 'اسألني عن الكسور', 'جهز ٥ أسئلة عن الدرس', 'عايز تمرين تفاعلي', 'Create 3 practice questions', 'quiz me', 'اعمل سؤال واحد'])('detects interactive requests: %s', message => {
  expect(practiceRequest(message)).not.toBeNull();
});
test.each(['اشرح السؤال اللي غلطت فيه', 'ما معنى التدريب؟', 'إيه مميزات المنصة؟', 'Explain my last answer'])('keeps explanatory requests as normal chat: %s', message => expect(practiceRequest(message)).toBeNull());
test('bounds counts and recognizes Arabic numbers', () => {
  expect(practiceRequest('جهز ٥ أسئلة').count).toBe(5);
  expect(practiceRequest('اعملي ٣ أسئلة عن النسب').count).toBe(3);
  expect(practiceRequest('عايز تدريب عن العدد 100').count).toBe(5);
  expect(practiceRequest('اعملي 99 اسئله').count).toBe(10);
  expect(practiceRequest('اعمل سؤال واحد').count).toBe(1);
});
test('strict schema rejects malformed JSON, unsafe shapes, duplicate options and invalid keys', () => {
  expect(() => parsePractice('not JSON', 3)).toThrow();
  for (const mutate of [data => data.questions[0].correctAnswers = [8], data => data.questions[0].correctAnswers = [0, 1], data => data.questions[1].correctAnswers = [0, 0], data => data.questions[0].options = ['same', 'same'], data => data.questions[2].acceptedAnswers = [], data => data.questions[0].type = 'javascript', data => data.layout = 'html', data => data.questions.pop()]) {
    const data = fixture(); mutate(data); expect(() => parsePractice(JSON.stringify(data), 3)).toThrow();
  }
  expect(parsePractice('```json\n' + JSON.stringify(fixture()) + '\n```', 3).questions).toHaveLength(3);
});
test('answer keys and explanations never reach unanswered public messages or AI history', () => {
  const practice = document();
  for (const value of [JSON.stringify(publicPractice('m', practice)), JSON.stringify(serializeAiMessage({ id: 'm', role: 'assistant', content: encodePractice(practice) })), practiceHistoryText(encodePractice(practice), 'assistant')]) {
    expect(value).not.toMatch(/correctAnswers|acceptedAnswers|PRIVATE_EXPLANATION/);
  }
  const answered = gradePractice(practice, 'q1', ['o1']);
  const safe = publicPractice('m', answered);
  expect(safe.questions[0].result.isCorrect).toBe(true);
  expect(safe.questions[1].result).toBeUndefined();
  expect(JSON.stringify(safe)).not.toContain('PRIVATE_EXPLANATION_TWO');
  expect(practiceHistoryText(encodePractice(answered), 'assistant')).toContain('PRIVATE_EXPLANATION_ONE');
  expect(serializeAiMessage({ role: 'assistant', content: 'KLEVRO_PRACTICE_V1\nbroken' }).content).not.toContain('KLEVRO_');
  expect(serializeAiMessage({ role: 'user', content: encodePractice(practice) }).role).toBe('user');
});
test('grades single, exact multi-select and normalized numeric answers; answers are immutable', () => {
  let data = document();
  data = gradePractice(data, 'q1', ['o2']);
  expect(data.answers.q1.isCorrect).toBe(false);
  expect(gradePractice(data, 'q1', ['o1'])).toBe(data);
  data = gradePractice(data, 'q2', ['o3', 'o1']);
  expect(data.answers.q2.isCorrect).toBe(true);
  data = gradePractice(data, 'q3', '٢٥٫٠ ٪');
  expect(data.answers.q3.isCorrect).toBe(true);
  expect(publicPractice('m', data).score).toEqual({ answered: 3, total: 3, correct: 2, completed: true, percent: 67 });
  expect(gradePractice(document(), 'q2', ['o1']).answers.q2.isCorrect).toBe(false);
  expect(() => gradePractice(document(), 'q1', ['o9'])).toThrow();
  expect(() => gradePractice(document(), 'q1', ['o1', 'o2'])).toThrow();
  expect(() => gradePractice(document(), 'q3', { value: '25%' })).toThrow();
  expect(() => gradePractice(document(), 'bad', ['o1'])).toThrow();
  const exact = document(); exact.questions[2].acceptedAnswers = ['9007199254740992'];
  expect(gradePractice(exact, 'q3', '9007199254740993').answers.q3.isCorrect).toBe(false);
});
test('compare-and-swap retry retains answers from concurrent requests and owner scope', async () => {
  const original = document(), concurrent = gradePractice(original, 'q2', ['o1', 'o3']);
  mockDb.aiMessage.findFirst.mockResolvedValueOnce({ content: encodePractice(original) }).mockResolvedValueOnce({ content: encodePractice(concurrent) });
  mockDb.aiMessage.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
  const result = await savedPractice('me', 'm', { questionId: 'q1', answer: ['o1'] });
  expect(result.score.answered).toBe(2);
  expect(mockDb.aiMessage.findFirst.mock.calls[0][0].where.conversation).toEqual({ userId: 'me' });
  expect(mockDb.aiMessage.updateMany.mock.calls[1][0].where).toMatchObject({ id: 'm', content: encodePractice(concurrent), conversation: { userId: 'me' } });
});
test('review and grading routes require a student session and ownership, never expose hidden answers', async () => {
  for (const method of ['get', 'post']) {
    const path = '/api/ai/practice/m' + (method === 'post' ? '/answer' : '');
    await request(app)[method](path).send({}).expect(401);
    await request(app)[method](path).set('x-test-user', 'admin').set('x-test-role', 'SUPER_ADMIN').send({}).expect(403);
    mockDb.aiMessage.findFirst.mockResolvedValue(null);
    await request(app)[method](path).set('x-test-user', 'other').send({}).expect(404);
  }
  const data = document(); mockDb.aiMessage.findFirst.mockResolvedValue({ content: encodePractice(data) });
  const review = await request(app).get('/api/ai/practice/m').set('x-test-user', 'me').expect(200);
  expect(JSON.stringify(review.body)).not.toMatch(/correctAnswers|acceptedAnswers|PRIVATE_EXPLANATION/);
  mockDb.aiMessage.updateMany.mockResolvedValue({ count: 1 });
  const answer = await request(app).post('/api/ai/practice/m/answer').set('x-test-user', 'me').send({ questionId: 'q1', answer: ['o1'], userId: 'victim', isCorrect: true }).expect(200);
  expect(answer.body.practice.score.correct).toBe(1);
  expect(JSON.stringify(answer.body)).not.toContain('PRIVATE_EXPLANATION_TWO');
  mockDb.aiMessage.findFirst.mockResolvedValue({ content: encodePractice(gradePractice(data, 'q1', ['o1'])) });
  const duplicate = await request(app).post('/api/ai/practice/m/answer').set('x-test-user', 'me').send({ questionId: 'q1', answer: ['o2'] }).expect(200);
  expect(duplicate.body.practice.questions[0].result.submittedAnswer).toEqual(['o1']);
});
test('chat generates and persists structured practice, history redacts keys, provider history remains private', async () => {
  const context = jest.spyOn(learning, 'studentLearningContext').mockResolvedValue({ student: {}, insight: { evidence: {} }, dashboard: {} });
  const prompt = jest.spyOn(learning, 'studentAiPromptContext').mockReturnValue({ student: { name: 'me' } });
  const model = jest.spyOn(routing, 'completeAi').mockResolvedValue({ content: JSON.stringify(fixture()), model: 'test' });
  mockDb.aiConversation.findFirst.mockResolvedValue({ id: 'thread', userId: 'me', messages: [{ id: 'm', role: 'assistant', content: encodePractice(document()) }] });
  mockDb.aiMessage.findMany.mockResolvedValue([{ role: 'assistant', content: encodePractice(document()) }]);
  mockDb.$transaction.mockImplementation(callback => callback(mockDb));
  try {
    const result = await request(app).post('/api/ai/chat').set('x-test-user', 'me').send({ conversationId: 'thread', message: 'اعملي 3 أسئلة عن النسب' }).expect(200);
    expect(result.body.practice.questions).toHaveLength(3);
    expect(JSON.stringify(result.body)).not.toMatch(/correctAnswers|acceptedAnswers|PRIVATE_EXPLANATION/);
    const persisted = mockDb.aiMessage.createMany.mock.calls[0][0].data[1];
    expect(persisted.content).toContain('KLEVRO_PRACTICE_V1');
    expect(persisted.id).toBe(result.body.messageId);
    expect(model.mock.calls[0][0][0].content).toContain('INTERACTIVE PRACTICE OUTPUT CONTRACT');
    expect(model.mock.calls[0][0][1].content).not.toContain('PRIVATE_EXPLANATION');
    const budgeted = model.mock.calls[0][1].buildMessages(5500);
    expect(JSON.stringify(budgeted)).toContain('INTERACTIVE PRACTICE OUTPUT CONTRACT');
    const history = await request(app).get('/api/ai/conversations/thread').set('x-test-user', 'me').expect(200);
    expect(history.body.messages[0].practice.questions).toHaveLength(3);
    expect(JSON.stringify(history.body)).not.toContain('PRIVATE_EXPLANATION');
    model.mockResolvedValueOnce({ content: 'bad JSON', model: 'test' });
    await request(app).post('/api/ai/chat').set('x-test-user', 'me').send({ conversationId: 'thread', message: 'اعملي 3 أسئلة' }).expect(502);
    expect(mockDb.aiMessage.createMany).toHaveBeenCalledTimes(1);
  } finally { context.mockRestore(); prompt.mockRestore(); model.mockRestore(); }
});
test('public chat practice offers sign-in without calling the provider or student database', async () => {
  const model = jest.spyOn(routing, 'completeAi');
  try {
    const result = await request(app).post('/api/ai/public/chat').send({ message: 'اعملي تدريب' }).expect(200);
    expect(result.body.content).toContain('(/login)');
    expect(model).not.toHaveBeenCalled(); expect(mockDb.aiMessage.findFirst).not.toHaveBeenCalled();
  } finally { model.mockRestore(); }
});
