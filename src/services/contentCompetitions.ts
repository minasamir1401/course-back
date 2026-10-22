import prisma from '../lib/prisma';
import { examMatchesStudent, getStudentGradeAndStage } from '../shared';
import { canManageExamRecord } from '../utils/examAccessPolicy';
import { canManageSkillCluster, canViewSkillCluster, clusterSchoolIds } from '../utils/skillAccess';
import { getAvailability, resolveExamAccessPassword } from '../utils/examWorkflow';

export const CONTENT_KINDS = ['CONTENT_EXAM', 'CONTENT_SUB_EXAM', 'CONTENT_MODULE', 'CONTENT_SKILLS'];
export function contentError(code: string, http = 400): never { throw Object.assign(new Error(code), { http }); }
export function contentReference(input: any) {
  if (!input || !['EXAM', 'SKILLS'].includes(input.kind) || typeof input.sourceId !== 'string' || !input.sourceId || input.sourceId.length > 100) contentError('CONTENT_REQUIRED');
  for (const field of ['moduleId', 'subExamId']) if (input[field] && (typeof input[field] !== 'string' || input[field].length > 100)) contentError('CONTENT_REQUIRED');
  if (input.kind === 'SKILLS' && (input.moduleId || input.subExamId)) contentError('CONTENT_REQUIRED');
  return { sourceKind: input.kind === 'SKILLS' ? 'CONTENT_SKILLS' : input.subExamId ? 'CONTENT_SUB_EXAM' : input.moduleId ? 'CONTENT_MODULE' : 'CONTENT_EXAM', sourceId: input.subExamId || input.moduleId || input.sourceId };
}
export async function loadCompetitionContent(reference: { sourceKind: string; sourceId: string }, db: any = prisma) {
  if (!CONTENT_KINDS.includes(reference.sourceKind)) return null;
  if (reference.sourceKind === 'CONTENT_SKILLS') {
    const cluster = await db.skillCluster.findUnique({ where: { id: reference.sourceId } });
    if (!cluster) contentError('CONTENT_NOT_FOUND', 404);
    return { ...reference, cluster, title: cluster.name, schoolId: cluster.isCentral || clusterSchoolIds(cluster).length !== 1 ? null : cluster.schoolId, exam: null, child: null, module: null, windows: [] as any[], password: null };
  }
  let module: any = null, child: any = null;
  if (reference.sourceKind === 'CONTENT_SUB_EXAM') {
    child = await db.subExam.findUnique({ where: { id: reference.sourceId }, include: { module: true } });
    module = child?.module;
  } else if (reference.sourceKind === 'CONTENT_MODULE') module = await db.examModule.findUnique({ where: { id: reference.sourceId } });
  const examId = reference.sourceKind === 'CONTENT_EXAM' ? reference.sourceId : module?.examId;
  if (!examId) contentError('CONTENT_NOT_FOUND', 404);
  const exam = await db.exam.findUnique({ where: { id: examId }, include: { schools: { select: { id: true } }, modules: true } });
  if (!exam || exam.deletedAt) contentError('CONTENT_NOT_FOUND', 404);
  const windows: any[] = [{ publishDate: exam.startDate, cutOffDate: exam.endDate }];
  const seen = new Set<string>(); let ancestor = module;
  while (ancestor) {
    if (seen.has(ancestor.id)) contentError('CONTENT_HIERARCHY');
    seen.add(ancestor.id); windows.push(ancestor);
    if (!ancestor.parentModuleId) break;
    ancestor = exam.modules.find((item: any) => item.id === ancestor.parentModuleId);
    if (!ancestor) contentError('CONTENT_HIERARCHY');
  }
  if (child) windows.push(child);
  return { ...reference, cluster: null, exam, child, module, windows, title: child?.title || module?.title || exam.title, schoolId: exam.schoolId || null, password: resolveExamAccessPassword(exam, child) };
}
export function mayManageContent(user: any, content: any) {
  return ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user.role) && (content.cluster ? canManageSkillCluster(user, content.cluster) : canManageExamRecord(user, content.exam, false));
}
export function contentCompetitionSchool(user: any, content: any) {
  if (user.role === 'SCHOOL_ADMIN') return user.schoolId || null;
  if (content.cluster) return content.schoolId;
  return content.exam.schools?.some((school: any) => school.id !== content.schoolId) ? null : content.schoolId;
}
export async function checkContentReference(user: any, input: any, db: any = prisma, manage = false) {
  const reference = contentReference(input); const content = await loadCompetitionContent(reference, db);
  if (!content || (input.kind === 'EXAM' && content.exam.id !== input.sourceId) || (input.moduleId && content.module?.id !== input.moduleId)) contentError('CONTENT_NOT_FOUND', 404);
  if (manage ? !mayManageContent(user, content) : !mayViewContent(user, content)) contentError('CONTENT_ACCESS', 403);
  return content;
}
export function mayViewContent(user: any, content: any) {
  if (user.role !== 'STUDENT') return mayManageContent(user, content);
  if (content.cluster) return canViewSkillCluster(user, content.cluster, getStudentGradeAndStage(user.grade));
  if (content.exam.status !== 'PUBLISHED' || !examMatchesStudent(content.exam, user)) return false;
  const grades = getStudentGradeAndStage(user.grade);
  return content.windows.every((window: any) => { const raw = window.gradeTarget ? parse(window.gradeTarget) : []; const targets = Array.isArray(raw) ? raw : [raw]; return !targets.length || targets.some((target: string) => grades.includes(target)); });
}
export async function competitionContentAccess(user: any, room: any, db: any = prisma, playing = false) {
  if (!CONTENT_KINDS.includes(room.sourceKind)) return null;
  const content = await loadCompetitionContent(room, db);
  if (!content || !mayViewContent(user, content)) contentError('CONTENT_ACCESS', 403);
  if (playing && user.role === 'STUDENT' && content.windows.some((window: any) => getAvailability(window) !== 'AVAILABLE')) contentError('CONTENT_UNAVAILABLE', 409);
  return content;
}
function parse(value: any) { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } }
export function competitionQuestionFromContent(row: any, seconds: number) {
  if (!['MCQ', 'TRUE_FALSE', 'MULTIPLE_CHOICE', 'multiple_choice', 'mcq'].includes(row.type)) contentError('UNSUPPORTED_CONTENT_QUESTION');
  const raw = parse(row.options); const choices = Array.isArray(raw) ? raw : raw?.choices || raw?.options;
  if (!Array.isArray(choices)) contentError('UNSUPPORTED_CONTENT_QUESTION');
  const options = choices.map((item: any) => typeof item === 'string' ? item : item?.text || item?.label || '');
  const answer = parse(row.correctAnswer);
  let correctIndex = options.findIndex((item: string) => item === String(answer));
  if (correctIndex < 0 && typeof answer === 'number' && Number.isInteger(answer)) correctIndex = answer;
  // An explicit A–D key is supported only when it is not itself an option's text.
  if (correctIndex < 0 && typeof answer === 'string' && /^[A-D]$/i.test(answer)) correctIndex = answer.toUpperCase().charCodeAt(0) - 65;
  if (correctIndex < 0) contentError('UNSUPPORTED_CONTENT_QUESTION');
  const english = parse(row.optionsEn); const enChoices = Array.isArray(english) ? english : english?.choices || english?.options;
  const media = row.imageUrl ? parse(row.imageUrl) : [];
  const images = Array.isArray(media) ? media : [media];
  if (images.some((url: any) => typeof url !== 'string' || !/^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|webp);base64,)/i.test(url))) contentError('UNSUPPORTED_CONTENT_QUESTION');
  const escape = (value: string) => value.replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[char]!));
  const withImages = (text: string) => text + images.filter((url: string) => !text.includes(url)).map((url: string) => `<img src="${escape(url)}" alt="صورة السؤال / Question image">`).join('');
  return { text: withImages(row.text || row.questionText || row.title || ''), textEn: row.textEn || row.questionTextEn ? withImages(row.textEn || row.questionTextEn) : null, options, ...(Array.isArray(enChoices) && enChoices.length === options.length && enChoices.every((item: any) => typeof item === 'string' && item.trim()) ? { optionsEn: enChoices } : {}), correctIndex, seconds };
}
export async function contentCompetitionQuestions(content: any, seconds: number, db: any = prisma) {
  const rows = content.cluster ? await db.interactiveActivity.findMany({ where: { lesson: { clusterId: content.cluster.id } }, orderBy: [{ lesson: { order: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }], take: 51 }) : await db.question.findMany({ where: { examId: content.exam.id, deletedAt: null, ...(content.child ? { subExamId: content.child.id } : content.module ? { moduleId: content.module.id, subExamId: null } : { moduleId: null, subExamId: null }) }, orderBy: [{ order: 'asc' }, { id: 'asc' }], take: 51 });
  if (!rows.length || rows.length > 50) contentError('CONTENT_QUESTION_COUNT');
  // Reject unsupported content explicitly; never silently drop questions or guess an answer key.
  return rows.map((row: any) => competitionQuestionFromContent(row, seconds));
}
export function contentStudentHref(content: any) {
  if (content.cluster) return `/activities?competitionCluster=${encodeURIComponent(content.cluster.id)}`;
  const params = new URLSearchParams(); if (content.module) params.set('moduleId', content.module.id); if (content.child) params.set('subExamId', content.child.id);
  return `/exams/${content.exam.id}${params.size ? '?' + params : ''}`;
}
