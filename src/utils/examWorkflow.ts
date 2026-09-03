export type Availability = 'UPCOMING' | 'EXPIRED' | 'AVAILABLE';

export function mergeStudentProfile(tokenUser: Record<string, unknown> & { grade?: string | null; schoolId?: string | null }, dbUser?: { grade?: string | null; schoolId?: string | null } | null) {
  if (!dbUser) return tokenUser;
  return {
    ...tokenUser,
    grade: dbUser.grade ?? tokenUser.grade,
    schoolId: dbUser.schoolId ?? tokenUser.schoolId,
  };
}

type CountedQuestions = {
  questions?: unknown[];
  _count?: { questions?: number };
};

export function countQuestions(item: CountedQuestions | null | undefined): number {
  if (!item) return 0;
  if (typeof item._count?.questions === 'number') return item._count.questions;
  return Array.isArray(item.questions) ? item.questions.length : 0;
}

export function countModuleContent(module: CountedQuestions & { subExams?: CountedQuestions[] }): {
  examsCount: number;
  questionsCount: number;
} {
  const subExams = Array.isArray(module.subExams) ? module.subExams : [];
  return {
    examsCount: subExams.length,
    // New workflow owns questions on child Exams. Direct Module questions are
    // legacy content and must not inflate totals when child Exams exist.
    questionsCount: subExams.length > 0
      ? subExams.reduce((total, subExam) => total + countQuestions(subExam), 0)
      : countQuestions(module),
  };
}

export function getAvailability(entity: { publishDate?: string | Date | null; cutOffDate?: string | Date | null }, now = new Date()): Availability {
  if (entity.publishDate && now < new Date(entity.publishDate)) return 'UPCOMING';
  if (entity.cutOffDate && now > new Date(entity.cutOffDate)) return 'EXPIRED';
  return 'AVAILABLE';
}

export function filterQuestionsForSubExam<T extends { subExamId?: string | null }>(questions: T[], subExamId?: string | null): T[] {
  if (!subExamId) return questions;
  return questions.filter((question) => question.subExamId === subExamId);
}

export function resolveExamAccessPassword(
  exam: { password?: string | null } | null | undefined,
  selectedSubExam?: ({ password?: string | null } & Record<string, unknown>) | null,
): string | null {
  if (selectedSubExam?.password) return selectedSubExam.password;
  return exam?.password || null;
}
