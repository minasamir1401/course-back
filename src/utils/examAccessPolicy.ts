export type ExamAccessRecord = {
  isCentral?: boolean | null;
  schoolId?: string | null;
  creatorId?: string | null;
  courseId?: string | null;
  schools?: Array<{ id: string }>;
};

// Partial saves must not erase an audience. Making an assigned exam central
// requires explicitly clearing its school selection as well.
export function resolveExamSchoolUpdate(existing: ExamAccessRecord, payload: {
  isCentral?: boolean; schoolIds?: unknown; schoolId?: string | null;
}) {
  if (payload.isCentral === undefined && payload.schoolIds === undefined && payload.schoolId === undefined) return {};
  const raw = payload.schoolIds !== undefined ? payload.schoolIds
    : payload.schoolId !== undefined ? (payload.schoolId ? [payload.schoolId] : [])
    : [existing.schoolId, ...(existing.schools || []).map(school => school.id)];
  const ids = [...new Set((Array.isArray(raw) ? raw : [raw])
    .map((item: any) => typeof item === 'object' && item ? item.id : item)
    .filter((id: any): id is string => typeof id === 'string' && !!id.trim() && id !== 'null' && id !== 'undefined')
    .map((id: string) => id.trim()))];
  const isCentral = ids.length > 0 ? false : (payload.isCentral ?? existing.isCentral ?? false);
  return { isCentral, schoolId: ids[0] || null, schools: { set: ids.map(id => ({ id })) } };
}

export const canManageExamRecord = (
  user: { id?: string; role?: string; schoolId?: string } | undefined,
  exam: ExamAccessRecord | undefined,
  hasTeacherCourseAccess: boolean,
): boolean => {
  if (!user || !exam) return false;
  if (user.role === 'SUPER_ADMIN') return true;

  // Central content is shared across schools and is mutable only by super admins.
  if (exam.isCentral) return false;

  const belongsToSchool = Boolean(
    user.schoolId && (
      exam.schoolId === user.schoolId ||
      (exam.schools || []).some((school) => school.id === user.schoolId)
    ),
  );

  return belongsToSchool || exam.creatorId === user.id || (user.role === 'TEACHER' && hasTeacherCourseAccess);
};
