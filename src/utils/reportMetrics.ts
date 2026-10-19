export type AttemptPolicy = 'first' | 'latest' | 'best';

export function attemptPolicy(raw: unknown): AttemptPolicy {
  if (raw === undefined || raw === '') return 'latest';
  if (raw === 'first' || raw === 'latest' || raw === 'best') return raw;
  throw new Error('Invalid attempt policy');
}

export function selectAttempts<T extends { id: string; userId: string; examId: string; subExamId?: string | null; createdAt: Date | string; percentage?: number | null }>(rows: T[], policy: AttemptPolicy) {
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = JSON.stringify([row.userId, row.examId, row.subExamId || null]);
    const previous = result.get(key);
    const time = new Date(row.createdAt).getTime(), previousTime = previous ? new Date(previous.createdAt).getTime() : 0;
    const newer = !previous || time > previousTime || (time === previousTime && row.id > previous.id);
    if (!previous || (policy === 'first' ? !newer : policy === 'latest' ? newer
      : (row.percentage ?? -1) > (previous.percentage ?? -1) || (row.percentage === previous.percentage && newer))) result.set(key, row);
  }
  return [...result.values()];
}

export function roundMetric(value: number) { return Math.round(value * 10) / 10; }
export function ratio(numerator: number, denominator: number) { return denominator ? roundMetric(numerator / denominator * 100) : null; }

export function passingThreshold(row: any) {
  return Number(row.reportSnapshot?.passingScore ?? row.passingScoreAtSubmission ?? row.subExam?.passingScore ?? row.exam?.passingScore ?? 50);
}

export function attemptPassed(row: any) {
  if (typeof row.reportSnapshot?.passed === 'boolean') return row.reportSnapshot.passed;
  const total = row.reportSnapshot?.totalQuestions ?? row.totalQuestions;
  const correct = row.reportSnapshot?.correctAnswers ?? row.correctAnswers;
  // Match the existing result page's weighted-score and minimum-correct policy.
  return typeof row.percentage === 'number' && row.percentage >= passingThreshold(row)
    && (typeof total !== 'number' || typeof correct !== 'number' || correct >= Math.ceil(total / 2));
}

export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
