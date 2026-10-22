require('ts-node/register/transpile-only');
const mockDb = {
  exam: { findUnique: jest.fn() }, examSubmission: { findMany: jest.fn() },
  studentAnswer: { findMany: jest.fn() }, subExam: { findMany: jest.fn() }, user: { findMany: jest.fn() },
};
jest.mock('../../src/lib/prisma', () => ({ __esModule: true, default: mockDb }));
jest.mock('../../src/controllers/examControllerSupport', () => ({ canViewExam: jest.fn(async (user, exam) => user.role === 'SUPER_ADMIN' || exam.isCentral || exam.schoolId === user.schoolId) }));
jest.mock('../../src/shared', () => ({ examMatchesStudent: (exam, student) => (!exam.grade || exam.grade === student.grade) && (exam.isCentral || exam.schoolId === student.schoolId) }));
const { generateReport, reportFilters, reportSubmissionWhere } = require('../../src/services/reporting.service');
const { examAttendance } = require('../../src/services/attendance.service');
const dates = { from: '2026-10-01', to: '2026-10-31' };
const attempt = (id, userId, percentage, day, schoolId = 'school') => ({ id, userId, examId: 'exam', subExamId: null, percentage, totalScore: percentage, totalTime: 60,
  createdAt: new Date(`2026-10-${day}T22:30:00Z`), user: { id: userId, name: userId, username: userId, schoolId, school: { name: 'Same name' } }, exam: { title: 'Exam', passingScore: 50 },
  reportSnapshot: { passingScore: 80, totalQuestions: 1, correctAnswers: 1, schoolId, schoolName: 'Same name' }, schoolIdAtSubmission: schoolId,
  answers: [{ isCorrect: true, question: { id: 'q', text: 'Question', skill: 'Skill A', moduleId: 'm', subExamId: 'child' } }] });

beforeEach(() => { jest.clearAllMocks(); mockDb.examSubmission.findMany.mockResolvedValue([]); mockDb.subExam.findMany.mockResolvedValue([]); mockDb.studentAnswer.findMany.mockImplementation(async () => { const rows = await mockDb.examSubmission.findMany(); return rows.flatMap(row => (row.answers || []).map(answer => ({ ...answer, submissionId: row.id }))); }); mockDb.user.findMany.mockResolvedValue([]); });

test('daily chart ranges and pass rate use selected recorded grades and preserve zero and unknown scores', async () => {
  mockDb.examSubmission.findMany.mockResolvedValue([attempt('a','u',100,'14'),attempt('b','v',70,'14'),attempt('c','w',null,'14'),attempt('d','x',0,'15'),attempt('e','unknown',null,'16')]);
  const report=await generateReport({role:'SUPER_ADMIN'},dates,mockDb);
  expect(report.timeline[0]).toMatchObject({attempts:3,averageScore:85,minimumScore:70,maximumScore:100,passRate:50});
  expect(report.timeline[1]).toMatchObject({attempts:1,averageScore:0,minimumScore:0,maximumScore:0,passRate:0});
  expect(report.timeline[2]).toMatchObject({attempts:1,averageScore:null,minimumScore:null,maximumScore:null,passRate:null});
});
test('overview uses selected attempts, frozen thresholds, separate students and Egypt days', async () => {
  mockDb.examSubmission.findMany.mockResolvedValue([attempt('a', 'u', 100, '14'), attempt('b', 'u', 70, '15'), attempt('c', 'v', 90, '16', 'other')]);
  const report = await generateReport({ role: 'SUPER_ADMIN' }, dates, mockDb);
  expect(report.summary).toMatchObject({ totalAttempts: 3, selectedAttempts: 2, uniqueStudents: 2, averageScore: 80, passRate: 50 });
  expect(report.timeline[0].day).toBe('2026-10-16');
  expect(report.schools).toHaveLength(2); // identical display names must not merge schools.
  expect(report.skills[0]).toMatchObject({ answers: 2, sufficientEvidence: false });
  expect(report.students[0]).not.toHaveProperty('answers');
});
test('school scopes cannot be overridden by URL and teachers are restricted to their classrooms', () => {
  const user = { role: 'SCHOOL_ADMIN', schoolId: 'own' };
  const filters = reportFilters(user, { ...dates, schoolId: 'other' });
  expect(filters.schoolId).toBe('own');
  expect(reportSubmissionWhere(user, filters).AND).toContainEqual({ OR: [{ schoolIdAtSubmission: 'own' }, { schoolIdAtSubmission: null, user: { schoolId: 'own' } }] });
  const teacher = { role: 'TEACHER', schoolId: 'own', id: 'teacher' };
  expect(reportSubmissionWhere(teacher, reportFilters(teacher, dates)).AND).toContainEqual({ user: { classroom: { teacherId: 'teacher' } } });
});
test('student reports cannot expose another student or HIDE_ALL grades', () => {
  const user = { id: 'me', role: 'STUDENT', schoolId: 'own' };
  expect(reportSubmissionWhere(user, reportFilters(user, dates)).AND).toContainEqual({ userId: 'me', exam: { resultVisibility: { not: 'HIDE_ALL' } } });
});
test('no attempts is missing data rather than a failure score', async () => {
  const report = await generateReport({ role: 'SUPER_ADMIN' }, dates, mockDb);
  expect(report.summary.averageScore).toBeNull(); expect(report.summary.passRate).toBeNull(); expect(report.summary.participationRate).toBeNull();
});

test('changed versions of the same question are analysed separately', async () => {
  const original = attempt('a', 'u', 90, '15'), edited = attempt('b', 'v', 90, '16');
  original.answers[0].questionSnapshot = { id: 'q', revision: 'first', text: 'Original', skill: 'Skill A' };
  edited.answers[0].questionSnapshot = { id: 'q', revision: 'second', text: 'Edited', skill: 'Skill A' };
  mockDb.examSubmission.findMany.mockResolvedValue([original, edited]);
  const report = await generateReport({ role: 'SUPER_ADMIN' }, dates, mockDb);
  expect(report.questions).toHaveLength(2);
  expect(report.questions.map(question => question.total)).toEqual([1, 1]);
  expect(new Set(report.questions.map(question => question.id)).size).toBe(2);
});
test('rejects overlarge report instead of silently truncating its totals', async () => {
  mockDb.examSubmission.findMany.mockResolvedValue(Array(10001).fill(attempt('a', 'u', 90, '15')));
  await expect(generateReport({ role: 'SUPER_ADMIN' }, dates, mockDb)).rejects.toMatchObject({ status: 422 });
});
test('participation has a verified assignment denominator and stable pagination past 100 students', async () => {
  mockDb.exam.findUnique.mockResolvedValue({ id: 'exam', title: 'Exam', isCentral: true, grade: 'G1', endDate: new Date('2099-01-01'), modules: [] });
  mockDb.user.findMany.mockResolvedValue(Array.from({ length: 132 }, (_, i) => ({ id: 'u' + i, name: 'Student ' + i, username: 'u' + i, grade: i === 131 ? 'OTHER' : 'G1', schoolId: 'school' })));
  mockDb.examSubmission.findMany.mockResolvedValue([{ ...attempt('a', 'u0', 90, '15'), answers: [{ isCorrect: true }] }]);
  const report = await examAttendance({ role: 'SCHOOL_ADMIN', schoolId: 'school' }, { examId: 'exam', page: '2', limit: '100' });
  expect(report.total).toBe(131); expect(report.attendedCount).toBe(1); expect(report.pendingCount).toBe(130); expect(report.missedCount).toBe(0);
  expect(report.pagination).toMatchObject({ total: 131, pages: 2 }); expect(report.rows).toHaveLength(31); expect(report.exportRows).toHaveLength(131);
});
test('attendance rejects an exam from another school before reading the roster', async () => {
  mockDb.exam.findUnique.mockResolvedValue({ id: 'exam', schoolId: 'other', modules: [] });
  await expect(examAttendance({ role: 'SCHOOL_ADMIN', schoolId: 'own' }, { examId: 'exam' })).rejects.toMatchObject({ status: 403 });
  expect(mockDb.user.findMany).not.toHaveBeenCalled();
});
