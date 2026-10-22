require('ts-node/register/transpile-only');
const express = require('express'); const request = require('supertest');
let mockActor; let mockRoom; let mockEntry; let mockAnswers;
const delegate = () => ({ findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), upsert: jest.fn(), createMany: jest.fn(), groupBy: jest.fn() });
const mockDb = { competition: delegate(), competitionQuestion: delegate(), competitionEntry: delegate(), competitionAnswer: delegate(), competitionAward: delegate(), competitionPolicy: delegate(), competitionProfile: delegate(), school: delegate(), user: delegate(), course: delegate(), exam: delegate(), skillCluster: delegate(), subExam: delegate(), examModule: delegate(), question: delegate(), interactiveActivity: delegate(), $executeRaw: jest.fn(), $transaction: jest.fn() };
jest.mock('../../src/lib/prisma', () => ({ __esModule: true, default: mockDb }));
jest.mock('../../src/middleware/auth', () => ({ verifyToken: (req, res, next) => { if (req.headers['x-anonymous']) return res.sendStatus(401); req.user = mockActor; next(); }, checkRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403) }));
jest.mock('../../src/shared', () => ({ sanitizeHtml: jest.requireActual('../../src/shared').sanitizeHtml, stripHtmlAndNormalize: jest.requireActual('../../src/shared').stripHtmlAndNormalize, normalizeTrueFalse: jest.requireActual('../../src/shared').normalizeTrueFalse, isAnswerCorrect: jest.requireActual('../../src/shared').isAnswerCorrect, allowedOrigins: ['http://localhost:3000'], isOriginAllowed: (origin, allowed) => allowed.includes(origin), getStudentGradeAndStage: grade => grade ? [grade] : [], examMatchesStudent: (exam, user) => (!exam.grade || exam.grade === user.grade) && (exam.schoolId === user.schoolId || exam.schools?.some(s => s.id === user.schoolId) || (exam.isCentral && !exam.schoolId && !exam.schools?.length)) }));
const { competitionPoints, validateCompetition, canManageCompetition, canPlayCompetition, periodStart } = require('../../src/lib/competitionPolicy');
const { competitionLeaderboard } = require('../../src/services/competitions');
const app = express(); app.use(express.json()); app.use(require('../../src/routes/competitions').default);
const input = () => ({ title: 'Real challenge', mode: 'SELF_PACED', sourceKind: 'GENERAL', questions: [{ text: '2 + 2?', options: ['4', '3'], correctIndex: 0, seconds: 30 }] });
beforeEach(() => {
  jest.resetAllMocks(); mockActor = { id: 'student', role: 'STUDENT', schoolId: 'own', grade: 'G1' }; mockAnswers = [];
  mockRoom = { id: 'room', title: 'Real challenge', mode: 'SELF_PACED', status: 'OPEN', schoolId: 'own', grade: 'G1', currentIndex: 0, questionStartedAt: new Date(Date.now() - 1000), opensAt: null, closesAt: null, questions: [{ id: 'q', text: '2 + 2?', options: ['4', '3'], correctIndex: 0, seconds: 30, order: 0 }], school: { name: 'School' }, _count: { questions: 1, entries: 1 }, capacity: 200, prizePlaces: 3 };
  mockEntry = { id: 'entry', competitionId: 'room', studentId: 'student', score: 0, correct: 0, team: 0, currentIndex: 0, questionStartedAt: new Date(Date.now() - 1000), finishedAt: null, createdAt: new Date('2020-01-01'), answers: mockAnswers, award: null };
  mockDb.$transaction.mockImplementation(fn => fn(mockDb)); mockDb.competition.findUnique.mockImplementation(async () => mockRoom); mockDb.competitionEntry.findUnique.mockImplementation(async () => mockEntry);
  mockDb.competitionPolicy.findMany.mockResolvedValue([]); mockDb.competitionEntry.findMany.mockResolvedValue([]); mockDb.competitionEntry.count.mockResolvedValue(0); mockDb.competitionEntry.groupBy.mockResolvedValue([]); mockDb.competitionAward.findMany.mockResolvedValue([]);
  mockDb.competitionAnswer.findUnique.mockImplementation(async ({ where }) => mockAnswers.find(a => a.questionId === where.entryId_questionId.questionId) || null);
  mockDb.competitionAnswer.create.mockImplementation(async ({ data }) => { const answer = { id: 'answer', ...data }; mockAnswers.unshift(answer); return answer; });
  mockDb.competitionEntry.update.mockImplementation(async ({ data }) => { for (const [key, value] of Object.entries(data)) mockEntry[key] = value && typeof value === 'object' && 'increment' in value ? mockEntry[key] + value.increment : value; return mockEntry; });
});
test('standalone competitions are available only to school/platform administrators', async () => {
  for (const role of ['STUDENT', 'TEACHER', 'PARENT']) { mockActor.role = role; await request(app).post('/api/competitions/manage').send(input()).expect(403); }
  mockActor.role = 'SCHOOL_ADMIN'; mockDb.school.findFirst.mockResolvedValue({ id: 'own' }); mockDb.competition.create.mockResolvedValue({ id: 'new-room' }); await request(app).post('/api/competitions/manage').send(input()).expect(201);
  expect(mockDb.competition.create.mock.calls[0][0].data).toMatchObject({ schoolId: 'own', creatorId: 'student', questions: { create: expect.any(Array) } });
});

test.each(['SUPER_ADMIN', 'SCHOOL_ADMIN'])('%s can preview finished questions and grade a dry run without saving participation', async role => {
  mockActor.role = role; mockRoom.status = 'FINISHED'; mockRoom.scoringMode = 'POINTS';
  const preview = await request(app).get('/api/competitions/manage/room/preview').expect(200);
  expect(preview.body).toMatchObject({ preview: true, room: { status: 'FINISHED' }, questions: [{ id: 'q', options: ['4', '3'] }] });
  expect(preview.body.questions[0].correctAnswer).toBeUndefined(); expect(preview.body.questions[0].correctIndex).toBeUndefined();
  const answer = await request(app).post('/api/competitions/manage/room/preview-answer').send({ questionId: 'q', selectedIndex: 0, language: 'ar', elapsedMs: 1000 }).expect(200);
  expect(answer.body).toMatchObject({ preview: true, correct: true, points: 100, correctAnswer: '4' });
  expect(mockDb.competitionEntry.create).not.toHaveBeenCalled(); expect(mockDb.competitionEntry.update).not.toHaveBeenCalled();
  expect(mockDb.competitionAnswer.create).not.toHaveBeenCalled(); expect(mockDb.competitionAward.createMany).not.toHaveBeenCalled();
  expect(mockDb.competitionProfile.upsert).not.toHaveBeenCalled(); expect(mockDb.competition.update).not.toHaveBeenCalled();
});

test('preview permission follows the managing administrator school and rejects other roles', async () => {
  for (const role of ['STUDENT', 'TEACHER', 'PARENT']) {
    mockActor.role = role;
    await request(app).get('/api/competitions/manage/room/preview').expect(403);
    await request(app).post('/api/competitions/manage/room/preview-answer').send({}).expect(403);
  }
  mockActor.role = 'SCHOOL_ADMIN'; mockRoom.schoolId = 'other';
  await request(app).get('/api/competitions/manage/room/preview').expect(404);
  await request(app).post('/api/competitions/manage/room/preview-answer').send({}).expect(404);
  mockActor.role = 'SUPER_ADMIN';
  await request(app).get('/api/competitions/manage/room/preview').expect(200);
});

test('preview uses stored answer keys, translations, timing and scoring; malformed or foreign questions are rejected', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; mockRoom.status = 'DRAFT'; mockRoom.scoringMode = 'POINTS';
  mockRoom.questions[0] = { ...mockRoom.questions[0], type: 'MCQ', options: ['أربعة', 'صفر'], optionsEn: ['four', 'zero'], correctAnswer: 'أربعة', correctAnswerEn: 'four' };
  const send = body => request(app).post('/api/competitions/manage/room/preview-answer').send({ questionId: 'q', language: 'en', elapsedMs: 1000, ...body });
  expect((await send({ selectedIndex: 0, score: 99999 }).expect(200)).body).toMatchObject({ correct: true, points: 100, correctAnswerEn: 'four' });
  expect((await send({ selectedIndex: 0, elapsedMs: 31000 }).expect(200)).body).toMatchObject({ correct: false, points: 0 });
  await send({ questionId: 'foreign', selectedIndex: 0 }).expect(404);
  for (const body of [{ elapsedMs: -1 }, { elapsedMs: '1' }, { language: 'fr' }, { selectedIndex: 100 }]) await send(body).expect(400);
});
test('school admins cannot create for, manage, or award another school', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; await request(app).post('/api/competitions/manage').send({ ...input(), schoolId: 'other' }).expect(403);
  mockRoom.schoolId = 'other'; await request(app).post('/api/competitions/manage/room/action').send({ action: 'publish' }).expect(404);
  await request(app).patch('/api/competitions/manage/room/awards/a').send({}).expect(404); expect(mockDb.competitionAward.updateMany).not.toHaveBeenCalled();
});

test('question import requires an administrator and scopes every exam to their accessible schools', async () => {
  await request(app).get('/api/competitions/manage/import?kind=EXAM&sourceId=exam').expect(403);
  mockActor.role = 'TEACHER'; await request(app).get('/api/competitions/manage/import?kind=EXAM&sourceId=exam').expect(403);
  mockActor.role = 'SCHOOL_ADMIN'; mockDb.exam.findFirst.mockResolvedValue(null);
  await request(app).get('/api/competitions/manage/import?kind=EXAM&sourceId=foreign').expect(404);
  expect(mockDb.exam.findFirst.mock.calls[0][0].where).toEqual({ id: 'foreign', deletedAt: null, OR: [{ schoolId: 'own' }, { isCentral: true }, { schools: { some: { id: 'own' } } }] });
  expect(mockDb.question.findMany).not.toHaveBeenCalled();
});
test('exam import copies supported questions from a real child, reports unsupported formats and never changes originals', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; mockDb.exam.findFirst.mockResolvedValue({ id: 'exam', title: 'Original exam', modules: [{ id: 'module', title: 'Unit', subExams: [{ id: 'child', title: 'Child exam' }] }] });
  mockDb.question.findMany.mockResolvedValue([{ id: 'q1', text: 'Saved question', type: 'MCQ', options: '["A","B"]', correctAnswer: 'B' }, { id: 'q2', text: 'Saved matching', type: 'UNSUPPORTED_FORMAT' }]); mockDb.question.count.mockResolvedValue(3);
  const result = await request(app).get('/api/competitions/manage/import?kind=EXAM&sourceId=exam&section=sub:child&seconds=45').expect(200);
  expect(mockDb.question.findMany.mock.calls[0][0].where).toEqual({ examId: 'exam', deletedAt: null, subExamId: 'child' });
  expect(result.body).toMatchObject({ total: 3, nextOffset: 2, items: [{ key: 'exam:exam:q1', supported: true, question: { text: 'Saved question', options: ['A', 'B'], correctIndex: 1, seconds: 45 } }, { key: 'exam:exam:q2', supported: false }] });
  expect(mockDb.competition.create).not.toHaveBeenCalled(); expect(mockDb.question.update).not.toHaveBeenCalled(); expect(mockDb.exam.update).not.toHaveBeenCalled();
  await request(app).get('/api/competitions/manage/import?kind=EXAM&sourceId=exam&section=sub:foreign').expect(404);
});
test('course import reads lesson quizzes, assignments and blocks, with lesson selection and read-only pagination', async () => {
  mockActor.role = 'SUPER_ADMIN'; mockDb.course.findFirst.mockResolvedValue({ id: 'course', title: 'Course', lessons: [{ id: 'lesson', title: 'Lesson', questions: [{ id: 'quiz', text: 'Quiz question', type: 'MCQ', options: ['A', 'B'], correctAnswer: 'A' }], assignments: JSON.stringify([{ id: 'assignment', questionText: 'Assignment question', type: 'MCQ', options: { choices: ['C', 'D'] }, correctAnswer: 'D' }]), slides: [], blocks: [{ id: 'block', type: 'MCQ', content: 'Block question', options: '["E","F"]', correctAnswer: 'F' }] }] });
  const result = await request(app).get('/api/competitions/manage/import?kind=COURSE&sourceId=course&section=lesson').expect(200);
  expect(result.body.total).toBe(3); expect(result.body.items.every(item => item.supported)).toBe(true); expect(result.body.items.map(item => item.question.correctIndex)).toEqual([0, 1, 1]);
  expect(result.body.items[0].key).toContain('course:course:lesson:questions:quiz'); expect(mockDb.course.findFirst.mock.calls[0][0].where).toEqual({ id: 'course', deletedAt: null });
  expect(mockDb.course.update).not.toHaveBeenCalled(); expect(mockDb.competition.create).not.toHaveBeenCalled();
  await request(app).get('/api/competitions/manage/import?kind=COURSE&sourceId=course&section=foreign').expect(404);
});
test('integration authoring is disabled while protected linked records retain source access checks', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; await request(app).put('/api/competitions/content').send({}).expect(410);
  expect(mockDb.competition.create).not.toHaveBeenCalled();
  mockActor.role = 'STUDENT'; mockRoom.sourceKind = 'CONTENT_SUB_EXAM'; mockRoom.sourceId = 'private-child'; mockDb.subExam.findUnique.mockResolvedValue(null);
  await request(app).get('/api/competitions/room').expect(404); expect(mockDb.competitionEntry.create).not.toHaveBeenCalled();
});

test('legacy course question indices keep the original correct option when numeric choice text is ambiguous', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; mockDb.course.findFirst.mockResolvedValue({ id: 'course', lessons: [{ id: 'lesson', title: 'Lesson', questions: [{ id: 'q', type: 'QUESTION', text: 'Legacy question', options: ['First', '0'], correctAnswer: 0 }], assignments: [], slides: [], blocks: [] }] });
  const result = await request(app).get('/api/competitions/manage/import?kind=COURSE&sourceId=course').expect(200);
  expect(result.body.items[0]).toMatchObject({ supported: true, question: { options: ['First', '0'], correctIndex: 0 } });
});

test('student reads never reveal the active answer key or other players private answers', async () => {
  const result = await request(app).get('/api/competitions/room').expect(200);
  expect(result.body.question).toMatchObject({ id: 'q', options: ['4', '3'] }); expect(result.body.question.correctIndex).toBeUndefined(); expect(result.body.questions).toBeUndefined(); expect(result.body.entry.answers).toBeUndefined();
  mockRoom.schoolId = 'other'; await request(app).get('/api/competitions/room').expect(404);
  mockRoom.schoolId = 'own'; mockRoom.grade = 'G2'; await request(app).get('/api/competitions/room').expect(404);
});
test('points and elapsed time come from the server; one answer never changes academic XP', async () => {
  await request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 0, score: 9999999, elapsedMs: 0 }).expect(200);
  const answer = mockDb.competitionAnswer.create.mock.calls[0][0].data; expect(answer.points).toBeGreaterThanOrEqual(100); expect(answer.points).toBeLessThanOrEqual(150); expect(answer.elapsedMs).toBeGreaterThanOrEqual(1000); expect(mockEntry.score).toBe(answer.points); expect(mockEntry.finishedAt).toBeInstanceOf(Date);
  expect(mockDb.user.update).not.toHaveBeenCalled(); expect(mockDb.exam.create).not.toHaveBeenCalled();
  await request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 0, score: 9999999 }).expect(200); expect(mockDb.competitionAnswer.create).toHaveBeenCalledTimes(1);
});
test('expired questions score zero and invalid choices are rejected', async () => {
  mockEntry.questionStartedAt = new Date(Date.now() - 60000); await request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 0 }).expect(200); expect(mockAnswers[0]).toMatchObject({ points: 0, correct: false });
  mockEntry.finishedAt = null; mockEntry.currentIndex = 0; mockEntry.questionStartedAt = new Date(); mockAnswers.splice(0); await request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 99 }).expect(400);
});

test('numeric option text is never treated as an option index or letter', async () => {
  mockRoom.questions[0] = { ...mockRoom.questions[0], options: ['4', '0'], correctAnswer: '4', correctIndex: 0 };
  await request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 1, answer: '0' }).expect(200);
  expect(mockAnswers[0]).toMatchObject({ correct: false, points: 0 });
  expect(mockEntry.score).toBe(0);
});

test('ranked grading rejects additional values, duplicate matches and partial text', () => {
  const { competitionAnswerCorrect: correct } = require('../../src/lib/competitionQuestions');
  const multi = { type: 'MULTI_SELECT', options: ['2', '3', '4'], optionsEn: ['two', 'three', 'four'], correctAnswer: ['2', '4'], correctAnswerEn: ['two', 'four'] };
  expect(correct(multi, ['2', '4', 'bogus'])).toBe(false);
  expect(correct(multi, ['2', '2'])).toBe(false);
  expect(correct(multi, ['0', '2'])).toBe(false);
  expect(correct(multi, ['4', '2'])).toBe(true);
  expect(correct(multi, ['four', 'two'], 'en')).toBe(true);
  expect(correct({ type: 'MCQ', correctAnswer: 'one two three' }, 'one two three extra')).toBe(false);
  const memory = { type: 'MEMORY_GAME', options: { pairs: [{ left: 'A', right: 'B' }, { left: 'C', right: 'D' }] }, correctAnswer: [0, 1] };
  for (const value of [['fake', 'fake'], [0, 0], [-1, 1], [0, 2]]) expect(correct(memory, value)).toBe(false);
  expect(correct(memory, '[1,0]')).toBe(true);
  expect(correct({ type: 'MATCHING', correctAnswer: { a: { x: 'right' } } }, { a: { x: 'wrong' } })).toBe(false);
  expect(correct({ type: 'IMAGE_LABEL', correctAnswer: { a: 'right' } }, { a: 'right', extra: 'wrong' })).toBe(false);
});

test('interactive options are stable across polling and never mutate stored answer data', () => {
  const { publicCompetitionOptions: publicOptions } = require('../../src/lib/competitionQuestions');
  for (const [type, options] of [
    ['WORD_SCRAMBLE', { word: 'LEARNING', answer: 'LEARNING' }],
    ['SEQUENCE_ORDER', { items: ['first', 'second', 'third'] }],
    ['SENTENCE_REORDER', { words: ['one', 'two', 'three'] }],
    ['MATCHING', { left: ['A', 'B'], right: ['one', 'two'], solution: { A: 'one' } }],
    ['CROSSWORD', { words: [{ word: 'SECRET', clue: 'A clue' }] }],
  ]) {
    const original = JSON.stringify(options);
    const first = publicOptions(options, type, 'question');
    expect(publicOptions(options, type, 'question')).toEqual(first);
    expect(JSON.stringify(options)).toBe(original);
    expect(first.answer).toBeUndefined(); expect(first.solution).toBeUndefined();
    if (type === 'WORD_SCRAMBLE') expect(first.word).toBeUndefined();
    if (type === 'CROSSWORD') expect(first.words).toEqual([{ clue: 'A clue', length: 6 }]);
  }
});

test('result pagination remains bounded for infinity and oversized input', async () => {
  mockActor.role = 'SCHOOL_ADMIN';
  await request(app).get('/api/competitions/manage/room/results?page=Infinity').expect(200);
  expect(mockDb.competitionEntry.findMany.mock.calls[0][0].skip).toBe(0);
  await request(app).get('/api/competitions/manage/room/results?page=1e99').expect(200);
  expect(mockDb.competitionEntry.findMany.mock.calls[1][0].skip).toBe(100000);
});
test('live answers are idempotent and stale questions cannot earn points', async () => {
  mockRoom.mode = 'LIVE'; const call = () => request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 0 }); await call().expect(200); const score = mockEntry.score; await call().expect(200); expect(mockEntry.score).toBe(score); expect(mockDb.competitionAnswer.create).toHaveBeenCalledTimes(1);
  await request(app).post('/api/competitions/room/answer').send({ questionId: 'another-question', selectedIndex: 0 }).expect(409);
});
test('schedules, draft status, capacity and disabled policies are enforced by the server', async () => {
  mockRoom.opensAt = new Date('2099-01-01'); await request(app).post('/api/competitions/room/join').send({}).expect(409);
  mockRoom.opensAt = null; mockRoom.status = 'DRAFT'; await request(app).post('/api/competitions/room/join').send({}).expect(404);
  mockRoom.status = 'OPEN'; mockDb.competitionEntry.findUnique.mockResolvedValue(null); mockDb.competitionEntry.count.mockResolvedValue(200); await request(app).post('/api/competitions/room/join').send({}).expect(409);
  mockDb.competitionPolicy.findMany.mockResolvedValue([{ key: 'platform', enabled: false }]); await request(app).post('/api/competitions/room/join').send({}).expect(403);
});
test('stale live next actions cannot skip questions twice', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; mockRoom.mode = 'LIVE'; mockRoom.questions.push({ ...mockRoom.questions[0], id: 'q2', order: 1 }); await request(app).post('/api/competitions/manage/room/action').send({ action: 'next', expectedIndex: 8 }).expect(409); expect(mockDb.competition.update).not.toHaveBeenCalled();
});

test('published question changes retain previous attempts and create active question versions without deleting answers', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; mockDb.competitionEntry.count.mockResolvedValue(1);
  mockDb.competitionQuestion.findFirst.mockResolvedValue({ order: 0 });
  mockDb.competition.update.mockResolvedValue({ id: 'room' });
  const changed = input(); changed.questions[0].text = 'New version';
  await request(app).patch('/api/competitions/manage/room').send({ ...changed, grade: 'G1' }).expect(200);
  expect(mockDb.competitionEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { questionSnapshot: expect.arrayContaining([expect.objectContaining({ id: 'q', text: '2 + 2?' })]) } }));
  expect(mockDb.competitionQuestion.updateMany).toHaveBeenCalledWith({ where: { competitionId: 'room', active: true }, data: { active: false } });
  expect(mockDb.competitionQuestion.createMany.mock.calls[0][0].data[0]).toMatchObject({ text: 'New version', active: true, competitionId: 'room' });
  expect(mockDb.competition.update.mock.calls[0][0].data.questions).toBeUndefined();
  expect(mockDb.competitionAnswer.updateMany).not.toHaveBeenCalled();
  expect(mockDb.competition.update.mock.calls[0][0].data.status).toBeUndefined();
});

test('existing entrants answer their original question set after the competition is edited', async () => {
  mockEntry.questionSnapshot = JSON.parse(JSON.stringify(mockRoom.questions));
  mockRoom.questions = [{ ...mockRoom.questions[0], id: 'replacement', options: ['Wrong', 'New key'], correctIndex: 1 }, { ...mockRoom.questions[0], id: 'extra' }];
  const result = await request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 0 }).expect(200);
  expect(mockAnswers[0]).toMatchObject({ questionId: 'q', correct: true });
  expect(mockEntry.finishedAt).toBeInstanceOf(Date);
  expect(result.body.room.questionCount).toBe(1);
});

test('live question sets stay fixed for joined players until the round closes', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; mockDb.competitionEntry.count.mockResolvedValue(1); mockRoom.mode = 'LIVE'; mockRoom.currentIndex = -1;
  const changed = input(); changed.mode = 'LIVE'; changed.questions[0].text = 'Revised live question';
  await request(app).patch('/api/competitions/manage/room').send({ ...changed, grade: 'G1' }).expect(409);
  expect(mockDb.competitionQuestion.createMany).not.toHaveBeenCalled();
  expect(mockDb.competition.update).not.toHaveBeenCalled();
});

test('result lists show full names and all participants with pagination and scoped search', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; mockDb.competitionEntry.count.mockResolvedValue(70);
  mockDb.competitionEntry.findMany.mockResolvedValue([{ id: 'entry', score: 100, correct: 1, questionSnapshot: mockRoom.questions, student: { id: 'student', name: 'Full Student Name', grade: 'G1' }, _count: { answers: 1 } }]);
  const result = await request(app).get('/api/competitions/manage/room/results?page=2&search=Student').expect(200);
  expect(result.body).toMatchObject({ total: 70, pages: 2, entries: [{ student: { name: 'Full Student Name' }, questionCount: 1, answered: 1 }] });
  expect(mockDb.competitionEntry.findMany.mock.calls[0][0]).toMatchObject({ take: 50, skip: 50, where: { competitionId: 'room', student: { name: { contains: 'Student', mode: 'insensitive' } } } });
});

test('student answer review uses saved keys and reports correct, incorrect, timed out and unanswered separately', async () => {
  mockActor.role = 'SUPER_ADMIN';
  const questions = [0, 1, 2, 3].map(index => ({ ...mockRoom.questions[0], id: 'old-' + index, text: 'Original ' + index }));
  mockDb.competitionEntry.findFirst.mockResolvedValue({ ...mockEntry, student: { name: 'Full Student Name' }, questionSnapshot: questions, answers: [
    { questionId: 'old-0', selectedIndex: 0, correct: true, points: 100, elapsedMs: 1000 },
    { questionId: 'old-1', answer: '3', correct: false, points: 0, elapsedMs: 1000 },
    { questionId: 'old-2', answer: null, selectedIndex: null, correct: false, points: 0, elapsedMs: 31000 },
  ] });
  const result = await request(app).get('/api/competitions/manage/room/results/entry').expect(200);
  expect(result.body.answers.map(item => item.status)).toEqual(['CORRECT', 'INCORRECT', 'TIMED_OUT', 'UNANSWERED']);
  expect(result.body.answers[0]).toMatchObject({ text: 'Original 0', correctAnswer: '4', answer: '4', points: 100 });
  expect(mockDb.competitionEntry.findFirst.mock.calls[0][0].where).toEqual({ id: 'entry', competitionId: 'room' });
});

test('private result lists and answers require an authorised school/platform administrator', async () => {
  for (const role of ['STUDENT', 'TEACHER', 'PARENT']) {
    mockActor.role = role;
    await request(app).get('/api/competitions/manage/room/results').expect(403);
    await request(app).get('/api/competitions/manage/room/results/entry').expect(403);
  }
  mockActor.role = 'SCHOOL_ADMIN'; mockRoom.schoolId = 'another';
  await request(app).get('/api/competitions/manage/room/results').expect(404);
  await request(app).get('/api/competitions/manage/room/results/entry').expect(404);
  mockActor.role = 'SUPER_ADMIN'; mockDb.competitionEntry.findFirst.mockResolvedValue(null);
  await request(app).get('/api/competitions/manage/room/results/foreign').expect(404);
});
test('prizes are persisted once after finalisation and delivery is school scoped', async () => {
  mockActor.role = 'SCHOOL_ADMIN'; mockRoom.prizeLabel = 'Achievement certificate'; mockDb.competitionEntry.findMany.mockResolvedValue([{ id: 'winner' }]); await request(app).post('/api/competitions/manage/room/action').send({ action: 'finish' }).expect(200);
  expect(mockDb.competitionAward.createMany).toHaveBeenCalledWith({ data: [{ entryId: 'winner', rank: 1, title: 'Achievement certificate' }], skipDuplicates: true }); expect(mockDb.competitionEntry.findMany.mock.calls[0][0].where.correct).toEqual({ gt: 0 });
});
test('public rankings require global, school, competition and student publication permission', async () => {
  mockDb.competitionPolicy.findUnique.mockResolvedValue(null); const off = await competitionLeaderboard(null); expect(off.enabled).toBe(false); expect(mockDb.competitionEntry.groupBy).not.toHaveBeenCalled();
  mockDb.competitionPolicy.findUnique.mockResolvedValue({ enabled: true, publicBoard: true, leaderboard: true }); mockDb.competitionPolicy.findMany.mockResolvedValue([{ key: 'school:own' }]); mockDb.user.findMany.mockResolvedValue([]); await competitionLeaderboard(null);
  const where = mockDb.competitionEntry.groupBy.mock.calls[0][0].where; expect(where.student).toMatchObject({ schoolId: { in: ['own'] }, competitionProfile: { is: { publicName: true } }, deletedAt: null }); expect(where.competition).toMatchObject({ publicBoard: true, status: 'FINISHED' });
});
test('students can change only their own competition preferences', async () => {
  mockDb.competitionProfile.upsert.mockResolvedValue({ publicName: false }); await request(app).put('/api/competitions/profile').send({ sound: false, motion: false, publicName: false, userId: 'victim' }).expect(200); expect(mockDb.competitionProfile.upsert.mock.calls[0][0].where).toEqual({ userId: 'student' });
});

test('sound changes never overwrite public-name consent and malformed preferences cannot be saved', async () => {
  await request(app).put('/api/competitions/profile').send({ sound: false }).expect(200);
  expect(mockDb.competitionProfile.upsert.mock.calls[0][0]).toMatchObject({ update: { sound: false }, create: { userId: 'student', sound: false } });
  expect(mockDb.competitionProfile.upsert.mock.calls[0][0].update.publicName).toBeUndefined();
  await request(app).put('/api/competitions/profile').send({ publicName: 'true' }).expect(400);
  await request(app).put('/api/competitions/profile').send({ userId: 'victim' }).expect(400);
});

test('duplicate earlier answers remain idempotent after advancing to the next question', async () => {
  mockRoom.questions.push({ ...mockRoom.questions[0], id: 'q2', order: 1 });
  await request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 0 }).expect(200);
  expect(mockEntry.currentIndex).toBe(1); const score = mockEntry.score;
  await request(app).post('/api/competitions/room/answer').send({ questionId: 'q', selectedIndex: 1 }).expect(200);
  expect(mockEntry.score).toBe(score); expect(mockDb.competitionAnswer.create).toHaveBeenCalledTimes(1);
});
test('question validation, score boundaries, role policies and Egypt schedules are deterministic', () => {
  expect(competitionPoints(true, 0, 30)).toBe(150); expect(competitionPoints(true, 30000, 30)).toBe(100); expect(competitionPoints(true, 30001, 30)).toBe(0); expect(competitionPoints(false, 0, 30)).toBe(0);
  expect(() => validateCompetition({ ...input(), questions: [{ ...input().questions[0], correctIndex: 20 }] })).toThrow(); expect(validateCompetition({ ...input(), opensAt: '2026-10-21T12:00' }).opensAt.toISOString()).toBe('2026-10-21T09:00:00.000Z');
  expect(canManageCompetition({ role: 'TEACHER', schoolId: 'own' }, mockRoom)).toBe(false); expect(canPlayCompetition(mockActor, mockRoom)).toBe(true); expect(periodStart('MONTH', new Date('2026-10-21T12:00:00Z')).toISOString()).toBe('2026-09-30T21:00:00.000Z');
});

test('exam transfer accepts stored string timing, numeric choice labels and bilingual metadata', async () => {
  mockActor.role = 'SUPER_ADMIN';
  mockDb.exam.findFirst.mockResolvedValue({ id: 'exam', title: 'Source', modules: [] });
  mockDb.question.findMany.mockResolvedValue([{ id: 'q', type: 'MCQ', text: 'س + 3 = 8', options: '["4","5"]', optionsEn: '["4","5"]', correctAnswer: '5', estimatedTime: '60', points: 2, hint: 'اطرح 3', hintEn: 'Subtract 3', explanation: 'س = 5', domain: 'الجبر', domainEn: 'Algebra' }]);
  mockDb.question.count.mockResolvedValue(1);
  const response = await request(app).get('/api/competitions/manage/import?kind=EXAM&sourceId=exam').expect(200);
  expect(response.body.items[0]).toMatchObject({ supported: true, question: { correctAnswer: '5', seconds: 60, points: 2, optionsEn: ['4', '5'], metadata: { hint: 'اطرح 3', hintEn: 'Subtract 3', explanation: 'س = 5', domain: 'الجبر', domainEn: 'Algebra' } } });
  expect(mockDb.question.update).not.toHaveBeenCalled();
});

test('subject options include the authoring catalog and every stored course/exam subject format', async () => {
  mockActor.role = 'SUPER_ADMIN';
  mockDb.course.findMany.mockResolvedValue([{ subject: '["مادة مخصصة","مادة ثانية"]' }]);
  mockDb.exam.findMany.mockResolvedValue([{ category: 'تصنيف مخصص', subjects: 'مادة نصية، مادة إضافية' }]);
  mockDb.skillCluster.findMany.mockResolvedValue([]); mockDb.school.findMany.mockResolvedValue([]); mockDb.user.groupBy.mockResolvedValue([]);
  const response = await request(app).get('/api/competitions/manage/options').expect(200);
  expect(response.body.subjects).toEqual(expect.arrayContaining(['الفيزياء', 'الكيمياء', 'اللغة الفرنسية', 'مادة مخصصة', 'مادة ثانية', 'مادة نصية', 'مادة إضافية', 'تصنيف مخصص']));
  expect(mockDb.exam.findMany.mock.calls.every(([args]) => !args.take)).toBe(true);
});

test('translated description is validated and saved with the draft', () => {
  expect(validateCompetition({ ...input(), description: 'وصف عربي', descriptionEn: 'English description' })).toMatchObject({ description: 'وصف عربي', descriptionEn: 'English description' });
  expect(() => validateCompetition({ ...input(), descriptionEn: 'x'.repeat(1501) })).toThrow();
});

test('manual questions transfer to the draft for review, but cannot publish without an answer key', async () => {
  mockActor.role = 'SCHOOL_ADMIN';
  mockDb.exam.findFirst.mockResolvedValue({ id: 'exam', title: 'Source', modules: [] });
  mockDb.question.findMany.mockResolvedValue([{ id: 'essay', type: 'TEXT', text: 'Explain your answer', options: '[]', correctAnswer: '', estimatedTime: '60', points: 4 }]); mockDb.question.count.mockResolvedValue(1);
  const response = await request(app).get('/api/competitions/manage/import?kind=EXAM&sourceId=exam').expect(200);
  const item = response.body.items[0];
  expect(item).toMatchObject({ supported: true, needsReview: true, question: { type: 'TEXT', correctAnswer: '', metadata: { requiresAnswerReview: true } } });
  expect(validateCompetition({ ...input(), questions: [item.question] }, true).questions).toHaveLength(1);
  mockRoom.status = 'DRAFT'; mockRoom.questions = [item.question];
  await request(app).post('/api/competitions/manage/room/action').send({ action: 'publish' }).expect(409);
  expect(mockDb.competition.update).not.toHaveBeenCalled();
  mockRoom.questions[0].correctAnswer = 'Expected model answer';
  await request(app).post('/api/competitions/manage/room/action').send({ action: 'publish' }).expect(200);
});

test('a custom subject stored in a course JSON array can be selected when creating a competition', async () => {
  mockActor.role = 'SCHOOL_ADMIN';
  mockDb.school.findFirst.mockResolvedValue({ id: 'own' });
  mockDb.course.findMany.mockResolvedValue([{ subject: '["مادة مخصصة","مادة ثانية"]' }]);
  mockDb.competition.create.mockResolvedValue({ id: 'new' });
  await request(app).post('/api/competitions/manage').send({ ...input(), subject: 'مادة مخصصة' }).expect(201);
  expect(mockDb.competition.create.mock.calls[0][0].data.subject).toBe('مادة مخصصة');
});

test('a platform admin can target an unplayed published competition without changing questions or status', async () => {
  mockActor.role = 'SUPER_ADMIN'; mockRoom.schoolId = null; mockRoom.grade = null;
  mockDb.school.findFirst.mockResolvedValue({ id: 'target' });
  mockDb.competition.update.mockResolvedValue({ ...mockRoom, schoolId: 'target', grade: 'الصف الأول الثانوي', school: { name: 'Target school' } });
  const response = await request(app).patch('/api/competitions/manage/room/audience').send({ schoolId: 'target', grade: 'الصف الأول الثانوي', questions: [], status: 'FINISHED' }).expect(200);
  expect(mockDb.competition.update.mock.calls[0][0].data).toEqual({ schoolId: 'target', grade: 'الصف الأول الثانوي' });
  expect(response.body.room).toMatchObject({ schoolId: 'target', schoolName: 'Target school', grade: 'الصف الأول الثانوي', status: 'OPEN' });
  expect(mockDb.$executeRaw).toHaveBeenCalled();
});

test('school and grade targeting preserves school boundaries and rejects non-admin roles', async () => {
  for (const role of ['STUDENT', 'TEACHER', 'PARENT']) {
    mockActor.role = role;
    await request(app).patch('/api/competitions/manage/room/audience').send({ grade: 'G2' }).expect(403);
  }
  mockActor.role = 'SCHOOL_ADMIN';
  await request(app).patch('/api/competitions/manage/room/audience').send({ schoolId: 'foreign', grade: 'G2' }).expect(403);
  await request(app).patch('/api/competitions/manage/room/audience').send({ schoolId: null, grade: 'G2' }).expect(403);
  mockRoom.schoolId = 'foreign';
  await request(app).patch('/api/competitions/manage/room/audience').send({ grade: 'G2' }).expect(404);
  expect(mockDb.competition.update).not.toHaveBeenCalled();
});

test('targeting is locked after joining or starting and validates the requested audience', async () => {
  mockActor.role = 'SUPER_ADMIN'; mockDb.competitionEntry.count.mockResolvedValue(1);
  await request(app).patch('/api/competitions/manage/room/audience').send({ grade: 'G2' }).expect(409);
  mockDb.competitionEntry.count.mockResolvedValue(0);
  for (const status of ['FINISHED', 'CANCELLED']) { mockRoom.status = status; await request(app).patch('/api/competitions/manage/room/audience').send({ grade: 'G2' }).expect(409); }
  mockRoom.status = 'OPEN'; mockRoom.mode = 'LIVE';
  await request(app).patch('/api/competitions/manage/room/audience').send({ grade: 'G2' }).expect(409);
  mockRoom.mode = 'SELF_PACED';
  await request(app).patch('/api/competitions/manage/room/audience').send({ schoolId: 'missing', grade: 'G2' }).expect(404);
  await request(app).patch('/api/competitions/manage/room/audience').send({ grade: ['G2'] }).expect(400);
  await request(app).patch('/api/competitions/manage/room/audience').send({}).expect(400);
  expect(mockDb.competition.update).not.toHaveBeenCalled();
});

test('school admins can set their own grade and platform admins can restore a general audience', async () => {
  mockActor.role = 'SCHOOL_ADMIN';
  mockDb.school.findFirst.mockResolvedValue({ id: 'own' });
  mockDb.competition.update.mockImplementation(async ({ data }) => ({ ...mockRoom, ...data }));
  await request(app).patch('/api/competitions/manage/room/audience').send({ grade: 'G2' }).expect(200);
  expect(mockDb.competition.update.mock.calls[0][0].data).toEqual({ schoolId: 'own', grade: 'G2' });
  mockActor.role = 'SUPER_ADMIN';
  await request(app).patch('/api/competitions/manage/room/audience').send({ schoolId: '', grade: '' }).expect(200);
  expect(mockDb.competition.update.mock.calls[1][0].data).toEqual({ schoolId: null, grade: null });
});
