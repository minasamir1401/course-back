import prisma from '../lib/prisma';
import { canManageCompetition } from '../lib/competitionPolicy';
import { roomSummary, rankOrder } from './competitions';
import { attemptQuestions } from './competitionEditing';

const missing = (): never => { throw Object.assign(new Error('NOT_FOUND'), { http: 404 }); };
async function resultRoom(user: any, id: string) {
  const room = await prisma.competition.findUnique({ where: { id }, include: { questions: { where: { active: true }, orderBy: { order: 'asc' } }, school: { select: { name: true } }, _count: { select: { entries: true } } } });
  if (!room || !canManageCompetition(user, room)) missing();
  return room!;
}
const studentSelect = { id: true, name: true, grade: true, school: { select: { name: true } } };
export async function listCompetitionResults(user: any, id: string, query: any) {
  const room = await resultRoom(user, id);
  const requestedPage = Number(query.page);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.min(2001, Math.floor(requestedPage) || 1)) : 1;
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
  const where = { competitionId: id, ...(search ? { student: { name: { contains: search, mode: 'insensitive' as const } } } : {}) };
  const [total, entries] = await Promise.all([
    prisma.competitionEntry.count({ where }),
    prisma.competitionEntry.findMany({ where, orderBy: rankOrder, skip: (page - 1) * 50, take: 50, select: { id: true, score: true, correct: true, finishedAt: true, createdAt: true, questionSnapshot: true, student: { select: studentSelect }, _count: { select: { answers: true } } } }),
  ]);
  return { room: roomSummary(room), total, page, pages: Math.ceil(total / 50), entries: entries.map(entry => ({ id: entry.id, student: entry.student, score: entry.score, correct: entry.correct, answered: entry._count.answers, questionCount: attemptQuestions(entry, room.questions).length, finishedAt: entry.finishedAt, joinedAt: entry.createdAt })) };
}
export async function readCompetitionResult(user: any, id: string, entryId: string) {
  const room = await resultRoom(user, id);
  const entry = await prisma.competitionEntry.findFirst({ where: { id: entryId, competitionId: id }, include: { student: { select: studentSelect }, answers: true } });
  if (!entry) missing();
  const questions = attemptQuestions(entry, room.questions);
  const answers = questions.map((question: any, index: number) => {
    const answer = entry!.answers.find(item => item.questionId === question.id);
    const value = answer?.answer ?? (answer?.selectedIndex != null && Array.isArray(question.options) ? question.options[answer.selectedIndex] : null);
    return { questionId: question.id, index: index + 1, type: question.type || 'MCQ', text: question.text, textEn: question.textEn, options: question.options, optionsEn: question.optionsEn, correctAnswer: question.correctAnswer ?? question.options?.[question.correctIndex], correctAnswerEn: question.correctAnswerEn, explanation: question.metadata?.explanation, explanationEn: question.metadata?.explanationEn, answer: value, correct: answer?.correct ?? null, points: answer?.points ?? 0, maxPoints: question.points ?? 100, elapsedMs: answer?.elapsedMs ?? null, status: !answer ? 'UNANSWERED' : (answer.elapsedMs > question.seconds * 1000 || value === null) ? 'TIMED_OUT' : answer.correct ? 'CORRECT' : 'INCORRECT' };
  });
  return { room: roomSummary(room), entry: { id: entry!.id, student: entry!.student, score: entry!.score, correct: entry!.correct, finishedAt: entry!.finishedAt, joinedAt: entry!.createdAt, questionCount: questions.length }, answers };
}
