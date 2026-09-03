export type ExamAccessRecord = {
  isCentral?: boolean | null;
  schoolId?: string | null;
  creatorId?: string | null;
  courseId?: string | null;
  schools?: Array<{ id: string }>;
};

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
