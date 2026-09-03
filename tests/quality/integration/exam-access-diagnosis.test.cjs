const {
  buildExamAccessDiagnosis,
  collectExamAccessCandidates,
} = require('../../../src/scripts/lib/exam-access-diagnosis.js');

describe('exam access diagnosis helper', () => {
  test('teacher gets detail access through teacher-course assignment', () => {
    const diagnosis = buildExamAccessDiagnosis({
      exam: {
        id: 'exam-1',
        isCentral: false,
        schoolId: 'owner-school',
        creatorId: 'creator-1',
        courseId: 'course-1',
        schools: [],
      },
      user: {
        id: 'teacher-1',
        role: 'TEACHER',
        schoolId: 'teacher-school',
      },
      teacherCourseLinked: true,
    });

    expect(diagnosis.flags.belongsToOwnerSchool).toBe(false);
    expect(diagnosis.flags.linkedThroughTeacherCourse).toBe(true);
    expect(diagnosis.expected.detailAccessibleUnderCurrentCode).toBe(true);
    expect(diagnosis.expected.listVisibleUnderCurrentCode).toBe(true);
  });

  test('school admin without ownership or assignment stays blocked', () => {
    const diagnosis = buildExamAccessDiagnosis({
      exam: {
        id: 'exam-2',
        isCentral: false,
        schoolId: 'owner-school',
        creatorId: 'creator-1',
        courseId: null,
        schools: [],
      },
      user: {
        id: 'school-admin-1',
        role: 'SCHOOL_ADMIN',
        schoolId: 'another-school',
      },
      teacherCourseLinked: false,
    });

    expect(diagnosis.expected.detailAccessibleUnderCurrentCode).toBe(false);
    expect(diagnosis.expected.listVisibleUnderCurrentCode).toBe(false);
    expect(diagnosis.summary.likelyCause).toBe('data-access-mismatch');
  });

  test('api mismatch summary points to stale deploy when logic allows but api blocks', () => {
    const diagnosis = buildExamAccessDiagnosis({
      exam: {
        id: 'exam-3',
        isCentral: false,
        schoolId: 'owner-school',
        creatorId: 'creator-1',
        courseId: 'course-1',
        schools: [],
      },
      user: {
        id: 'teacher-1',
        role: 'TEACHER',
        schoolId: 'teacher-school',
      },
      teacherCourseLinked: true,
      apiChecks: {
        detailStatus: 403,
        listContainsExam: true,
      },
    });

    expect(diagnosis.summary.runtimeMismatch).toBe(true);
    expect(diagnosis.summary.likelyCause).toBe('runtime-or-deploy-mismatch');
  });

  test('auto mode prioritizes likely relevant users without duplicates', () => {
    const candidates = collectExamAccessCandidates({
      exam: {
        schoolId: 'owner-school',
        creatorId: 'creator-1',
        schools: [{ id: 'assigned-school' }],
      },
      users: [
        { id: 'teacher-1', username: 'teacher-1', role: 'TEACHER', schoolId: 'other-school' },
        { id: 'teacher-2', username: 'teacher-2', role: 'TEACHER', schoolId: 'assigned-school' },
        { id: 'admin-1', username: 'admin-1', role: 'SCHOOL_ADMIN', schoolId: 'owner-school' },
        { id: 'super-1', username: 'super-1', role: 'SUPER_ADMIN', schoolId: null },
        { id: 'creator-1', username: 'creator-1', role: 'TEACHER', schoolId: 'owner-school' },
      ],
      teacherCourseUserIds: ['teacher-1', 'creator-1'],
    });

    expect(candidates.map((candidate) => candidate.username)).toEqual([
      'creator-1',
      'admin-1',
      'teacher-2',
      'teacher-1',
      'super-1',
    ]);
    expect(candidates.find((candidate) => candidate.username === 'teacher-1').teacherCourseLinked).toBe(true);
  });
});
