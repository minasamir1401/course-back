"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canManageExamRecord = void 0;
const canManageExamRecord = (user, exam, hasTeacherCourseAccess) => {
    if (!user || !exam)
        return false;
    if (user.role === 'SUPER_ADMIN')
        return true;
    // Central content is shared across schools and is mutable only by super admins.
    if (exam.isCentral)
        return false;
    const belongsToSchool = Boolean(user.schoolId && (exam.schoolId === user.schoolId ||
        (exam.schools || []).some((school) => school.id === user.schoolId)));
    return belongsToSchool || exam.creatorId === user.id || (user.role === 'TEACHER' && hasTeacherCourseAccess);
};
exports.canManageExamRecord = canManageExamRecord;
