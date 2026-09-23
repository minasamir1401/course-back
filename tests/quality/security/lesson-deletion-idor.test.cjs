process.env.JWT_SECRET = 'idor-regression-test-key-only-not-for-production-2026';
require('ts-node/register/transpile-only');

const mockLessons = new Map();
const mockTeacherCourses = new Set();
let mockDeletionAllowed = true;

jest.mock('../../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    lesson: {
      findUnique: jest.fn(async ({ where }) => mockLessons.get(where.id) || null),
      update: jest.fn(async ({ where, data }) => {
        const existing = mockLessons.get(where.id);
        if (existing) {
          const updated = { ...existing, ...data };
          mockLessons.set(where.id, updated);
          return updated;
        }
        return null;
      }),
    },
    teacherCourse: {
      findFirst: jest.fn(async ({ where }) => {
        const key = `${where.teacherId}:${where.courseId}`;
        return mockTeacherCourses.has(key) ? { id: 'tc-1' } : null;
      }),
    },
    systemSetting: {
      findUnique: jest.fn(async () => ({ value: String(mockDeletionAllowed) })),
    },
  },
}));

jest.mock('../../../src/lib/redis', () => ({
  cacheGetJSON: jest.fn(async () => null),
  cacheSetJSON: jest.fn(async () => {}),
  cacheDelete: jest.fn(async () => {}),
  isRedisActive: jest.fn(() => false),
}));

jest.mock('../../../src/lib/tombstones', () => ({
  recordDeletedLesson: jest.fn(async () => {}),
}));

jest.mock('../../../src/lib/db-backup', () => ({
  syncCourseToCloud: jest.fn(async () => {}),
}));

jest.mock('../../../src/services/systemSettings.service', () => ({
  isContentDeletionAllowed: jest.fn(async () => mockDeletionAllowed),
}));

const { deleteCourseHandler21 } = require('../../../src/controllers/courses.controller');

const createMockResponse = () => {
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

describe('Lesson Deletion IDOR Protection', () => {
  beforeEach(() => {
    mockLessons.clear();
    mockTeacherCourses.clear();
    mockDeletionAllowed = true;

    mockLessons.set('lesson-school-a', {
      id: 'lesson-school-a',
      title: 'Math Lesson 1',
      courseId: 'course-a',
      course: { schoolId: 'school-a' },
    });

    mockLessons.set('lesson-school-b', {
      id: 'lesson-school-b',
      title: 'Physics Lesson 1',
      courseId: 'course-b',
      course: { schoolId: 'school-b' },
    });
  });

  it('rejects deletion when content deletion toggle is disabled for non-superadmin', async () => {
    mockDeletionAllowed = false;
    const req = {
      params: { id: 'lesson-school-a' },
      user: { id: 'teacher-1', role: 'TEACHER', schoolId: 'school-a' },
    };
    const res = createMockResponse();

    await deleteCourseHandler21(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('حذف المحتوى معطّل حالياً');
  });

  it('allows SUPER_ADMIN to delete even if deletion toggle is disabled', async () => {
    mockDeletionAllowed = false;
    const req = {
      params: { id: 'lesson-school-a' },
      user: { id: 'admin-1', role: 'SUPER_ADMIN' },
    };
    const res = createMockResponse();

    await deleteCourseHandler21(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Lesson deleted successfully');
  });

  it('allows SCHOOL_ADMIN to delete lessons belonging to their school', async () => {
    const req = {
      params: { id: 'lesson-school-a' },
      user: { id: 'school-admin-a', role: 'SCHOOL_ADMIN', schoolId: 'school-a' },
    };
    const res = createMockResponse();

    await deleteCourseHandler21(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('blocks SCHOOL_ADMIN from deleting lessons belonging to another school', async () => {
    const req = {
      params: { id: 'lesson-school-b' },
      user: { id: 'school-admin-a', role: 'SCHOOL_ADMIN', schoolId: 'school-a' },
    };
    const res = createMockResponse();

    await deleteCourseHandler21(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('You can only delete lessons belonging to your school');
  });

  it('blocks TEACHER from deleting lessons from another school', async () => {
    mockTeacherCourses.add('teacher-a:course-b');
    const req = {
      params: { id: 'lesson-school-b' },
      user: { id: 'teacher-a', role: 'TEACHER', schoolId: 'school-a' },
    };
    const res = createMockResponse();

    await deleteCourseHandler21(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('You can only delete lessons belonging to your school');
  });

  it('blocks TEACHER from deleting lessons in their school if not assigned to the course', async () => {
    const req = {
      params: { id: 'lesson-school-a' },
      user: { id: 'teacher-unassigned', role: 'TEACHER', schoolId: 'school-a' },
    };
    const res = createMockResponse();

    await deleteCourseHandler21(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('You are not assigned to this course');
  });

  it('allows TEACHER to delete lesson if in their school and assigned to the course', async () => {
    mockTeacherCourses.add('teacher-assigned:course-a');
    const req = {
      params: { id: 'lesson-school-a' },
      user: { id: 'teacher-assigned', role: 'TEACHER', schoolId: 'school-a' },
    };
    const res = createMockResponse();

    await deleteCourseHandler21(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Lesson deleted successfully');
  });
});
