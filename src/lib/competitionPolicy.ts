import { COMPETITION_QUESTION_LIMIT, validateCompetitionQuestion } from './competitionQuestions';
import { getStudentGradeAndStage } from '../shared';
import { addCalendarDays, egyptDay, egyptDayStart, parseEgyptDate } from '../utils/egyptTime';
export const ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN'];
export const defaultCompetitionPolicy = { enabled: true, publicBoard: false, sound: true, motion: true, leaderboard: true };
export const policyKey = (user: any) => user.role === 'SUPER_ADMIN' ? 'platform' : `school:${user.schoolId}`;
export function canManageCompetition(user: any, room: any) {
  return user.role === 'SUPER_ADMIN' || (user.role === 'SCHOOL_ADMIN' && !!user.schoolId && user.schoolId === room.schoolId);
}
export function studentCompetitionWhere(user: any) {
  return { status: { notIn: ['DRAFT', 'CANCELLED'] }, AND: [
    { OR: [{ schoolId: null }, { schoolId: user.schoolId || '__none__' }] },
    { OR: [{ grade: null }, { grade: { in: getStudentGradeAndStage(user.grade) } }] },
  ] };
}
export function canPlayCompetition(user: any, room: any) {
  return user.role === 'STUDENT' && !['DRAFT', 'CANCELLED'].includes(room.status) &&
    (!room.schoolId || room.schoolId === user.schoolId) && (!room.grade || getStudentGradeAndStage(user.grade).includes(room.grade));
}
export function competitionPoints(correct: boolean, elapsedMs: number, seconds: number) {
  return correct && elapsedMs >= 0 && elapsedMs <= seconds * 1000 ? 100 + Math.floor(50 * Math.max(0, 1 - elapsedMs / (seconds * 1000))) : 0;
}
export function competitionQuestionPoints(question: any, correct: boolean, elapsedMs: number, scoringMode: string) {
  if (!correct) return 0;
  return scoringMode === 'POINTS' ? question.points ?? 100 : Math.floor(competitionPoints(true, elapsedMs, question.seconds) * (question.points ?? 100) / 100);
}
export function periodStart(period: string, now = new Date()) {
  const day = egyptDay(now);
  if (period === 'WEEK') { const weekday = new Date(day + 'T12:00:00Z').getUTCDay(); return egyptDayStart(addCalendarDays(day, -((weekday + 6) % 7))); }
  if (period === 'MONTH') return egyptDayStart(day.slice(0, 8) + '01');
  return new Date(0);
}
export function validateCompetition(input: any, allowEmpty = false) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160) throw new Error('TITLE');
  if (!['SELF_PACED', 'LIVE'].includes(input.mode) || !['GENERAL', 'COURSE', 'EXAM', 'ACTIVITY'].includes(input.sourceKind || 'GENERAL')) throw new Error('MODE');
  if (!Array.isArray(input.questions) || input.questions.length < (allowEmpty ? 0 : 1) || input.questions.length > COMPETITION_QUESTION_LIMIT) throw new Error('QUESTIONS');
  const questions = input.questions.map((q: any, order: number) => validateCompetitionQuestion(q, order, allowEmpty));
  if (input.scoringMode && !['SPEED', 'POINTS'].includes(input.scoringMode)) throw new Error('SCORING');
  const optional = (value: any, max: number) => { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'string' || value.length > max) throw new Error('DETAILS'); return value.trim() || null; };
  const opensAt = input.opensAt ? parseEgyptDate(input.opensAt) : null; const closesAt = input.closesAt ? parseEgyptDate(input.closesAt) : null;
  if ((opensAt && !Number.isFinite(opensAt.getTime())) || (closesAt && !Number.isFinite(closesAt.getTime())) || (opensAt && closesAt && closesAt <= opensAt)) throw new Error('SCHEDULE');
  return { title: input.title.trim(), titleEn: optional(input.titleEn, 160), description: optional(input.description, 1500), descriptionEn: optional(input.descriptionEn, 1500), mode: input.mode, subject: optional(input.subject, 100), scoringMode: input.scoringMode || 'SPEED', grade: optional(input.grade, 100), sourceKind: input.sourceKind || 'GENERAL', sourceId: optional(input.sourceId, 100), teams: input.teams === true, publicBoard: input.publicBoard === true, prizeLabel: optional(input.prizeLabel, 160), prizePlaces: Math.floor(Math.max(1, Math.min(5, Number(input.prizePlaces) || 3))), capacity: Math.floor(Math.max(2, Math.min(500, Number(input.capacity) || 200))), opensAt, closesAt, questions };
}
