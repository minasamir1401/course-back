process.env.JWT_SECRET = 'exam-regression-test-key-only-not-for-production-2026';
require('ts-node/register/transpile-only');
jest.mock('../../../src/lib/prisma', () => ({ __esModule: true, default: {
  user: { findUnique: jest.fn() }, exam: { findUnique: jest.fn(), findMany: jest.fn() },
  question: { findMany: jest.fn() }, examSubmission: { count: jest.fn(), findFirst: jest.fn() },
} }));
jest.mock('../../../src/lib/redis', () => ({
  cacheGetJSON: jest.fn(async () => null), cacheSetJSON: jest.fn(async () => {}),
}));
const jwt = require('jsonwebtoken');
const prisma = require('../../../src/lib/prisma').default;
const { verifyToken } = require('../../../src/middleware/auth');
const controller = require('../../../src/controllers/exams.controller');
const { mergeStudentProfile } = require('../../../src/utils/examWorkflow');
const { examMatchesStudent } = require('../../../src/shared');
const policy = require('../../../src/utils/examAccessPolicy');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const assignedExam = {
  id: 'exam-a', title: 'ميا', isCentral: true, schoolId: 'school-a',
  schools: [{ id: 'school-a' }], status: 'PUBLISHED', deletedAt: null,
  grade: null, grades: null, modules: [{ id: 'm', parentModuleId: null, subExams: [] }], questions: [],
};
beforeEach(() => {
  prisma.user.findUnique.mockResolvedValue({ status: 'ACTIVE', grade: null, schoolId: 'school-b' });
  prisma.exam.findUnique.mockResolvedValue(assignedExam);
  prisma.exam.findMany.mockResolvedValue([assignedExam]);
  prisma.question.findMany.mockResolvedValue([{ id: 'q', options: '[]' }]);
  prisma.examSubmission.count.mockResolvedValue(0);
  prisma.examSubmission.findFirst.mockResolvedValue(null);
});
test('explicit student session wins over a leftover admin cookie', async () => {
  const req = { cookies: { auth_token: jwt.sign({ id: 'admin', role: 'SUPER_ADMIN' }, process.env.JWT_SECRET) },
    headers: { authorization: `Bearer ${jwt.sign({ id: 'student', role: 'STUDENT' }, process.env.JWT_SECRET)}` }, query: {} };
  await verifyToken(req, response(), jest.fn());
  expect(req.user.role).toBe('STUDENT');
});
test('cookie-only clients can still authenticate', async () => {
  const req = { cookies: { auth_token: jwt.sign({ id: 'cookie-student', role: 'STUDENT' }, process.env.JWT_SECRET) }, headers: {}, query: {} };
  const next = jest.fn();
  await verifyToken(req, response(), next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user.id).toBe('cookie-student');
});
test.each(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'STUDENT'])('cookie_auth marker authenticates the actual cookie for %s', async (role) => {
  const req = { cookies: { auth_token: jwt.sign({ id: `cookie-${role}`, role }, process.env.JWT_SECRET) },
    headers: { authorization: 'Bearer cookie_auth' }, query: {} };
  const res = response();
  const next = jest.fn();
  await verifyToken(req, res, next);
  expect(res.statusCode).toBe(200);
  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user.role).toBe(role);
});
test('cookie_auth without an actual cookie is unauthenticated, not an invalid JWT', async () => {
  const req = { cookies: {}, headers: { authorization: 'Bearer cookie_auth' }, query: {} };
  const res = response();
  const next = jest.fn();
  await verifyToken(req, res, next);
  expect(res.statusCode).toBe(401);
  expect(next).not.toHaveBeenCalled();
});
test.each(['Bearer invalid', 'Basic invalid'])('invalid explicit credentials never fall back to an admin cookie: %s', async (authorization) => {
  const req = { cookies: { auth_token: jwt.sign({ id: 'admin', role: 'SUPER_ADMIN' }, process.env.JWT_SECRET) }, headers: { authorization }, query: {} };
  const next = jest.fn();
  await verifyToken(req, response(), next);
  expect(next).not.toHaveBeenCalled();
  expect(req.user).toBeUndefined();
});
test('a removed school never falls back to the school in an old token', () => {
  expect(mergeStudentProfile({ schoolId: 'school-a', grade: 'old' }, { schoolId: null, grade: null }))
    .toMatchObject({ schoolId: null, grade: null });
});
test('school assignment overrides even a stale central flag', () => {
  expect(examMatchesStudent(assignedExam, { role: 'STUDENT', schoolId: 'school-b' })).toBe(false);
  expect(examMatchesStudent(assignedExam, { role: 'STUDENT', schoolId: 'school-a' })).toBe(true);
});
test('an unrelated save cannot clear school assignments or make an exam central', () => {
  expect(policy.resolveExamSchoolUpdate?.(assignedExam, {})).toEqual({});
  expect(policy.resolveExamSchoolUpdate?.(assignedExam, { isCentral: true })).toMatchObject({
    isCentral: false, schoolId: 'school-a', schools: { set: [{ id: 'school-a' }] },
  });
});
test('explicit central selection clears assignments while selected schools always win', () => {
  expect(policy.resolveExamSchoolUpdate?.(assignedExam, { isCentral: true, schoolIds: [] })).toEqual({
    isCentral: true, schoolId: null, schools: { set: [] },
  });
  expect(policy.resolveExamSchoolUpdate?.(assignedExam, { isCentral: true, schoolIds: ['school-b'] })).toEqual({
    isCentral: false, schoolId: 'school-b', schools: { set: [{ id: 'school-b' }] },
  });
});
test.each([
  ['details', 'getExamHandler10'], ['questions', 'getExamQuestionsHandler'],
  ['question alias', 'getExamHandler10', { onlyQuestions: 'true' }],
  ['attempt status', 'getExamHandler12'], ['verify access', 'postExamHandler11'],
  ['submission', 'postExamHandler13'],
])('%s denies a student from another school', async (_label, handler, query = {}) => {
  const req = { user: { id: 'student-b', role: 'STUDENT', schoolId: 'school-b' }, params: { id: 'exam-a' }, query, body: { answers: [] } };
  const res = response();
  await controller[handler](req, res);
  expect(res.statusCode).toBe(403);
});
test.each(['getExamHandler10', 'getExamQuestionsHandler', 'getExamHandler12', 'postExamHandler11'])('%s permits a student of the selected school', async (handler) => {
  prisma.user.findUnique.mockResolvedValue({ grade: null, schoolId: 'school-a' });
  const req = { user: { id: 'student-a', role: 'STUDENT', schoolId: 'school-a' }, params: { id: 'exam-a' }, query: {}, body: {} };
  const res = response();
  await controller[handler](req, res);
  expect(res.statusCode).toBe(200);
});
test('the list contains assigned content for its own school', async () => {
  prisma.user.findUnique.mockResolvedValue({ grade: null, schoolId: 'school-a' });
  const res = response();
  await controller.getExamHandler3({ user: { id: 'student-a', role: 'STUDENT' }, query: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.map(exam => exam.id)).toEqual(['exam-a']);
});
test('unassigned students can see central content but not school-restricted content', () => {
  const student = { role: 'STUDENT', schoolId: null };
  expect(examMatchesStudent(assignedExam, student)).toBe(false);
  expect(examMatchesStudent({ ...assignedExam, schoolId: null, schools: [] }, student)).toBe(true);
});
test.each([{}, { isCentral: 'true' }])('listing uses the current school even with filters %j', async (query) => {
  const req = { user: { id: 'moved-student', role: 'STUDENT', schoolId: 'school-a', grade: 'old' }, params: {}, query };
  const res = response();
  await controller.getExamHandler3(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual([]);
  expect(prisma.exam.findMany.mock.calls.at(-1)[0].where.status).toBe('PUBLISHED');
});
