import { buildQuestionFingerprint } from '../lib/contentReconciliation';

/** A draft question can reach the server through more than one editor list. */
export function deduplicateExamQuestionInput(questions: any[]): any[] {
  const ids = new Set<string>();
  const drafts = new Set<string>();
  return questions.filter(question => {
    if (!question) return false;
    const id = question.id === undefined || question.id === null ? '' : String(question.id).trim();
    if (id && ids.has(id)) return false;
    if (id) ids.add(id);
    // Keep separate persisted rows and identical questions in different sections.
    const persisted = id && !/^[\d.]+$/.test(id) && !/^(temp|draft|new)[_-]/i.test(id);
    if (persisted) return true;
    const key = JSON.stringify([question.moduleId ?? null, question.subExamId ?? null, buildQuestionFingerprint(question), question.imageUrl ?? null, question.videoUrl ?? null]);
    if (drafts.has(key)) return false;
    drafts.add(key);
    return true;
  });
}
