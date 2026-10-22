import { validateCompetitionQuestion } from '../lib/competitionQuestions';
import { Prisma } from '@prisma/client';
import { resolveCompetitionAudience } from './competitionAudience';

const fail = (code: string) => { throw Object.assign(new Error(code), { http: 409 }); };
export const questionSnapshot = (questions: any[]) => JSON.parse(JSON.stringify(questions));
export const attemptQuestions = (entry: any, fallback: any[]): any[] => Array.isArray(entry?.questionSnapshot) && entry.questionSnapshot.length ? entry.questionSnapshot : fallback;
const stable = (value: any): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(item => JSON.parse(stable(item))) : Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, JSON.parse(stable(value[key]))])) : value);
const signature = (questions: any[]) => stable(questions.map((question, index) => { const { id, ...data } = validateCompetitionQuestion(question, index, true); return data; }));

// Caller holds the same competition advisory lock used by joining and answering.
export async function saveCompetitionEdits(db: any, user: any, room: any, data: any, input: any) {
  if (!['DRAFT', 'OPEN', 'FINISHED'].includes(room.status)) fail('EDIT_CLOSED');
  const count = await db.competitionEntry.count({ where: { competitionId: room.id } });
  const { questions, ...details } = data;
  if (room.status !== 'DRAFT') {
    if (!questions.length) fail('EMPTY_COMPETITION');
    questions.forEach((question: any, index: number) => validateCompetitionQuestion(question, index));
  }
  if (count && ['mode', 'scoringMode', 'teams'].some(field => details[field] !== (room[field] ?? (field === 'scoringMode' ? 'SPEED' : false)))) fail('PLAY_SETTINGS_LOCKED');
  if (details.capacity < count) fail('CAPACITY_BELOW_PARTICIPANTS');
  let audience: any = {};
  if ((input.schoolId !== undefined && (input.schoolId || null) !== (room.schoolId || null)) || details.grade !== (room.grade || null)) {
    audience = await resolveCompetitionAudience(db, user, room, { schoolId: input.schoolId === undefined ? room.schoolId : input.schoolId || null, grade: details.grade });
  }
  const changed = signature(questions) !== signature(room.questions);
  if (changed && room.mode === 'LIVE' && room.status === 'OPEN' && (room.currentIndex >= 0 || count > 0)) fail('LIVE_QUESTIONS_LOCKED');
  if (changed) {
    // Old question rows remain referenced by answers. Existing entrants retain
    // their own immutable set, while future entrants receive the revised set.
    await db.competitionEntry.updateMany({ where: { competitionId: room.id, questionSnapshot: { equals: Prisma.DbNull } }, data: { questionSnapshot: questionSnapshot(room.questions) } });
    await db.competitionQuestion.updateMany({ where: { competitionId: room.id, active: true }, data: { active: false } });
    const oldest = await db.competitionQuestion.findFirst({ where: { competitionId: room.id }, orderBy: { order: 'asc' }, select: { order: true } });
    const start = Math.min(oldest?.order ?? 0, 0) - room.questions.length - 1;
    // The unique (competitionId, order) key also covers retained versions.
    for (let index = 0; index < room.questions.length; index++) await db.competitionQuestion.update({ where: { id: room.questions[index].id }, data: { order: start + index } });
    await db.competitionQuestion.createMany({ data: questions.map(({ id, ...question }: any) => ({ ...question, competitionId: room.id, active: true })) });
  }
  return db.competition.update({ where: { id: room.id }, data: { ...details, ...audience }, select: { id: true } });
}
