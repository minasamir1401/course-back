function normalizeRole(role) {
  return String(role || '').toUpperCase();
}

function collectExamAccessCandidates(input) {
  const exam = input?.exam || {};
  const users = Array.isArray(input?.users) ? input.users : [];
  const examSchools = Array.isArray(exam.schools) ? exam.schools : [];
  const teacherCourseUserIds = new Set(Array.isArray(input?.teacherCourseUserIds) ? input.teacherCourseUserIds : []);
  const seen = new Set();

  const candidates = users
    .map((user) => {
      const role = normalizeRole(user.role);
      const belongsToOwnerSchool = Boolean(user.schoolId && exam.schoolId && user.schoolId === exam.schoolId);
      const assignedViaExamSchools = Boolean(user.schoolId && examSchools.some((school) => school.id === user.schoolId));
      const isCreator = Boolean(user.id && exam.creatorId && user.id === exam.creatorId);
      const teacherCourseLinked = teacherCourseUserIds.has(user.id);

      let priority = 99;
      if (isCreator) priority = 1;
      else if (belongsToOwnerSchool && role === 'SCHOOL_ADMIN') priority = 2;
      else if (assignedViaExamSchools && role === 'SCHOOL_ADMIN') priority = 3;
      else if (belongsToOwnerSchool) priority = 4;
      else if (assignedViaExamSchools) priority = 5;
      else if (teacherCourseLinked) priority = 6;
      else if (role === 'SUPER_ADMIN') priority = 7;

      return {
        ...user,
        role,
        belongsToOwnerSchool,
        assignedViaExamSchools,
        isCreator,
        teacherCourseLinked,
        priority,
      };
    })
    .filter((user) => {
      if (!user?.id || seen.has(user.id)) return false;
      seen.add(user.id);
      return user.priority < 99;
    })
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return String(left.username || left.id).localeCompare(String(right.username || right.id));
    });

  return candidates;
}

function buildExamAccessDiagnosis(input) {
  const exam = input?.exam || {};
  const user = input?.user || {};
  const role = normalizeRole(user.role);
  const examSchools = Array.isArray(exam.schools) ? exam.schools : [];
  const userSchoolId = user.schoolId || null;

  const flags = {
    isCentral: Boolean(exam.isCentral),
    belongsToOwnerSchool: Boolean(userSchoolId && exam.schoolId && exam.schoolId === userSchoolId),
    assignedViaExamSchools: Boolean(userSchoolId && examSchools.some((school) => school.id === userSchoolId)),
    isCreator: Boolean(user.id && exam.creatorId && user.id === exam.creatorId),
    linkedThroughTeacherCourse: Boolean(input?.teacherCourseLinked),
    hasCourse: Boolean(exam.courseId),
  };

  const detailAccessibleUnderCurrentCode = role === 'SUPER_ADMIN'
    || flags.isCentral
    || flags.belongsToOwnerSchool
    || flags.assignedViaExamSchools
    || flags.isCreator
    || (role === 'TEACHER' && flags.linkedThroughTeacherCourse);

  let listVisibleUnderCurrentCode = false;
  if (role === 'SUPER_ADMIN') {
    listVisibleUnderCurrentCode = true;
  } else if (role === 'SCHOOL_ADMIN') {
    listVisibleUnderCurrentCode = flags.isCentral || flags.belongsToOwnerSchool || flags.assignedViaExamSchools;
  } else if (role === 'TEACHER') {
    listVisibleUnderCurrentCode = flags.isCreator || flags.linkedThroughTeacherCourse;
  } else if (role === 'SUPERVISOR') {
    listVisibleUnderCurrentCode = flags.isCentral || flags.belongsToOwnerSchool || flags.assignedViaExamSchools || flags.isCreator;
  }

  const apiChecks = input?.apiChecks || {};
  const apiDeniedDetail = typeof apiChecks.detailStatus === 'number' && apiChecks.detailStatus === 403;
  const runtimeMismatch = detailAccessibleUnderCurrentCode && apiDeniedDetail;

  let likelyCause = 'access-allowed';
  if (runtimeMismatch) {
    likelyCause = 'runtime-or-deploy-mismatch';
  } else if (!detailAccessibleUnderCurrentCode) {
    likelyCause = 'data-access-mismatch';
  }

  return {
    exam: {
      id: exam.id || null,
      isCentral: flags.isCentral,
      schoolId: exam.schoolId || null,
      courseId: exam.courseId || null,
      creatorId: exam.creatorId || null,
      examSchools: examSchools.map((school) => ({ id: school.id, name: school.name || null })),
    },
    user: {
      id: user.id || null,
      username: user.username || null,
      role,
      schoolId: userSchoolId,
      status: user.status || null,
    },
    flags,
    expected: {
      listVisibleUnderCurrentCode,
      detailAccessibleUnderCurrentCode,
    },
    apiChecks: {
      listStatus: apiChecks.listStatus ?? null,
      listContainsExam: apiChecks.listContainsExam ?? null,
      detailStatus: apiChecks.detailStatus ?? null,
      detailError: apiChecks.detailError ?? null,
    },
    summary: {
      runtimeMismatch,
      likelyCause,
    },
  };
}

module.exports = {
  buildExamAccessDiagnosis,
  collectExamAccessCandidates,
};
