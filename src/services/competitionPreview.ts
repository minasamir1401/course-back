import prisma from '../lib/prisma';
import { canManageCompetition, competitionQuestionPoints } from '../lib/competitionPolicy';
import { competitionAnswerCorrect, publicCompetitionOptions } from '../lib/competitionQuestions';
import { competitionPolicy, roomSummary } from './competitions';
import { competitionContentAccess } from './contentCompetitions';

const fail = (code: string, http = 400): never => { throw Object.assign(new Error(code), { http }); };
async function previewRoom(user: any, id: string) {
  const room = await prisma.competition.findUnique({ where: { id }, include: { questions: { where: { active: true }, orderBy: { order: 'asc' } }, school: { select: { name: true } } } });
  if (!room || !canManageCompetition(user, room)) fail('NOT_FOUND', 404);
  await competitionContentAccess(user, room);
  return room!;
}
export async function readCompetitionPreview(user: any, id: string) {
  const room = await previewRoom(user, id);
  return { preview: true, room: roomSummary(room), policy: await competitionPolicy({ ...user, schoolId: room.schoolId }), questions: room.questions.map(question => ({
    id: question.id, text: question.text, textEn: question.textEn, type: question.type, points: question.points, seconds: question.seconds,
    options: publicCompetitionOptions(question.options, question.type, question.id),
    optionsEn: publicCompetitionOptions(question.optionsEn, question.type, question.id),
    ...((question.metadata as any)?.imageUrl ? { imageUrl: (question.metadata as any).imageUrl } : {}),
  })) };
}
// Authorised administrators can grade a dry run, including drafts and finished
// competitions. This service never creates entries, answers, awards or profiles.
export async function answerCompetitionPreview(user: any, id: string, input: any) {
  const room = await previewRoom(user, id);
  if (typeof input.questionId !== 'string' || !['ar', 'en'].includes(input.language) || !Number.isInteger(input.elapsedMs) || input.elapsedMs < 0 || input.elapsedMs > 86400000) fail('ANSWER');
  const question = room.questions.find(item => item.id === input.questionId);
  if (!question) fail('NOT_FOUND', 404);
  const q = question!;
  const options = input.language === 'en' && Array.isArray(q.optionsEn) ? q.optionsEn : q.options;
  if (input.selectedIndex !== undefined && (!Array.isArray(options) || !Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= options.length)) fail('ANSWER');
  const answer = input.selectedIndex !== undefined ? (options as any[])[input.selectedIndex] : input.answer ?? null;
  if (JSON.stringify(answer).length > 100000) fail('ANSWER');
  const correct = answer !== null && input.elapsedMs <= q.seconds * 1000 && competitionAnswerCorrect(q, answer, input.language);
  return { preview: true, questionId: q.id, correct, points: competitionQuestionPoints(q, correct, input.elapsedMs, room.scoringMode),
    correctIndex: q.correctIndex, correctAnswer: q.correctAnswer ?? (q.options as any)?.[q.correctIndex], correctAnswerEn: q.correctAnswerEn };
}
