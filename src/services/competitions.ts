import { publicCompetitionOptions } from '../lib/competitionQuestions';
import prisma from '../lib/prisma';
import { canManageCompetition, canPlayCompetition, defaultCompetitionPolicy, periodStart, studentCompetitionWhere } from '../lib/competitionPolicy';
import { competitionContentAccess, contentStudentHref } from './contentCompetitions';
import { attemptQuestions } from './competitionEditing';
export const rankOrder: any = [{ score: 'desc' }, { correct: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];
export async function competitionPolicy(user: any, db: any = prisma) {
  const rows = await db.competitionPolicy.findMany({ where: { key: { in: ['platform', `school:${user.schoolId}`] } } });
  const global = { ...defaultCompetitionPolicy, ...rows.find((r: any) => r.key === 'platform') };
  const school = { ...defaultCompetitionPolicy, ...rows.find((r: any) => r.key === `school:${user.schoolId}`) };
  return { enabled: global.enabled && school.enabled, publicBoard: global.publicBoard && school.publicBoard, sound: global.sound && school.sound, motion: global.motion && school.motion, leaderboard: global.leaderboard && school.leaderboard };
}
export const roomSummary = (room: any) => ({ id: room.id, title: room.title, titleEn: room.titleEn, description: room.description, descriptionEn: room.descriptionEn, mode: room.mode, status: room.status, teams: room.teams, grade: room.grade, subject: room.subject, scoringMode: room.scoringMode, sourceKind: room.sourceKind, sourceId: room.sourceId, opensAt: room.opensAt, closesAt: room.closesAt, prizeLabel: room.prizeLabel, prizePlaces: room.prizePlaces, publicBoard: room.publicBoard, capacity: room.capacity, secondsPerQuestion: room.questions?.[0]?.seconds, currentIndex: room.currentIndex, questionStartedAt: room.questionStartedAt, finishedAt: room.finishedAt, schoolId: room.schoolId, schoolName: room.school?.name || 'Klevro', questionCount: room._count?.questions ?? room.questions?.length ?? 0, participants: room._count?.entries ?? 0 });
export async function readCompetitionRoom(user: any, id: string) {
  const room = await prisma.competition.findUnique({ where: { id }, include: { questions: { where: { active: true }, orderBy: { order: 'asc' } }, school: { select: { name: true } }, _count: { select: { entries: true } } } });
  if (!room || !(canManageCompetition(user, room) || canPlayCompetition(user, room))) return null;
  const content = await competitionContentAccess(user, room, prisma, user.role === 'STUDENT');
  const admin = canManageCompetition(user, room); const policy = await competitionPolicy(user);
  if (!admin && !policy.enabled) return { disabled: true, policy, room: roomSummary(room) };
  const [entry, leaders, teams] = await Promise.all([
    user.role === 'STUDENT' ? prisma.competitionEntry.findUnique({ where: { competitionId_studentId: { competitionId: id, studentId: user.id } }, include: { answers: { orderBy: { question: { order: 'desc' } } }, award: true } }) : null,
    policy.leaderboard || admin ? prisma.competitionEntry.findMany({ where: { competitionId: id, student: { status: 'ACTIVE', deletedAt: null } }, orderBy: rankOrder, take: 5, select: { id: true, studentId: true, score: true, correct: true, team: true, finishedAt: true, student: { select: { name: true } } } }) : [],
    room.teams && (policy.leaderboard || admin) ? prisma.competitionEntry.groupBy({ by: ['team'], where: { competitionId: id, student: { status: 'ACTIVE', deletedAt: null } }, _sum: { score: true }, _count: true }) : [],
  ]);
  const index = room.mode === 'LIVE' ? room.currentIndex : entry?.currentIndex ?? 0;
  const questions = attemptQuestions(entry, room.questions);
  const q = questions[index]; const startedAt = room.mode === 'LIVE' ? room.questionStartedAt : entry?.questionStartedAt;
  const now = new Date(); const isClosed = room.status === 'FINISHED' || !!(room.closesAt && room.closesAt <= now);
  const currentAnswer = entry?.answers.find(answer => answer.questionId === q?.id);
  const feedbackAnswer = room.mode === 'LIVE' ? currentAnswer : !entry?.questionStartedAt ? entry?.answers[0] : null;
  const answeredQ = questions.find(question => question.id === feedbackAnswer?.questionId);
  const rank = entry ? 1 + await prisma.competitionEntry.count({ where: { competitionId: id, OR: [{ score: { gt: entry.score } }, { score: entry.score, correct: { gt: entry.correct } }, { score: entry.score, correct: entry.correct, createdAt: { lt: entry.createdAt } }, { score: entry.score, correct: entry.correct, createdAt: entry.createdAt, id: { lt: entry.id } }] } }) : null;
  return { room: { ...roomSummary(room), questionCount: questions.length }, serverNow: now, policy, admin, studentHref: content ? contentStudentHref(content) : null, passwordRequired: !!content?.password,
    question: !isClosed && q && startedAt && (admin || entry) ? { id: q.id, text: q.text, textEn: q.textEn, type: q.type || 'MCQ', points: q.points ?? 100, options: admin ? q.options : publicCompetitionOptions(q.options, q.type, q.id), optionsEn: admin ? q.optionsEn : publicCompetitionOptions(q.optionsEn, q.type, q.id), seconds: q.seconds, index, startedAt, ...(admin ? { correctIndex: q.correctIndex, correctAnswer: q.correctAnswer } : {}), ...((q.metadata as any)?.imageUrl ? { imageUrl: (q.metadata as any).imageUrl } : {}) } : null,
    entry: entry ? { id: entry.id, score: entry.score, correct: entry.correct, team: entry.team, finishedAt: entry.finishedAt, currentIndex: entry.currentIndex, rank, award: entry.award, answered: !!currentAnswer } : null,
    feedback: feedbackAnswer ? { correct: feedbackAnswer.correct, points: feedbackAnswer.points, correctIndex: answeredQ?.correctIndex, correctAnswer: answeredQ?.correctAnswer ?? answeredQ?.options?.[answeredQ?.correctIndex], correctAnswerEn: answeredQ?.correctAnswerEn, questionId: feedbackAnswer.questionId } : null,
    leaders: leaders.map((item, index) => ({ rank: index + 1, name: item.student.name.split(/\s+/)[0], score: item.score, correct: item.correct, team: item.team, isMe: item.studentId === user.id })),
    teamScores: teams.map(team => ({ team: team.team, score: team._sum.score || 0, members: team._count })),
    ...(admin ? { questions: room.questions, awards: await prisma.competitionAward.findMany({ where: { entry: { competitionId: id } }, include: { entry: { include: { student: { select: { name: true } } } } }, orderBy: { rank: 'asc' } }) } : {}),
  };
}
export async function competitionLeaderboard(user: any | null, period = 'WEEK', now = new Date()) {
  const global = await prisma.competitionPolicy.findUnique({ where: { key: 'platform' } });
  if (global?.enabled === false || global?.leaderboard === false || (!user && !global?.publicBoard)) return { enabled: false, items: [], period };
  let where: any = { finishedAt: { gte: periodStart(period, now) }, student: { status: 'ACTIVE', deletedAt: null }, competition: { status: 'FINISHED' } };
  if (!user) {
    const schools = await prisma.competitionPolicy.findMany({ where: { publicBoard: true, enabled: true, leaderboard: true, key: { startsWith: 'school:' } }, select: { key: true } });
    const ids = schools.map(s => s.key.slice(7));
    where.student = { ...where.student, schoolId: { in: ids }, school: { is: { status: 'ACTIVE' } }, competitionProfile: { is: { publicName: true } } };
    where.competition = { status: 'FINISHED', publicBoard: true, OR: [{ schoolId: null }, { schoolId: { in: ids } }] };
  } else {
    const policy = await competitionPolicy(user); if (!policy.enabled || !policy.leaderboard) return { enabled: false, items: [], period };
    where.competition = { ...studentCompetitionWhere(user), status: 'FINISHED' };
    where.student.schoolId = user.schoolId || '__none__';
  }
  const ranked = await prisma.competitionEntry.groupBy({ by: ['studentId'], where, _sum: { score: true, correct: true }, _count: true, orderBy: [{ _sum: { score: 'desc' } }, { _sum: { correct: 'desc' } }, { studentId: 'asc' }], take: 5 });
  const students = await prisma.user.findMany({ where: { id: { in: ranked.map(row => row.studentId) } }, select: { id: true, name: true, school: { select: { name: true } } } });
  return { enabled: true, period, items: ranked.map((row, index) => { const student = students.find(s => s.id === row.studentId); return { rank: index + 1, name: student?.name.split(/\s+/)[0] || '', school: student?.school?.name || '', score: row._sum.score || 0, correct: row._sum.correct || 0, competitions: row._count, isMe: user?.id === row.studentId }; }) };
}
