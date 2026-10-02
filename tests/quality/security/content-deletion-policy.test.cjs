process.env.JWT_SECRET = 'content-deletion-policy-test-secret-2026-at-least-32';
let mockAllowed = false;
const mockPrisma = {
  lesson: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  course: { findUnique: jest.fn(), update: jest.fn() },
  teacherCourse: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('../../../src/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../src/services/systemSettings.service', () => ({ isContentDeletionAllowed: jest.fn(async () => mockAllowed) }));
jest.mock('../../../src/lib/redis', () => ({ cacheGetJSON: jest.fn(async () => null), cacheSetJSON: jest.fn(), cacheDelete: jest.fn(), isRedisActive: jest.fn(() => false) }));
jest.mock('../../../src/lib/tombstones', () => ({ recordDeletedCourse: jest.fn(async () => {}) }));
jest.mock('../../../src/lib/db-backup', () => ({ syncCourseToCloud: jest.fn(async () => {}) }));
const { patchCourseHandler17, patchCourseHandler18, patchCourseHandler19, putCourseHandler12, deleteCourseHandler22 } = require('../../../src/controllers/courses.controller');
const { removesSavedContent } = require('../../../src/utils/contentDeletionPolicy');
const handlers = { slides: patchCourseHandler17, questions: patchCourseHandler18, assignments: patchCourseHandler19 };
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (role = 'SCHOOL_ADMIN', body = {}) => ({ params: { id: 'lesson-1' }, user: { id: 'owner', role, schoolId: 'school-1' }, body });
beforeEach(() => {
  jest.clearAllMocks(); mockAllowed = false;
  const lesson = { id: 'lesson-1', title: 'Lesson', courseId: 'course-1', course: { schoolId: 'school-1' },
    slides: [{ blockId: 'slide-1' }], questions: [{ id: 123 }], assignments: [{ id: 456 }] };
  mockPrisma.lesson.findUnique.mockResolvedValue(lesson);
  mockPrisma.lesson.findMany.mockResolvedValue([lesson]);
  mockPrisma.lesson.update.mockImplementation(async ({ data }) => ({ ...lesson, ...data }));
  mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', title: 'Course', schoolId: 'school-1', schools: [] });
  mockPrisma.course.update.mockResolvedValue({ id: 'course-1' });
  mockPrisma.teacherCourse.findFirst.mockResolvedValue({ id: 'assigned' });
});
test.each(Object.keys(handlers))('locked policy rejects removal of saved %s through dedicated saves', async field => {
  const res = response(); await handlers[field](request('SCHOOL_ADMIN', { [field]: [] }), res);
  expect(res.statusCode).toBe(403); expect(mockPrisma.lesson.update).not.toHaveBeenCalled();
});
test.each(Object.keys(handlers))('open policy permits same-school %s removal and rejects another school', async field => {
  mockAllowed = true;
  let res = response(); await handlers[field](request('TEACHER', { [field]: [] }), res);
  expect(res.statusCode).toBe(200); expect(mockPrisma.lesson.update).toHaveBeenCalled();
  mockPrisma.lesson.update.mockClear();
  const req = request('SCHOOL_ADMIN', { [field]: [] }); req.user.schoolId = 'school-2';
  res = response(); await handlers[field](req, res);
  expect(res.statusCode).toBe(403); expect(mockPrisma.lesson.update).not.toHaveBeenCalled();
});
test.each(Object.keys(handlers))('Super Admin can remove %s while policy is locked', async field => {
  const res = response(); await handlers[field](request('SUPER_ADMIN', { [field]: [] }), res);
  expect(res.statusCode).toBe(200);
});
test('course saves cannot bypass the locked deletion policy', async () => {
  const res = response();
  await putCourseHandler12(request('SCHOOL_ADMIN', { lessons: [{ id: 'lesson-1', questions: [] }] }), res);
  expect(res.statusCode).toBe(403); expect(mockPrisma.$transaction).not.toHaveBeenCalled();
});
test('assigned teacher can delete a school course only while policy is open', async () => {
  const req = request('TEACHER'); req.params.id = 'course-1';
  let res = response(); await deleteCourseHandler22(req, res); expect(res.statusCode).toBe(403);
  mockAllowed = true;
  res = response(); await deleteCourseHandler22(req, res); expect(res.statusCode).toBe(200);
  expect(mockPrisma.course.update).toHaveBeenCalledWith({ where: { id: 'course-1' }, data: { deletedAt: expect.any(Date) } });
  mockPrisma.teacherCourse.findFirst.mockResolvedValue(null);
  res = response(); await deleteCourseHandler22(req, res); expect(res.statusCode).toBe(403);
});
test('deletion detection permits edits, reordering, additions and omitted fields', () => {
  const current = [{ id: 1, text: 'A' }, { id: 2, text: 'B' }];
  expect(removesSavedContent(current, [{ id: 2, text: 'Edited' }, { id: 1 }])).toBe(false);
  expect(removesSavedContent(current, [...current, { id: 3 }])).toBe(false);
  expect(removesSavedContent(current, undefined)).toBe(false);
  expect(removesSavedContent(current, null)).toBe(true);
  expect(removesSavedContent(JSON.stringify(current), '[]')).toBe(true);
  expect(removesSavedContent(current, [{ id: 1 }, { id: 3 }])).toBe(true);
});
