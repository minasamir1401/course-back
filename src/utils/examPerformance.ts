export function changedQuestionFields(existing: Record<string, any>, incoming: Record<string, any>) {
  return Object.fromEntries(Object.entries(incoming).filter(([key, value]) => value !== undefined && value !== existing[key]));
}

export function changedQuestionOrders(existing: Array<{ id: string; order: number | null }>, ids: string[]) {
  const positions = new Map(existing.map(q => [q.id, q.order]));
  return ids.map((id, order) => ({ id, order })).filter(q => positions.get(q.id) !== q.order);
}

export function calculateSubmissionStats(questions: any[], answers: any[], firstAttempt: boolean) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const answeredIds = new Set(answers.map(a => a.questionId));
  const relevant = questions.filter(q => answeredIds.has(q.id));
  const ordered = [...answers].sort((a, b) => (byId.get(a.questionId)?.order ?? 0) - (byId.get(b.questionId)?.order ?? 0));
  let earnedXP = 0, dynamicTotalScore = 0, streak = 0, bonus = 0;
  let hasFive = false, hasTen = false;
  for (const answer of ordered) {
    const question = byId.get(answer.questionId);
    if (!question) continue;
    if (answer.isCorrect) {
      streak++;
      dynamicTotalScore += Number(question.points) || 0;
      if (firstAttempt) earnedXP += question.xpPoints !== undefined ? Number(question.xpPoints) : 10;
      if (streak === 5 && !hasFive) { bonus += 10; hasFive = true; }
      if (streak === 10 && !hasTen) { bonus += 30; hasTen = true; }
    } else streak = 0;
  }
  return { earnedXP: earnedXP + (firstAttempt ? bonus : 0), dynamicTotalScore,
    totalPoints: relevant.reduce((sum, q) => sum + (Number(q.points) || 0), 0),
    correctAnswers: answers.filter(a => a.isCorrect).length, totalQuestions: relevant.length };
}
