require('ts-node/register/transpile-only');

const { canManageExamRecord } = require('../../../src/utils/examAccessPolicy');

describe('exam management access policy', () => {
  const foreignExam = {
    isCentral: false,
    schoolId: 'school-b',
    creatorId: 'admin-b',
    schools: [],
  };

  test('does not allow a school administrator to modify another school\'s exam', () => {
    expect(canManageExamRecord(
      { id: 'admin-a', role: 'SCHOOL_ADMIN', schoolId: 'school-a' },
      foreignExam,
      false,
    )).toBe(false);
  });

  test('does not allow non-super-admin users to modify central exams', () => {
    expect(canManageExamRecord(
      { id: 'admin-a', role: 'SCHOOL_ADMIN', schoolId: 'school-a' },
      { ...foreignExam, isCentral: true, schoolId: null },
      false,
    )).toBe(false);
  });

  test('allows a teacher assigned to the exam course to manage its non-central exam', () => {
    expect(canManageExamRecord(
      { id: 'teacher-a', role: 'TEACHER', schoolId: 'school-a' },
      { ...foreignExam, courseId: 'course-a' },
      true,
    )).toBe(true);
  });
});
