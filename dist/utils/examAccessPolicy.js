"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canManageExamRecord = void 0;
exports.resolveExamSchoolUpdate = resolveExamSchoolUpdate;
// Partial saves must not erase an audience. Making an assigned exam central
// requires explicitly clearing its school selection as well.
function resolveExamSchoolUpdate(existing, payload) {
    var _a, _b;
    if (payload.isCentral === undefined && payload.schoolIds === undefined && payload.schoolId === undefined)
        return {};
    const raw = payload.schoolIds !== undefined ? payload.schoolIds
        : payload.schoolId !== undefined ? (payload.schoolId ? [payload.schoolId] : [])
            : [existing.schoolId, ...(existing.schools || []).map(school => school.id)];
    const ids = [...new Set((Array.isArray(raw) ? raw : [raw])
            .map((item) => typeof item === 'object' && item ? item.id : item)
            .filter((id) => typeof id === 'string' && !!id.trim() && id !== 'null' && id !== 'undefined')
            .map((id) => id.trim()))];
    const isCentral = ids.length > 0 ? false : ((_b = (_a = payload.isCentral) !== null && _a !== void 0 ? _a : existing.isCentral) !== null && _b !== void 0 ? _b : false);
    return { isCentral, schoolId: ids[0] || null, schools: { set: ids.map(id => ({ id })) } };
}
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
