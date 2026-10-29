process.env.JWT_SECRET = 'ai-test-session-secret-not-for-production-2026';
process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
require('ts-node/register/transpile-only');
const crypto = require('crypto');
const mockDb = {
  user: { findFirst: jest.fn(), findMany: jest.fn() },
  examSubmission: { findMany: jest.fn() }, lesson: { findFirst: jest.fn(), findMany: jest.fn() },
  studentAiInsight: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  systemSetting: { findUnique: jest.fn(async () => null) },
  aiConversation: { findFirst: jest.fn() }, aiProvider: { findMany: jest.fn(async () => []), findUnique: jest.fn() },
};
jest.mock('../../../src/lib/prisma', () => ({ __esModule: true, default: mockDb }));
jest.mock('../../../src/lib/redis', () => ({ checkRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../../src/middleware/auth', () => ({
  verifyToken: (req, res, next) => { if (!req.headers['x-test-role']) return res.status(401).json({ error: 'Unauthorized' }); req.user = { id: 'me', role: req.headers['x-test-role'], schoolId: 'school-a' }; next(); },
  checkRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' }),
}));
const security = require('../../../src/lib/aiSecurity');
const routing = require('../../../src/services/aiRouting.service');
const learning = require('../../../src/services/aiLearning.service');
const speechService = require('../../../src/services/aiSpeech.service');
const platformKnowledge = require('../../../src/services/aiKnowledge.service');
const express = require('express'); const request = require('supertest');
const app = express(); app.use(express.json()); app.use(require('../../../src/routes/ai').default);
beforeEach(() => {
  jest.clearAllMocks();
  mockDb.systemSetting.findUnique.mockResolvedValue(null);
  mockDb.user.findFirst.mockResolvedValue({ id: 'me', name: 'Student A', grade: 'Grade 3', schoolId: 'school-a', school: { name: 'School A' } });
  mockDb.examSubmission.findMany.mockResolvedValue([]); mockDb.lesson.findMany.mockResolvedValue([]);
  mockDb.studentAiInsight.findUnique.mockResolvedValue(null);
  mockDb.studentAiInsight.updateMany.mockResolvedValue({ count: 1 });
  mockDb.studentAiInsight.upsert.mockImplementation(async args => ({ ...args.create, generatedAt: new Date() }));
});
test('credentials use authenticated random encryption and reject tampering', () => {
  const key = 'private-test-provider-key'; const a = security.encryptAiKey(key), b = security.encryptAiKey(key);
  expect(a).not.toContain(key); expect(a).not.toBe(b); expect(security.decryptAiKey(a)).toBe(key);
  const parts = a.split('.'); parts[3] = Buffer.from('tampered').toString('base64');
  expect(() => security.decryptAiKey(parts.join('.'))).toThrow();
  expect(security.aiKeyFingerprint(key)).toBe(security.aiKeyFingerprint(key));
});

test('saved credentials are disclosed only through an explicit super-admin-only no-store reveal', async () => {
  const secret = 'synthetic-reveal-credential';
  mockDb.aiProvider.findUnique.mockResolvedValue({ encryptedKey: security.encryptAiKey(secret) });
  await request(app).get('/api/ai/admin/providers/saved/credential').expect(401);
  for (const role of ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN']) await request(app).get('/api/ai/admin/providers/saved/credential').set('x-test-role', role).expect(403);
  expect(mockDb.aiProvider.findUnique).not.toHaveBeenCalled();
  const result = await request(app).get('/api/ai/admin/providers/saved/credential').set('x-test-role', 'SUPER_ADMIN').expect(200);
  expect(result.body).toEqual({ apiKey: secret });
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.headers.pragma).toBe('no-cache');
  expect(mockDb.aiProvider.findUnique.mock.calls[0][0]).toEqual({ where: { id: 'saved' }, select: { encryptedKey: true } });
  mockDb.aiProvider.findUnique.mockResolvedValue(null);
  await request(app).get('/api/ai/admin/providers/missing/credential').set('x-test-role', 'SUPER_ADMIN').expect(404);
  mockDb.aiProvider.findUnique.mockResolvedValue({ encryptedKey: 'corrupt-private-encrypted-value' });
  const failed = await request(app).get('/api/ai/admin/providers/corrupt/credential').set('x-test-role', 'SUPER_ADMIN').expect(500);
  expect(JSON.stringify(failed.body)).not.toMatch(/synthetic-reveal|corrupt-private/);
});

test('only a super admin can test a saved provider and the route returns genuine probe diagnostics', async () => {
  const probe = jest.spyOn(routing, 'testAiProvider').mockResolvedValue({ ok: false, status: 429, code: 'AI_PROVIDER_RATE_LIMIT' });
  mockDb.aiProvider.findUnique.mockResolvedValue({ id: 'saved', encryptedKey: 'never-send-to-client' });
  try {
    await request(app).post('/api/ai/admin/providers/saved/test').send({}).expect(401);
    for (const role of ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN']) await request(app).post('/api/ai/admin/providers/saved/test').set('x-test-role', role).send({}).expect(403);
    expect(probe).not.toHaveBeenCalled();
    const result = await request(app).post('/api/ai/admin/providers/saved/test').set('x-test-role', 'SUPER_ADMIN').send({}).expect(200);
    expect(result.body.test).toMatchObject({ ok: false, status: 429 });
    expect(JSON.stringify(result.body)).not.toContain('never-send-to-client');
    mockDb.aiProvider.findUnique.mockResolvedValue(null);
    await request(app).post('/api/ai/admin/providers/missing/test').set('x-test-role', 'SUPER_ADMIN').send({}).expect(404);
  } finally { probe.mockRestore(); }
});

test('changing a provider URL requires a freshly entered credential rather than forwarding the stored key', async () => {
  const validate = jest.spyOn(security, 'validateAiBaseUrl').mockResolvedValue('https://new-provider.example/v1');
  mockDb.aiProvider.findUnique.mockResolvedValue({ id: 'saved', model: 'test', baseUrl: 'https://old-provider.example/v1' });
  try {
    const result = await request(app).patch('/api/ai/admin/providers/saved').set('x-test-role', 'SUPER_ADMIN').send({ baseUrl: 'https://new-provider.example/v1' }).expect(400);
    expect(result.body.code).toBe('AI_KEY_REQUIRED_FOR_URL_CHANGE');
  } finally { validate.mockRestore(); }
});

test('encryption status validates the key format instead of treating any nonempty value as configured', () => {
  const original = process.env.AI_ENCRYPTION_KEY;
  try { process.env.AI_ENCRYPTION_KEY = 'invalid'; expect(security.aiEncryptionConfigured()).toBe(false); process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); expect(security.aiEncryptionConfigured()).toBe(true); }
  finally { process.env.AI_ENCRYPTION_KEY = original; }
});

test('audience validation permits exclusive/shared pools, preserves legacy defaults and rejects invalid or empty scope', () => {
  expect(security.aiProviderAudience({})).toEqual({ allowStudent: true, allowPublic: false });
  expect(security.aiProviderAudience({ allowPublic: true, allowStudent: false })).toEqual({ allowPublic: true, allowStudent: false });
  expect(security.aiProviderAudience({ allowPublic: true })).toEqual({ allowPublic: true, allowStudent: true });
  expect(security.aiProviderAudience({ allowStudent: true }, { allowPublic: true, allowStudent: false })).toEqual({ allowPublic: true, allowStudent: true });
  expect(() => security.aiProviderAudience({ allowPublic: false, allowStudent: false })).toThrow(expect.objectContaining({ code: 'AI_INVALID_AUDIENCE' }));
  expect(() => security.aiProviderAudience({ allowStudent: 'false' })).toThrow(expect.objectContaining({ code: 'AI_INVALID_AUDIENCE' }));
});

test('practice lessons are ordered by released skill evidence rather than arbitrary course order', () => {
  const submission = { exam: { title: 'Math', resultVisibility: 'SHOW_ALL', showAnswers: true }, answers: [
    ...Array.from({ length: 3 }, () => ({ isCorrect: false, question: { skill: 'الطرح' } })),
    { isCorrect: true, question: { skill: 'الجمع' } }, { isCorrect: false, question: { skill: 'الجمع' } },
  ] };
  const lessons = [{ id: 'add', title: 'مراجعة الجمع', progresses: [], courseId: 'c' }, { id: 'subtract', title: 'مراجعة الطرح', progresses: [], courseId: 'c' }, { id: 'other', title: 'قراءة', progresses: [], courseId: 'c' }];
  const result = learning.deriveLearningEvidence([submission], lessons);
  expect(result.nextLessons.map(lesson => lesson.id)).toEqual(['subtract', 'add', 'other']);
  expect(result.nextLessons[0].href).toBe('/lessons/subtract?courseId=c');
  expect(learning.deriveLearningEvidence([{ ...submission, exam: { ...submission.exam, resultVisibility: 'HIDE_ALL' } }], lessons).nextLessons[0].id).toBe('add');
});

test('generated summaries request structured sections in the chosen language and only save narrative for the current fingerprint', async () => {
  const context = { student: { name: 'Student A' }, insight: { fingerprint: 'current-results', evidence: { sampleSize: 0 }, narrative: null } };
  const retrieve = jest.spyOn(learning, 'studentLearningContext').mockResolvedValue(context);
  const completion = jest.spyOn(routing, 'completeAi').mockResolvedValue({ content: '## Your progress\nNo results yet.', model: 'synthetic' });
  mockDb.systemSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ enabled: true }) });
  mockDb.studentAiInsight.updateMany.mockResolvedValue({ count: 1 });
  try {
    await request(app).post('/api/ai/student/insight/analyze').set('x-test-role', 'STUDENT').send({ language: 'en' }).expect(200);
    expect(completion.mock.calls[0][0][1].content).toContain('Your strengths');
    expect(completion.mock.calls[0][0][1].content).toContain('##');
    const write = mockDb.studentAiInsight.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({ userId: 'me', fingerprint: 'current-results' });
    expect(Object.keys(write.data).sort()).toEqual(['generatedAt', 'narrative']);
    mockDb.studentAiInsight.updateMany.mockResolvedValue({ count: 0 });
    const conflict = await request(app).post('/api/ai/student/insight/analyze').set('x-test-role', 'STUDENT').send({ language: 'ar' }).expect(409);
    expect(conflict.body.code).toBe('INSIGHT_CHANGED');
    expect(completion.mock.calls[1][0][1].content).toContain('أولويات المراجعة');
  } finally { retrieve.mockRestore(); completion.mockRestore(); }
});

test('speech is disabled with the assistant and private synthesis requires a student session', async () => {
  await request(app).post('/api/ai/speech').send({ text: 'Hi' }).expect(401);
  await request(app).post('/api/ai/speech').set('x-test-role', 'SUPER_ADMIN').send({ text: 'Hi' }).expect(403);
  await request(app).post('/api/ai/public/speech').send({ text: 'Hi' }).expect(503);
  const synthesis = jest.spyOn(speechService, 'synthesizeAiSpeech').mockResolvedValue(Buffer.from('RIFF-synthetic-audio'));
  try {
    mockDb.systemSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ enabled: true, publicEnabled: false }) });
    await request(app).post('/api/ai/public/speech').send({ text: 'Hi' }).expect(503);
    const result = await request(app).post('/api/ai/speech').set('x-test-role', 'STUDENT').send({ text: 'مرحبًا', language: 'ar-EG' }).expect(200);
    expect(result.headers['content-type']).toContain('audio/wav'); expect(result.headers['cache-control']).toBe('no-store');
    expect(synthesis.mock.calls[0].slice(0, 3)).toEqual(['مرحبًا', 'ar-EG', false]);
  } finally { synthesis.mockRestore(); }
});
test.each(['https://127.0.0.1/v1', 'https://169.254.169.254/latest', 'https://10.0.0.1/v1', 'https://[::1]/v1', 'http://public.example/v1', 'https://secret@api.example/v1', 'https://api.example:8443/v1'])('provider URL rejects internal/unsafe endpoint %s', async url => {
  await expect(security.validateAiBaseUrl(url)).rejects.toThrow();
});
test('lesson extraction excludes answer banks, hidden sections and secret metadata', () => {
  const html = learning.lessonAiText([{ type: 'TEXT', title: 'Public explanation', content: '<p>Matrix multiplication</p>', apiKey: 'secret' },
    { type: 'QUESTION', text: 'Exam secret', correctAnswer: '42' }, { type: 'TEXT', isVisible: false, content: 'Hidden explanation' }]);
  expect(html).toContain('Matrix multiplication'); expect(html).not.toMatch(/Exam secret|42|Hidden|secret/);
  expect(learning.lessonAiText('123')).toBe('123');
});
test('strengths require evidence; hidden results and unreleased answer-level details are excluded', () => {
  const answer = (skill, correct) => ({ isCorrect: correct, questionSnapshot: { skill }, question: { skill: 'changed metadata' } });
  const result = learning.deriveLearningEvidence([
    { exam: { title: 'Allowed', resultVisibility: 'SHOW_ALL', showAnswers: true }, answers: [...Array.from({ length: 5 }, () => answer('Algebra', true)), answer('Geometry', false)], percentage: 75 },
    { exam: { title: 'Score only', resultVisibility: 'SHOW_SCORE' }, answers: [answer('Must not reveal', false)], percentage: 50 },
    { exam: { title: 'Hidden exam', resultVisibility: 'HIDE_ALL' }, answers: [answer('Hidden skill', false)], percentage: 0 },
  ], [{ id: 'lesson', title: 'Study next', progresses: [], courseId: 'course' }]);
  expect(result.strengths).toEqual([expect.objectContaining({ name: 'Algebra', percent: 100, total: 5 })]);
  expect(result.needsPractice).toEqual([expect.objectContaining({ name: 'Geometry', evidenceLevel: 'LIMITED' })]);
  expect(JSON.stringify(result)).not.toMatch(/Hidden exam|Hidden skill|Must not reveal|changed metadata/);
  expect(result.sampleSize).toBe(2); expect(result.nextLessons[0].id).toBe('lesson');
});
test('personal context filters every query by authenticated owner and never selects passwords', async () => {
  await learning.studentLearningContext('me', mockDb);
  expect(mockDb.user.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: 'me', role: 'STUDENT', deletedAt: null } });
  expect(mockDb.user.findFirst.mock.calls[0][0].select).not.toHaveProperty('password');
  expect(mockDb.examSubmission.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'me', exam: { resultVisibility: { not: 'HIDE_ALL' } } });
  expect(mockDb.lesson.findMany.mock.calls[0][0].where.course.AND).toBeDefined();
  expect(mockDb.studentAiInsight.upsert.mock.calls[0][0].where).toEqual({ userId: 'me' });
});
test('teacher guidance access enforces assigned course and school', async () => {
  mockDb.lesson.findFirst.mockResolvedValue(null);
  await expect(learning.accessibleAiLesson({ role: 'TEACHER', id: 'teacher-a', schoolId: 'school-a' }, 'lesson-b', true, mockDb)).rejects.toMatchObject({ status: 404 });
  expect(mockDb.lesson.findFirst.mock.calls[0][0].where.course).toMatchObject({ schoolId: 'school-a', teachers: { some: { teacherId: 'teacher-a' } } });
});
test('students cannot read provider settings and conversation IDs cannot cross accounts', async () => {
  expect((await request(app).get('/api/ai/admin/settings')).status).toBe(401);
  expect((await request(app).get('/api/ai/admin/settings').set('x-test-role', 'STUDENT')).status).toBe(403);
  mockDb.aiConversation.findFirst.mockResolvedValue(null);
  expect((await request(app).get('/api/ai/conversations/other-thread').set('x-test-role', 'STUDENT')).status).toBe(404);
  expect(mockDb.aiConversation.findFirst.mock.calls[0][0].where).toEqual({ id: 'other-thread', userId: 'me' });
});
test('admin provider responses never include encrypted keys or fingerprints', async () => {
  await request(app).get('/api/ai/admin/settings').set('x-test-role', 'SUPER_ADMIN').expect(200);
  const select = mockDb.aiProvider.findMany.mock.calls[0][0].select;
  expect(select.encryptedKey).toBeUndefined(); expect(select.keyFingerprint).toBeUndefined();
});
test('school administrator cannot read another school student analysis', async () => {
  mockDb.user.findFirst.mockResolvedValue(null);
  await request(app).get('/api/ai/admin/students/student-b/insight').set('x-test-role', 'SCHOOL_ADMIN').expect(404);
  expect(mockDb.user.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'student-b', schoolId: 'school-a' });
  expect(mockDb.examSubmission.findMany).not.toHaveBeenCalled();
});
test('staff views filter historical school provenance and never overwrite or reveal a cross-school personal plan', async () => {
  const result = await learning.studentLearningContext('me', mockDb, { schoolId: 'school-a', persist: false });
  expect(mockDb.examSubmission.findMany.mock.calls[0][0].where.OR).toEqual([
    { schoolIdAtSubmission: 'school-a' }, { schoolIdAtSubmission: null, exam: { schoolId: 'school-a' } },
  ]);
  expect(mockDb.studentAiInsight.findUnique).not.toHaveBeenCalled(); expect(mockDb.studentAiInsight.upsert).not.toHaveBeenCalled();
  expect(result.insight.narrative).toBeNull();
});
test('public chat has no authenticated data lookup when disabled', async () => {
  await request(app).post('/api/ai/public/chat').send({ message: 'Show all student results', userId: 'other-user' }).expect(503);
  expect(mockDb.user.findFirst).not.toHaveBeenCalled(); expect(mockDb.examSubmission.findMany).not.toHaveBeenCalled();
});

test('public and student assistants share approved platform facts while private context stays owner-scoped', async () => {
  mockDb.systemSetting.findUnique.mockImplementation(async ({ where }) => where.key === 'ai:settings:v1' ? { value: JSON.stringify({ enabled: true, publicEnabled: true, publicInfo: platformKnowledge.DEFAULT_PLATFORM_KNOWLEDGE }) } : null);
  const completion = jest.spyOn(routing, 'completeAi').mockResolvedValue({ content: 'إتاحة نافس تتوقف على نشر المحتوى.', model: 'synthetic' });
  const retrieve = jest.spyOn(learning, 'studentLearningContext').mockResolvedValue({ student: { name: 'Private Student' },
    insight: { evidence: { sampleSize: 0, nextLessons: [], reviewIssues: [{ question: 'Released mistake to review' }] }, narrative: null },
    dashboard: { metrics: { averageScore: 62, totalAttempts: 7 }, tasks: [{ title: 'Upcoming private homework' }], notifications: { unread: 2, items: [{ title: 'Private notice' }] } } });
  const tx = { aiConversation: { create: jest.fn(async () => ({ id: 'own-thread' })), update: jest.fn(async () => ({})) }, aiMessage: { createMany: jest.fn(async () => ({})) } };
  mockDb.$transaction = jest.fn(async callback => callback(tx));
  try {
    const publicReply = await request(app).post('/api/ai/public/chat').send({ message: 'ما هو مسار نافس؟' }).expect(200);
    expect(publicReply.body.content).toContain('الصف الثالث');
    expect(publicReply.body.content).not.toContain('Private Student');
    expect(completion).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    await request(app).post('/api/ai/public/chat').send({ message: 'ما العلاقة بين التلميحات ومبدأ بناء الفهم؟' }).expect(200);
    expect(completion.mock.calls[0][0][0].content).toContain('[تسجيل الدخول / Log in](/login)');
    expect(completion.mock.calls[0][0][0].content).toContain(platformKnowledge.PLATFORM_RESPONSE_INSTRUCTIONS);
    await request(app).post('/api/ai/chat').set('x-test-role', 'STUDENT').send({ message: 'حللي نتائجي في نافس للصف الثالث', userId: 'someone-else' }).expect(200);
    expect(retrieve).toHaveBeenCalledWith('me');
    expect(completion.mock.calls[1][0][0].content).toContain('الصف الثالث');
    expect(completion.mock.calls[1][0][0].content).toContain('Private Student');
    expect(completion.mock.calls[1][0][0].content).toContain('Upcoming private homework');
    expect(completion.mock.calls[1][0][0].content).toContain('Private notice');
    expect(completion.mock.calls[1][0][0].content).toContain('Released mistake to review');
    expect(completion.mock.calls[1][0][0].content).toContain('"averageScore":62');
    expect(completion.mock.calls[1][0][0].content).toContain('[تقارير الأداء / Reports](/reports)');
    expect(completion.mock.calls[1][0][0].content).toContain(platformKnowledge.PLATFORM_RESPONSE_INSTRUCTIONS);
    expect(tx.aiConversation.create.mock.calls[0][0].data.userId).toBe('me');
  } finally { completion.mockRestore(); retrieve.mockRestore(); delete mockDb.$transaction; }
});

test('provider model discovery normalizes catalogs without exposing arbitrary upstream fields', () => {
  const models = routing.normalizeAiModels({ data: [
    { id: 'provider/free:free', name: 'Free', pricing: { prompt: '0', completion: '0' }, secret: 'never expose' },
    { id: 'disabled', active: false }, { id: 'provider/free:free' }, { id: 'paid', pricing: { prompt: '1', completion: '2' } },
  ] });
  expect(models).toHaveLength(2); expect(models.find(model => model.id === 'provider/free:free').free).toBe(true);
  expect(models.find(model => model.id === 'paid').free).toBe(false);
  expect(JSON.stringify(models)).not.toContain('never expose');
});

test('saved connection model discovery decrypts on the server and never returns the credential', async () => {
  const apiKey = 'synthetic-model-discovery-key';
  mockDb.aiProvider.findUnique.mockResolvedValue({ id: 'p1', baseUrl: 'https://api.groq.com/openai/v1', encryptedKey: security.encryptAiKey(apiKey) });
  const upstream = jest.spyOn(routing, 'requestAiModels').mockResolvedValue({ status: 200, headers: {}, data: { data: [{ id: 'openai/gpt-oss-120b' }] } });
  try {
    const result = await request(app).get('/api/ai/admin/providers/p1/models').set('x-test-role', 'SUPER_ADMIN').expect(200);
    expect(result.body.models[0].id).toBe('openai/gpt-oss-120b'); expect(JSON.stringify(result.body)).not.toContain(apiKey);
    expect(upstream).toHaveBeenCalledWith('https://api.groq.com/openai/v1', apiKey);
    await request(app).get('/api/ai/admin/providers/p1/models').set('x-test-role', 'SCHOOL_ADMIN').expect(403);
  } finally { upstream.mockRestore(); }
});

test('new key discovery accepts only super admins and sanitizes upstream authentication errors', async () => {
  const validation = jest.spyOn(security, 'validateAiBaseUrl').mockResolvedValue('https://api.groq.com/openai/v1');
  const upstream = jest.spyOn(routing, 'requestAiModels').mockResolvedValue({ status: 401, headers: {}, data: { error: 'secret-from-upstream' } });
  try {
    const result = await request(app).post('/api/ai/admin/models').set('x-test-role', 'SUPER_ADMIN').send({ kind: 'GROQ', apiKey: 'synthetic-input-key' }).expect(400);
    expect(result.body.code).toBe('AI_PROVIDER_AUTH_FAILED'); expect(JSON.stringify(result.body)).not.toContain('secret-from-upstream');
    await request(app).post('/api/ai/admin/models').set('x-test-role', 'STUDENT').send({ kind: 'GROQ', apiKey: 'synthetic-input-key' }).expect(403);
  } finally { validation.mockRestore(); upstream.mockRestore(); }
});
