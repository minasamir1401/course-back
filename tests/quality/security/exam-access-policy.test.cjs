require('ts-node/register/transpile-only');

const { canManageExamRecord, resolveExamSchoolUpdate } = require('../../../src/utils/examAccessPolicy');

describe('exam management access policy (IDOR & Multi-tenant isolation)', () => {
  const foreignExam = {
    isCentral: false,
    schoolId: 'school-b',
    creatorId: 'admin-b',
    schools: [{ id: 'school-b' }],
  };

  const centralExam = {
    isCentral: true,
    schoolId: null,
    creatorId: 'super-admin-1',
    schools: [],
  };

  const sharedExam = {
    isCentral: false,
    schoolId: 'school-b',
    creatorId: 'admin-b',
    schools: [{ id: 'school-a' }, { id: 'school-b' }],
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
      centralExam,
      false,
    )).toBe(false);

    expect(canManageExamRecord(
      { id: 'teacher-a', role: 'TEACHER', schoolId: 'school-a' },
      centralExam,
      true,
    )).toBe(false);
  });

  test('allows super administrator full management of all exams including foreign and central', () => {
    expect(canManageExamRecord(
      { id: 'super-admin', role: 'SUPER_ADMIN', schoolId: null },
      foreignExam,
      false,
    )).toBe(true);

    expect(canManageExamRecord(
      { id: 'super-admin', role: 'SUPER_ADMIN', schoolId: null },
      centralExam,
      false,
    )).toBe(true);
  });

  test('allows a school administrator to manage exams assigned to their school', () => {
    expect(canManageExamRecord(
      { id: 'admin-a', role: 'SCHOOL_ADMIN', schoolId: 'school-a' },
      sharedExam,
      false,
    )).toBe(true);
  });

  test('allows creator to manage their own created exam', () => {
    expect(canManageExamRecord(
      { id: 'admin-b', role: 'SCHOOL_ADMIN', schoolId: 'school-b' },
      foreignExam,
      false,
    )).toBe(true);
  });

  test('allows a teacher assigned to the exam course to manage its non-central exam', () => {
    expect(canManageExamRecord(
      { id: 'teacher-a', role: 'TEACHER', schoolId: 'school-a' },
      { ...foreignExam, courseId: 'course-a' },
      true,
    )).toBe(true);
  });

  test('rejects teacher if not assigned to the exam course', () => {
    expect(canManageExamRecord(
      { id: 'teacher-a', role: 'TEACHER', schoolId: 'school-a' },
      { ...foreignExam, courseId: 'course-a' },
      false,
    )).toBe(false);
  });

  test('rejects access when user or exam is missing or malformed', () => {
    expect(canManageExamRecord(undefined, foreignExam, false)).toBe(false);
    expect(canManageExamRecord({ id: 'admin-a', role: 'SCHOOL_ADMIN' }, undefined, false)).toBe(false);
  });

  test('validates cross-exam moves require ownership on BOTH source and target', () => {
    const userA = { id: 'admin-a', role: 'SCHOOL_ADMIN', schoolId: 'school-a' };
    const ownExamA = { isCentral: false, schoolId: 'school-a', schools: [] };

    // Move from own to foreign -> must fail target check
    const canManageSource = canManageExamRecord(userA, ownExamA, false);
    const canManageTarget = canManageExamRecord(userA, foreignExam, false);

    expect(canManageSource).toBe(true);
    expect(canManageTarget).toBe(false);
    // Combined condition enforced in postExamHandler25 & postExamHandler26
    expect(canManageSource && canManageTarget).toBe(false);
  });

  test('resolveExamSchoolUpdate properly strips central flag when assigned to specific schools', () => {
    const result = resolveExamSchoolUpdate(
      { isCentral: true, schoolId: null, schools: [] },
      { schoolIds: ['school-a', 'school-b'] }
    );
    expect(result.isCentral).toBe(false);
    expect(result.schoolId).toBe('school-a');
    expect(result.schools.set).toEqual([{ id: 'school-a' }, { id: 'school-b' }]);
  });
});
