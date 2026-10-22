import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma';
import { verifyToken, checkRole } from '../middleware/auth';
import { allowedOrigins, isOriginAllowed } from '../shared';
import { PLATFORM_SUBJECTS, subjectValues } from '../lib/platformSubjects';
import { competitionAnswerCorrect, validateCompetitionQuestion } from '../lib/competitionQuestions';
import { ADMIN_ROLES, canManageCompetition, canPlayCompetition, competitionQuestionPoints, defaultCompetitionPolicy, policyKey, studentCompetitionWhere, validateCompetition } from '../lib/competitionPolicy';
import { competitionLeaderboard, competitionPolicy, rankOrder, readCompetitionRoom, roomSummary } from '../services/competitions';
import { checkContentReference, competitionContentAccess, contentCompetitionQuestions, contentStudentHref, contentCompetitionSchool, CONTENT_KINDS } from '../services/contentCompetitions';
import { importCompetitionQuestions } from '../services/competitionQuestionImport';
import { resolveCompetitionAudience } from '../services/competitionAudience';
import { attemptQuestions, questionSnapshot, saveCompetitionEdits } from '../services/competitionEditing';
import { listCompetitionResults, readCompetitionResult } from '../services/competitionResults';
import { readCompetitionPreview, answerCompetitionPreview } from '../services/competitionPreview';

const router = Router(); const admin = checkRole(ADMIN_ROLES); const student = checkRole(['STUDENT']);
const writes = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false });
const publicLimit = rateLimit({ windowMs: 60000, limit: 90, standardHeaders: true, legacyHeaders: false });
router.use(['/api/competitions', '/api/public/competitions'], (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && !isOriginAllowed(req.headers.origin, allowedOrigins)) return res.status(403).json({ error: 'ORIGIN' });
  next();
});
const asyncRoute = (fn: any) => async (req: any, res: any) => {
  try { await fn(req, res); } catch (error: any) { res.status(error.http || 500).json({ error: error.http ? error.message : 'SERVER_ERROR' }); }
};
function fail(message: string, http = 400): never { throw Object.assign(new Error(message), { http }); }
const lock = async (tx: any, key: string) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`competition:${key}`}))`; };
const roomInclude = { questions: { where: { active: true }, orderBy: { order: 'asc' as const } }, school: { select: { name: true } }, _count: { select: { entries: true, questions: { where: { active: true } } } } };
async function manageRoom(tx: any, user: any, id: string) {
  await lock(tx, id); const room = await tx.competition.findUnique({ where: { id }, include: roomInclude });
  if (!room || !canManageCompetition(user, room)) fail('NOT_FOUND', 404); return room;
}
async function playRoom(tx: any, user: any, id: string) {
  const room = await tx.competition.findUnique({ where: { id }, include: roomInclude });
  if (!room || !canPlayCompetition(user, room)) fail('NOT_FOUND', 404);
  await competitionContentAccess(user, room, tx, true);
  if (!(await competitionPolicy(user, tx)).enabled) fail('DISABLED', 403);
  return room;
}
function playable(room: any, now: Date) {
  if (room.status !== 'OPEN') fail('CLOSED', 409);
  if (room.opensAt && room.opensAt > now) fail('NOT_STARTED', 409);
  if (room.closesAt && room.closesAt <= now) fail('CLOSED', 409);
}
async function validateSource(data: any, schoolId: string | null) {
  if (data.subject && !PLATFORM_SUBJECTS.includes(data.subject)) {
    const scope = schoolId ? { OR: [{ schoolId }, { isCentral: true }, { schools: { some: { id: schoolId } } }] } : {};
    const course = (await prisma.course.findMany({ where: { ...scope, deletedAt: null }, distinct: ['subject'], select: { subject: true } })).find(item => subjectValues(item.subject).includes(data.subject));
    const exam = course ? null : (await prisma.exam.findMany({ where: { ...scope, deletedAt: null }, select: { category: true, subjects: true } })).find(item => [...subjectValues(item.category), ...subjectValues(item.subjects)].includes(data.subject));
    if (!course && !exam) fail('SUBJECT_NOT_FOUND', 400);
  }
  if (data.sourceKind === 'GENERAL') { data.sourceId = null; return; }
  if (!data.sourceId) fail('SOURCE_REQUIRED');
  const scope = schoolId ? { OR: [{ schoolId }, { isCentral: true }, { schools: { some: { id: schoolId } } }] } : {};
  const activityScope = schoolId ? { OR: [{ schoolId }, { isCentral: true }, { schoolIds: { contains: JSON.stringify(schoolId) } }] } : {};
  const source = data.sourceKind === 'COURSE' ? await prisma.course.findFirst({ where: { id: data.sourceId, deletedAt: null, ...scope }, select: { id: true } }) : data.sourceKind === 'EXAM' ? await prisma.exam.findFirst({ where: { id: data.sourceId, deletedAt: null, ...scope }, select: { id: true } }) : await prisma.skillCluster.findFirst({ where: { id: data.sourceId, ...activityScope }, select: { id: true } });
  if (!source) fail('SOURCE_NOT_FOUND', 404);
}
router.get('/api/public/competitions/leaderboard', publicLimit, asyncRoute(async (req: any, res: any) => res.json(await competitionLeaderboard(null, ['WEEK', 'MONTH', 'ALL'].includes(req.query.period) ? req.query.period : 'WEEK'))));
router.get('/api/competitions/profile', verifyToken, student, asyncRoute(async (req: any, res: any) => res.json({ profile: await prisma.competitionProfile.findUnique({ where: { userId: req.user.id } }) || { sound: true, motion: true, publicName: false }, policy: await competitionPolicy(req.user) })));
router.put('/api/competitions/profile', verifyToken, student, writes, asyncRoute(async (req: any, res: any) => {
  const data: { sound?: boolean; motion?: boolean; publicName?: boolean } = {};
  for (const field of ['sound', 'motion', 'publicName'] as const) {
    if (req.body[field] === undefined) continue;
    if (typeof req.body[field] !== 'boolean') fail('PREFERENCES');
    data[field] = req.body[field];
  }
  if (!Object.keys(data).length) fail('PREFERENCES');
  // Unrelated settings must not overwrite a newer public-name opt-out.
  res.json(await prisma.competitionProfile.upsert({ where: { userId: req.user.id }, update: data, create: { userId: req.user.id, ...data } }));
}));
router.get('/api/competitions/leaderboard', verifyToken, student, asyncRoute(async (req: any, res: any) => res.json(await competitionLeaderboard(req.user, ['WEEK', 'MONTH', 'ALL'].includes(req.query.period) ? req.query.period : 'WEEK'))));
router.get('/api/competitions/manage/import', verifyToken, admin, asyncRoute(async (req: any, res: any) => res.json(await importCompetitionQuestions(req.user, req.query))));
// The integrated authoring flow is retired. Existing linked records keep their access checks.
router.all('/api/competitions/content', verifyToken, (_req, res) => res.status(410).json({ error: 'STANDALONE_COMPETITIONS' }));
router.get('/api/competitions/content', verifyToken, checkRole(['STUDENT', ...ADMIN_ROLES]), asyncRoute(async (req: any, res: any) => {
  const content = await checkContentReference(req.user, req.query, prisma, req.user.role !== 'STUDENT');
  const rooms = await prisma.competition.findMany({ where: { sourceKind: content.sourceKind, sourceId: content.sourceId, status: { in: req.user.role === 'STUDENT' ? ['OPEN', 'FINISHED'] : ['DRAFT', 'OPEN', 'FINISHED'] }, ...(req.user.role === 'STUDENT' ? { OR: [{ schoolId: req.user.schoolId || '__none__' }, { schoolId: null }] } : { schoolId: contentCompetitionSchool(req.user, content) }) }, include: { school: { select: { name: true } }, _count: { select: { entries: true, questions: { where: { active: true } } } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const room = rooms.find(item => item.schoolId === req.user.schoolId) || rooms[0];
  const timing = room && req.user.role !== 'STUDENT' ? await prisma.competitionQuestion.findFirst({ where: { competitionId: room.id }, orderBy: { order: 'asc' }, select: { seconds: true } }) : null;
  res.json({ room: room ? { ...roomSummary(room), ...(timing ? { secondsPerQuestion: timing.seconds } : {}) } : null, rooms: req.user.role === 'STUDENT' ? undefined : rooms.map(roomSummary), title: content.title, studentHref: contentStudentHref(content), passwordRequired: !!content.password });
}));
router.put('/api/competitions/content', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => {
  const saved = await prisma.$transaction(async tx => {
    const content = await checkContentReference(req.user, req.body, tx, true);
    await lock(tx, `${content.sourceKind}:${content.sourceId}`);
    const schoolId = contentCompetitionSchool(req.user, content);
    if (req.user.role === 'SCHOOL_ADMIN' && !schoolId) fail('SCHOOL_ACCESS', 403);
    const scope = { sourceKind: content.sourceKind, sourceId: content.sourceId, schoolId, status: { in: ['DRAFT', 'OPEN', 'FINISHED'] } };
    if (req.body.presentation === 'STANDARD') { await tx.competition.updateMany({ where: scope, data: { status: 'CANCELLED' } }); return { room: null }; }
    if (req.body.presentation !== 'COMPETITION') fail('PRESENTATION');
    const existing = await tx.competition.findFirst({ where: scope, orderBy: { createdAt: 'desc' } });
    if (existing && existing.status !== 'DRAFT') fail('PUBLISHED_CONTENT_LOCKED', 409);
    let questions, data;
    try {
      questions = await contentCompetitionQuestions(content, Number(req.body.seconds) || 30, tx);
      data = validateCompetition({ ...req.body, title: content.title.slice(0, 160), sourceKind: 'GENERAL', questions, grade: null, opensAt: null, closesAt: null });
    } catch (error: any) { fail(error.http ? error.message : 'INVALID_CONTENT_COMPETITION'); }
    const { questions: prepared, ...details } = data!;
    const room = existing ? await tx.competition.update({ where: { id: existing.id }, data: { ...details, sourceKind: content.sourceKind, sourceId: content.sourceId, questions: { deleteMany: {}, create: prepared } }, select: { id: true } }) : await tx.competition.create({ data: { ...details, sourceKind: content.sourceKind, sourceId: content.sourceId, schoolId, creatorId: req.user.id, questions: { create: prepared } }, select: { id: true } });
    return { room };
  }, { timeout: 30000 });
  res.json(saved);
}));
router.get('/api/competitions/manage/options', verifyToken, admin, asyncRoute(async (req: any, res: any) => {
  const schoolId = req.user.role === 'SUPER_ADMIN' ? null : req.user.schoolId; if (req.user.role !== 'SUPER_ADMIN' && !schoolId) fail('SCHOOL_REQUIRED', 403);
  const scope = schoolId ? { OR: [{ schoolId }, { isCentral: true }, { schools: { some: { id: schoolId } } }] } : {};
  const activityScope = schoolId ? { OR: [{ schoolId }, { isCentral: true }, { schoolIds: { contains: JSON.stringify(schoolId) } }] } : {};
  const [courses, exams, activities, schools] = await Promise.all([
    prisma.course.findMany({ where: { ...scope, deletedAt: null }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
    prisma.exam.findMany({ where: { ...scope, deletedAt: null }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
    prisma.skillCluster.findMany({ where: activityScope, select: { id: true, name: true }, take: 300, orderBy: { name: 'asc' } }),
    prisma.school.findMany({ where: { status: 'ACTIVE', ...(schoolId ? { id: schoolId } : {}) }, select: { id: true, name: true } }),
  ]);
  const selectedSchool = schoolId || (typeof req.query.schoolId === 'string' && schools.some(item => item.id === req.query.schoolId) ? req.query.schoolId : null);
  const selectedScope = selectedSchool ? { OR: [{ schoolId: selectedSchool }, { isCentral: true }, { schools: { some: { id: selectedSchool } } }] } : scope;
  const [courseSubjects, examSubjects, gradeGroups] = await Promise.all([
    prisma.course.findMany({ where: { ...selectedScope, deletedAt: null }, distinct: ['subject'], select: { subject: true } }),
    prisma.exam.findMany({ where: { ...selectedScope, deletedAt: null }, distinct: ['category', 'subjects'], select: { category: true, subjects: true } }),
    prisma.user.groupBy({ by: ['grade'], where: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null, ...(selectedSchool ? { schoolId: selectedSchool } : {}) }, _count: true }),
  ]);
  const subjects = [...new Set([...PLATFORM_SUBJECTS, ...courseSubjects.flatMap(item => subjectValues(item.subject)), ...examSubjects.flatMap(item => [...subjectValues(item.category), ...subjectValues(item.subjects)])])].sort();
  const grades = gradeGroups.map(item => item.grade).filter((value): value is string => !!value?.trim()).sort();
  res.json({ courses, exams, activities: activities.map(item => ({ id: item.id, title: item.name })), schools, subjects, grades });
}));
router.get('/api/competitions/manage/policy', verifyToken, admin, asyncRoute(async (req: any, res: any) => {
  if (req.user.role !== 'SUPER_ADMIN' && !req.user.schoolId) fail('SCHOOL_REQUIRED', 403);
  res.json({ ...defaultCompetitionPolicy, ...(await prisma.competitionPolicy.findUnique({ where: { key: policyKey(req.user) } })), effective: await competitionPolicy(req.user) });
}));
router.put('/api/competitions/manage/policy', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => {
  if (req.user.role !== 'SUPER_ADMIN' && !req.user.schoolId) fail('SCHOOL_REQUIRED', 403);
  const data: any = {}; for (const field of ['enabled', 'publicBoard', 'sound', 'motion', 'leaderboard']) { if (typeof req.body[field] !== 'boolean') fail('PREFERENCES'); data[field] = req.body[field]; }
  const key = policyKey(req.user); res.json(await prisma.competitionPolicy.upsert({ where: { key }, update: data, create: { key, ...data } }));
}));
router.get('/api/competitions/manage', verifyToken, admin, asyncRoute(async (req: any, res: any) => {
  if (req.user.role !== 'SUPER_ADMIN' && !req.user.schoolId) fail('SCHOOL_REQUIRED', 403);
  const items = await prisma.competition.findMany({ where: req.user.role === 'SUPER_ADMIN' ? {} : { schoolId: req.user.schoolId }, include: { school: { select: { name: true } }, _count: { select: { entries: true, questions: { where: { active: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 }); res.json({ items: items.map(roomSummary) });
}));
router.get('/api/competitions/manage/:id/results', verifyToken, admin, asyncRoute(async (req: any, res: any) => res.json(await listCompetitionResults(req.user, req.params.id, req.query))));
router.get('/api/competitions/manage/:id/preview', verifyToken, admin, asyncRoute(async (req: any, res: any) => res.json(await readCompetitionPreview(req.user, req.params.id))));
router.post('/api/competitions/manage/:id/preview-answer', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => res.json(await answerCompetitionPreview(req.user, req.params.id, req.body))));
router.get('/api/competitions/manage/:id/results/:entryId', verifyToken, admin, asyncRoute(async (req: any, res: any) => res.json(await readCompetitionResult(req.user, req.params.id, req.params.entryId))));
router.post('/api/competitions/manage', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => {
  let data: ReturnType<typeof validateCompetition>; try { data = validateCompetition({ ...req.body, questions: req.body.questions || [] }, true); } catch { return fail('INVALID_COMPETITION'); }
  const schoolId = req.user.role === 'SUPER_ADMIN' ? req.body.schoolId || null : req.user.schoolId;
  if (req.user.role !== 'SUPER_ADMIN' && (!schoolId || (req.body.schoolId && req.body.schoolId !== schoolId))) fail('SCHOOL_ACCESS', 403);
  if (schoolId && !await prisma.school.findFirst({ where: { id: schoolId, status: 'ACTIVE' }, select: { id: true } })) fail('SCHOOL_NOT_FOUND', 404);
  await validateSource(data, schoolId);
  const { questions, ...details } = data;
  res.status(201).json(await prisma.competition.create({ data: { ...details, schoolId, creatorId: req.user.id, questions: { create: questions } }, select: { id: true } }));
}));
router.patch('/api/competitions/manage/:id', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => {
  if (CONTENT_KINDS.includes((await prisma.competition.findUnique({ where: { id: req.params.id } }))?.sourceKind || '')) fail('USE_CONTENT_EDITOR', 409);
  let data: ReturnType<typeof validateCompetition>; try { data = validateCompetition(req.body, true); } catch { return fail('INVALID_COMPETITION'); }
  const original = await prisma.competition.findUnique({ where: { id: req.params.id } }); if (!original || !canManageCompetition(req.user, original)) fail('NOT_FOUND', 404);
  await validateSource(data, original.schoolId);
  const result = await prisma.$transaction(async tx => { const room = await manageRoom(tx, req.user, req.params.id); return saveCompetitionEdits(tx, req.user, room, data, req.body); }, { timeout: 30000 }); res.json(result);
}));
router.patch('/api/competitions/manage/:id/audience', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => {
  const updated = await prisma.$transaction(async tx => {
    await lock(tx, req.params.id);
    const room = await tx.competition.findUnique({ where: { id: req.params.id } });
    if (!room || !canManageCompetition(req.user, room)) fail('NOT_FOUND', 404);
    const audience = await resolveCompetitionAudience(tx, req.user, room, req.body);
    return tx.competition.update({ where: { id: room.id }, data: audience, include: { school: { select: { name: true } }, _count: { select: { questions: { where: { active: true } }, entries: true } } } });
  });
  res.json({ room: roomSummary(updated) });
}));
router.post('/api/competitions/manage/:id/action', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => {
  await prisma.$transaction(async tx => {
    const room = await manageRoom(tx, req.user, req.params.id); const action = req.body.action; const now = new Date();
    const content = await competitionContentAccess(req.user, room, tx);
    if (action === 'publish' && room.status === 'DRAFT' && !room.questions.length) fail('EMPTY_COMPETITION', 409);
    if (action === 'publish' && room.status === 'DRAFT' && room.questions.length) {
      if (!content) {
        try { room.questions.forEach((question: any, index: number) => validateCompetitionQuestion(question, index)); }
        catch { fail('INCOMPLETE_QUESTIONS', 409); }
      }
      const synced = content ? validateCompetition({ ...room, sourceKind: 'GENERAL', questions: await contentCompetitionQuestions(content, room.questions[0].seconds, tx) }).questions : null;
      await tx.competition.update({ where: { id: room.id }, data: { status: 'OPEN', ...(synced ? { questions: { deleteMany: {}, create: synced } } : {}) } });
    }
    else if (action === 'start' && room.mode === 'LIVE' && room.currentIndex < 0) { playable(room, now); await tx.competition.update({ where: { id: room.id }, data: { currentIndex: 0, questionStartedAt: now } }); }
    else if (action === 'next' && room.mode === 'LIVE' && room.status === 'OPEN' && room.currentIndex >= 0 && room.currentIndex < room.questions.length - 1) {
      if (room.currentIndex !== req.body.expectedIndex) fail('STALE_QUESTION', 409);
      await tx.competition.update({ where: { id: room.id }, data: { currentIndex: { increment: 1 }, questionStartedAt: now } });
    } else if (action === 'finish' && room.status === 'OPEN') {
      if (room.mode === 'LIVE' && (room.currentIndex < room.questions.length - 1 || !room.questionStartedAt || room.questionStartedAt.getTime() + room.questions[room.currentIndex].seconds * 1000 > now.getTime())) fail('WAIT_FOR_LAST_QUESTION', 409);
      await tx.competition.update({ where: { id: room.id }, data: { status: 'FINISHED', finishedAt: now } });
      if (room.mode === 'LIVE') await tx.competitionEntry.updateMany({ where: { competitionId: room.id, finishedAt: null }, data: { finishedAt: now } });
      if (room.prizeLabel) {
        const winners = await tx.competitionEntry.findMany({ where: { competitionId: room.id, correct: { gt: 0 }, finishedAt: { not: null }, student: { status: 'ACTIVE', deletedAt: null } }, orderBy: rankOrder, take: room.prizePlaces });
        if (winners.length) await tx.competitionAward.createMany({ data: winners.map((winner, i) => ({ entryId: winner.id, rank: i + 1, title: room.prizeLabel! })), skipDuplicates: true });
      }
    } else if (action === 'cancel' && ['DRAFT', 'OPEN'].includes(room.status)) await tx.competition.update({ where: { id: room.id }, data: { status: 'CANCELLED' } });
    else fail('INVALID_ACTION', 409);
  }); res.json({ success: true });
}));
router.patch('/api/competitions/manage/:id/public', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => {
  if (typeof req.body.enabled !== 'boolean') fail('PREFERENCES');
  await prisma.$transaction(async tx => { const room = await manageRoom(tx, req.user, req.params.id); await tx.competition.update({ where: { id: room.id }, data: { publicBoard: req.body.enabled } }); }); res.json({ success: true });
}));
router.patch('/api/competitions/manage/:id/awards/:awardId', verifyToken, admin, writes, asyncRoute(async (req: any, res: any) => {
  const result = await prisma.$transaction(async tx => { await manageRoom(tx, req.user, req.params.id); return tx.competitionAward.updateMany({ where: { id: req.params.awardId, entry: { competitionId: req.params.id }, deliveredAt: null }, data: { deliveredAt: new Date() } }); }); if (!result.count) fail('NOT_FOUND', 404); res.json({ success: true });
}));
router.get('/api/competitions', verifyToken, student, asyncRoute(async (req: any, res: any) => {
  const policy = await competitionPolicy(req.user); if (!policy.enabled) return res.json({ items: [], policy });
  const sourceKind = ['COURSE', 'EXAM', 'ACTIVITY'].includes(req.query.sourceKind) ? req.query.sourceKind : undefined;
  const sourceKinds = sourceKind === 'EXAM' ? ['EXAM', 'CONTENT_EXAM', 'CONTENT_MODULE', 'CONTENT_SUB_EXAM'] : sourceKind === 'ACTIVITY' ? ['ACTIVITY', 'CONTENT_SKILLS'] : ['COURSE'];
  const items = await prisma.competition.findMany({ where: { ...studentCompetitionWhere(req.user), ...(sourceKind ? { sourceKind: { in: sourceKinds } } : {}) }, include: { school: { select: { name: true } }, _count: { select: { questions: { where: { active: true } }, entries: true } }, entries: { where: { studentId: req.user.id }, select: { score: true, correct: true, finishedAt: true, award: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  const visible = await Promise.all(items.map(async room => {
    try { const content = await competitionContentAccess(req.user, room); return { ...roomSummary(room), studentHref: content ? contentStudentHref(content) : null, myEntry: room.entries[0] || null }; }
    catch (error: any) { if ([403, 404].includes(error.http)) return null; throw error; }
  }));
  res.json({ items: visible.filter(Boolean), policy });
}));
router.post('/api/competitions/:id/join', verifyToken, student, writes, asyncRoute(async (req: any, res: any) => {
  await prisma.$transaction(async tx => {
    await lock(tx, req.params.id); const room = await playRoom(tx, req.user, req.params.id); playable(room, new Date());
    const existing = await tx.competitionEntry.findUnique({ where: { competitionId_studentId: { competitionId: room.id, studentId: req.user.id } } }); if (existing) return;
    const content = await competitionContentAccess(req.user, room, tx, true);
    if (content?.password && content.password !== req.body.password) fail('PASSWORD_REQUIRED', 403);
    const count = await tx.competitionEntry.count({ where: { competitionId: room.id } }); if (count >= room.capacity) fail('FULL', 409);
    await tx.competitionEntry.create({ data: { competitionId: room.id, studentId: req.user.id, team: room.teams ? count % 2 : 0, questionSnapshot: questionSnapshot(room.questions) } });
  }); res.json(await readCompetitionRoom(req.user, req.params.id));
}));
router.post('/api/competitions/:id/start-question', verifyToken, student, writes, asyncRoute(async (req: any, res: any) => {
  await prisma.$transaction(async tx => {
    await lock(tx, req.params.id); const room = await playRoom(tx, req.user, req.params.id); playable(room, new Date());
    const entry = await tx.competitionEntry.findUnique({ where: { competitionId_studentId: { competitionId: room.id, studentId: req.user.id } } });
    if (!entry || entry.finishedAt || room.mode !== 'SELF_PACED') fail('NOT_PLAYING', 409);
    if (entry.currentIndex !== req.body.expectedIndex) fail('STALE_QUESTION', 409);
    if (!entry.questionStartedAt) await tx.competitionEntry.update({ where: { id: entry.id }, data: { questionStartedAt: new Date() } });
  }); res.json(await readCompetitionRoom(req.user, req.params.id));
}));
router.post('/api/competitions/:id/answer', verifyToken, student, writes, asyncRoute(async (req: any, res: any) => {
  await prisma.$transaction(async tx => {
    await lock(tx, req.params.id); const room = await playRoom(tx, req.user, req.params.id); const now = new Date(); playable(room, now);
    const entry = await tx.competitionEntry.findUnique({ where: { competitionId_studentId: { competitionId: room.id, studentId: req.user.id } } });
    if (!entry) fail('NOT_PLAYING', 409);
    // A retry may arrive after the first write advanced to the next question.
    // Return current state for an answer already saved by this same entrant.
    if (typeof req.body.questionId === 'string' && await tx.competitionAnswer.findUnique({ where: { entryId_questionId: { entryId: entry.id, questionId: req.body.questionId } } })) return;
    if (entry.finishedAt) fail('NOT_PLAYING', 409);
    const questions = attemptQuestions(entry, room.questions);
    const index = room.mode === 'LIVE' ? room.currentIndex : entry.currentIndex; const q = questions[index];
    if (!q || q.id !== req.body.questionId) fail('STALE_QUESTION', 409);
    const previous = await tx.competitionAnswer.findUnique({ where: { entryId_questionId: { entryId: entry.id, questionId: q.id } } }); if (previous) return;
    const started = room.mode === 'LIVE' ? room.questionStartedAt : entry.questionStartedAt; if (!started) fail('NOT_STARTED', 409);
    const selectedIndex = req.body.selectedIndex ?? null;
    if (selectedIndex !== null && (!Number.isInteger(selectedIndex) || !Array.isArray(q.options) || selectedIndex < 0 || selectedIndex >= q.options.length)) fail('ANSWER');
    const answer = req.body.answer !== undefined ? req.body.answer : selectedIndex === null ? null : (q.options as any[])[selectedIndex];
    if (JSON.stringify(answer).length > 100000 || (req.body.language !== undefined && !['ar', 'en'].includes(req.body.language))) fail('ANSWER');
    const elapsedMs = Math.min(2147483647, Math.max(0, now.getTime() - started.getTime()));
    const correct = answer !== null && competitionAnswerCorrect(q, answer, req.body.language) && elapsedMs <= q.seconds * 1000;
    const points = competitionQuestionPoints(q, correct, elapsedMs, room.scoringMode);
    await tx.competitionAnswer.create({ data: { entryId: entry.id, questionId: q.id, selectedIndex, ...(answer !== null ? { answer } : {}), correct, points, elapsedMs } });
    await tx.competitionEntry.update({ where: { id: entry.id }, data: { score: { increment: points }, correct: { increment: correct ? 1 : 0 }, ...(room.mode === 'SELF_PACED' ? { currentIndex: { increment: 1 }, questionStartedAt: null, ...(index === questions.length - 1 ? { finishedAt: now } : {}) } : {}) } });
  }); res.json(await readCompetitionRoom(req.user, req.params.id));
}));
router.get('/api/competitions/:id', verifyToken, checkRole(['STUDENT', ...ADMIN_ROLES]), asyncRoute(async (req: any, res: any) => {
  const state = await readCompetitionRoom(req.user, req.params.id); if (!state) fail('NOT_FOUND', 404); res.json(state);
}));
export default router;
