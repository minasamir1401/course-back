process.env.JWT_SECRET = 'idor-regression-test-key-only-not-for-production-2026';
require('ts-node/register/transpile-only');

const mockExams = new Map();
const mockTeacherCourses = new Set();

jest.mock('../../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    exam: {
      findUnique: jest.fn(async ({ where }) => mockExams.get(where.id) || null),
      findMany: jest.fn(async () => Array.from(mockExams.values())),
    },
    teacherCourse: {
      findFirst: jest.fn(async ({ where }) => {
        const key = `${where.teacherId}:${where.courseId}`;
        return mockTeacherCourses.has(key) ? { id: 'tc-1' } : null;
      }),
    },
    user: {
      findUnique: jest.fn(async () => ({ status: 'ACTIVE' })),
    },
    question: {
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  },
}));

jest.mock('../../../src/lib/redis', () => ({
  cacheGetJSON: jest.fn(async () => null),
  cacheSetJSON: jest.fn(async () => {}),
  cacheDelete: jest.fn(async () => {}),
}));

const { requireManagedExam } = require('../../../src/routes/exams');
const { canManageExam, cleanDuplicatesHandler } = require('../../../src/controllers/exams.controller');
const { canManageExamRecord } = require('../../../src/utils/examAccessPolicy');

const mockResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
};

describe('IDOR & multi-tenant isolation with real seeded fixtures', () => {
  const schoolAExam = {
    id: 'exam-a',
    title: 'School A Exam',
    isCentral: false,
    schoolId: 'school-a',
    creatorId: 'admin-a',
    courseId: 'course-a',
    schools: [{ id: 'school-a' }],
  };

  const schoolBExam = {
    id: 'exam-b',
    title: 'School B Exam',
    isCentral: false,
    schoolId: 'school-b',
    creatorId: 'admin-b',
    courseId: 'course-b',
    schools: [{ id: 'school-b' }],
  };

  const centralExam = {
    id: 'exam-central',
    title: 'Central Question Bank Exam',
    isCentral: true,
    schoolId: null,
    creatorId: 'super-admin-root',
    courseId: null,
    schools: [],
  };

  const adminA = { id: 'admin-a', role: 'SCHOOL_ADMIN', schoolId: 'school-a' };
  const adminB = { id: 'admin-b', role: 'SCHOOL_ADMIN', schoolId: 'school-b' };
  const teacherA = { id: 'teacher-a', role: 'TEACHER', schoolId: 'school-a' };
  const teacherB = { id: 'teacher-b', role: 'TEACHER', schoolId: 'school-b' };
  const superAdmin = { id: 'super-admin-root', role: 'SUPER_ADMIN', schoolId: null };

  beforeEach(() => {
    mockExams.clear();
    mockTeacherCourses.clear();

    mockExams.set(schoolAExam.id, schoolAExam);
    mockExams.set(schoolBExam.id, schoolBExam);
    mockExams.set(centralExam.id, centralExam);

    // Seed teacher-a assignment to course-a
    mockTeacherCourses.add('teacher-a:course-a');
  });

  describe('requireManagedExam route guard', () => {
    test('school A administrator cannot access or manage school B exam (cross-school IDOR blocked)', async () => {
      const req = { params: { id: 'exam-b' }, user: adminA };
      const res = mockResponse();
      const next = jest.fn();

      await requireManagedExam(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
      expect(next).not.toHaveBeenCalled();
    });

    test('school B administrator cannot access or manage school A exam', async () => {
      const req = { params: { id: 'exam-a' }, user: adminB };
      const res = mockResponse();
      const next = jest.fn();

      await requireManagedExam(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
      expect(next).not.toHaveBeenCalled();
    });

    test('school A administrator cannot manage central question bank exam', async () => {
      const req = { params: { id: 'exam-central' }, user: adminA };
      const res = mockResponse();
      const next = jest.fn();

      await requireManagedExam(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('teacher from school B cannot access school A exam', async () => {
      const req = { params: { id: 'exam-a' }, user: teacherB };
      const res = mockResponse();
      const next = jest.fn();

      await requireManagedExam(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('teacher from school B without course assignment cannot manage school A exam', async () => {
      const unassignedForeignTeacher = { id: 'teacher-unassigned', role: 'TEACHER', schoolId: 'school-b' };
      const req = { params: { id: 'exam-a' }, user: unassignedForeignTeacher };
      const res = mockResponse();
      const next = jest.fn();

      await requireManagedExam(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 404 for nonexistent exam ID', async () => {
      const req = { params: { id: 'nonexistent-exam-id' }, user: adminA };
      const res = mockResponse();
      const next = jest.fn();

      await requireManagedExam(req, res, next);
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Exam not found');
      expect(next).not.toHaveBeenCalled();
    });

    test('school A administrator can manage school A exam', async () => {
      const req = { params: { id: 'exam-a' }, user: adminA };
      const res = mockResponse();
      const next = jest.fn();

      await requireManagedExam(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('assigned teacher can manage school A exam for their course', async () => {
      const req = { params: { id: 'exam-a' }, user: teacherA };
      const res = mockResponse();
      const next = jest.fn();

      await requireManagedExam(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    test('super administrator has global access to all exams and central bank', async () => {
      for (const examId of ['exam-a', 'exam-b', 'exam-central']) {
        const req = { params: { id: examId }, user: superAdmin };
        const res = mockResponse();
        const next = jest.fn();

        await requireManagedExam(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('canManageExam controller logic', () => {
    test('evaluates teacher permissions with database course enrollment check', async () => {
      const allowed = await canManageExam(teacherA, schoolAExam);
      expect(allowed).toBe(true);

      const foreignAllowed = await canManageExam(teacherA, schoolBExam);
      expect(foreignAllowed).toBe(false);
    });

    test('blocks school admin from foreign school', async () => {
      const allowed = await canManageExam(adminA, schoolBExam);
      expect(allowed).toBe(false);
    });
  });

  describe('cleanDuplicatesHandler IDOR defense & parameter validation', () => {
    test('rejects non-super-admin requests when route param id is missing', async () => {
      const req = {
        params: {},
        body: { examId: 'exam-a' },
        user: teacherA,
      };
      const res = mockResponse();

      await cleanDuplicatesHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('Exam ID path parameter is required.');
    });

    test('rejects mismatched path parameter and body examId', async () => {
      const req = {
        params: { id: 'exam-a' },
        body: { examId: 'exam-b' },
        user: adminA,
      };
      const res = mockResponse();

      await cleanDuplicatesHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Mismatched exam ID between path and body parameters.');
    });

    test('allows super administrator to run deduplication across all exams without path param', async () => {
      const req = {
        params: {},
        body: {},
        user: superAdmin,
      };
      const res = mockResponse();

      await cleanDuplicatesHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('offline policy checks (canManageExamRecord)', () => {
    test('cross-school exam access is strictly blocked at the policy layer', () => {
      expect(canManageExamRecord(adminA, schoolBExam, false)).toBe(false);
    });

    test('cross-school content movement requires dual ownership verification', () => {
      const canAccessSource = canManageExamRecord(adminA, schoolAExam, false);
      const canAccessTarget = canManageExamRecord(adminA, schoolBExam, false);

      expect(canAccessSource).toBe(true);
      expect(canAccessTarget).toBe(false);
      expect(canAccessSource && canAccessTarget).toBe(false);
    });

    test('non-super-admin cannot hijack or mutate central exams', () => {
      expect(canManageExamRecord(adminA, centralExam, false)).toBe(false);
      expect(canManageExamRecord(teacherA, centralExam, true)).toBe(false);
    });

    test('teacher without course assignment cannot access or mutate foreign exam', () => {
      expect(canManageExamRecord(teacherA, schoolBExam, false)).toBe(false);

      const foreignExamCreatedBeforeTransfer = { ...schoolBExam, creatorId: 'teacher-a' };
      expect(canManageExamRecord(teacherA, foreignExamCreatedBeforeTransfer, false)).toBe(false);

      const ownSchoolExam = { ...schoolAExam, creatorId: 'teacher-a' };
      expect(canManageExamRecord(teacherA, ownSchoolExam, false)).toBe(true);
    });

    test('super administrator retains global administrative access across all schools', () => {
      expect(canManageExamRecord(superAdmin, schoolBExam, false)).toBe(true);
      expect(canManageExamRecord(superAdmin, centralExam, false)).toBe(true);
    });
  });
});
