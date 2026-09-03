export function resolvePassingScore(
  examPassingScore: number | null | undefined,
  subExamPassingScore: number | null | undefined,
) {
  return subExamPassingScore ?? examPassingScore ?? 50;
}
