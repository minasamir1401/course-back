import prisma from '../lib/prisma';
import { validateCompetitionQuestion } from '../lib/competitionQuestions';
function fail(code: string, http = 400): never { throw Object.assign(new Error(code), { http }); }
function parse(value: any) { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } }
function rows(value: any): any[] { const data = parse(value); return Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : []; }
export async function importCompetitionQuestions(user: any, input: any, db: any = prisma) {
  if (!['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(user.role)) fail('SOURCE_NOT_FOUND', 403);
  if (!['EXAM', 'COURSE'].includes(input.kind) || typeof input.sourceId !== 'string' || !input.sourceId || input.sourceId.length > 100) fail('SOURCE_REQUIRED');
  if (user.role === 'SCHOOL_ADMIN' && !user.schoolId) fail('SCHOOL_ACCESS', 403);
  const offset = Number(input.offset || 0); const seconds = Number(input.seconds || 30);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(seconds) || seconds < 10 || seconds > 180) fail('IMPORT_OPTIONS');
  const scope = user.role === 'SUPER_ADMIN' ? {} : { OR: [{ schoolId: user.schoolId }, { isCentral: true }, { schools: { some: { id: user.schoolId } } }] };
  let candidates: any[] = [], total = 0; let sections: { id: string; title: string; kind?: string; parentId?: string }[] = [];
  if (input.kind === 'EXAM') {
    const exam = await db.exam.findFirst({ where: { id: input.sourceId, deletedAt: null, ...scope }, include: { modules: { include: { subExams: { select: { id: true, title: true } } } } } });
    if (!exam) fail('SOURCE_NOT_FOUND', 404);
    sections = (exam.modules || []).flatMap((module: any) => [{ id: `module:${module.id}`, title: module.title, kind: 'MODULE' }, ...(module.subExams || []).map((sub: any) => ({ id: `sub:${sub.id}`, title: sub.title, kind: 'SUB_EXAM', parentId: `module:${module.id}` }))]);
    const section = typeof input.section === 'string' ? input.section : '';
    if (section && !sections.some(item => item.id === section)) fail('SOURCE_NOT_FOUND', 404);
    const extra = section.startsWith('sub:') ? { subExamId: section.slice(4) } : section.startsWith('module:') ? { OR: [{ moduleId: section.slice(7) }, { subExam: { moduleId: section.slice(7) } }] } : {};
    const where = { examId: exam.id, deletedAt: null, ...extra };
    const [page, count] = await Promise.all([db.question.findMany({ where, skip: offset, take: 200, orderBy: [{ order: 'asc' }, { id: 'asc' }] }), db.question.count({ where })]);
    candidates = page.map((question: any) => ({ ...question, key: `exam:${exam.id}:${question.id}`, sourceLabel: sections.find(item => item.id === (question.subExamId ? 'sub:' + question.subExamId : 'module:' + question.moduleId))?.title || exam.title })); total = count;
  } else {
    const course = await db.course.findFirst({ where: { id: input.sourceId, deletedAt: null, ...scope }, include: { lessons: { where: { deletedAt: null }, orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { id: true, title: true, questions: true, assignments: true, slides: true, blocks: { where: { type: { in: ['MCQ', 'TRUE_FALSE', 'QUESTION', 'QUIZ'] } }, orderBy: [{ order: 'asc' }, { id: 'asc' }] } } } } });
    if (!course) fail('SOURCE_NOT_FOUND', 404);
    sections = course.lessons.map((lesson: any) => ({ id: lesson.id, title: lesson.title, kind: 'LESSON' }));
    const section = typeof input.section === 'string' ? input.section : '';
    if (section && !sections.some(item => item.id === section)) fail('SOURCE_NOT_FOUND', 404);
    const all: any[] = [];
    for (const lesson of course.lessons.filter((item: any) => !section || item.id === section)) {
      for (const field of ['questions', 'assignments']) rows(lesson[field]).forEach((question, index) => all.push({ ...question, key: `course:${course.id}:${lesson.id}:${field}:${question.id || index}`, sourceLabel: lesson.title }));
      for (const block of lesson.blocks || []) all.push({ ...block, text: block.content, type: block.type === 'QUESTION' || block.type === 'QUIZ' ? 'MCQ' : block.type, key: `course:${course.id}:${lesson.id}:block:${block.id}`, sourceLabel: lesson.title });
      for (const [index, slide] of rows(lesson.slides).entries()) {
        const questions = rows(slide.questions);
        const direct = ['QUESTION', 'QUIZ', 'MCQ', 'TRUE_FALSE'].includes(slide.type) && slide.options ? [slide] : [];
        [...questions, ...direct].forEach((question, i) => all.push({ ...question, type: ['QUESTION', 'QUIZ'].includes(question.type) ? question.questionType || 'MCQ' : question.type, key: `course:${course.id}:${lesson.id}:slide:${slide.id || index}:${question.id || i}`, sourceLabel: lesson.title }));
      }
    }
    total = all.length; candidates = all.slice(offset, offset + 200);
  }
  const items = candidates.map(row => {
    try {
      const legacyQuestion = ['QUESTION', 'QUIZ'].includes(row.type);
      const normalized = { ...row, type: legacyQuestion ? row.questionType || (['MCQ', 'TRUE_FALSE'].includes(row.label) ? row.label : 'MCQ') : row.type || row.questionType || 'MCQ', text: row.text || row.questionText || row.question || row.content || row.title };
      const explicitIndex = normalized.correctAnswer === undefined ? row.correctIndex : legacyQuestion && typeof row.correctAnswer === 'number' ? row.correctAnswer : undefined;
      if (Number.isInteger(explicitIndex)) {
        const raw = parse(row.options); const choices = Array.isArray(raw) ? raw : raw?.choices || raw?.options;
        if (!Array.isArray(choices) || explicitIndex < 0 || explicitIndex >= choices.length) fail('UNSUPPORTED_CONTENT_QUESTION');
        const choice = choices[explicitIndex]; normalized.correctAnswer = typeof choice === 'string' ? choice : choice?.text || choice?.label;
      }
      // Exam estimatedTime is stored as a string. Competition timing is numeric.
      const rawSeconds = row.seconds ?? row.estimatedTime;
      const questionSeconds = rawSeconds === undefined || rawSeconds === null || rawSeconds === '' ? seconds : Number(rawSeconds);
      const data = { ...normalized, id: undefined, points: Number(row.points ?? 100), seconds: questionSeconds, group: row.sourceLabel, origin: { kind: input.kind, sourceId: input.sourceId, key: row.key, section: input.section || '' } };
      let question, needsReview = false;
      try { question = validateCompetitionQuestion(data); }
      catch (error: any) {
        if (error.message !== 'ANSWER_KEY') throw error;
        question = validateCompetitionQuestion(data, 0, true);
        question.metadata.requiresAnswerReview = true; needsReview = true;
      }
      return { key: row.key, sourceLabel: row.sourceLabel, text: normalized.text || '', supported: true, needsReview, question };
    } catch (error: any) { return { key: row.key, sourceLabel: row.sourceLabel, text: row.text || row.questionText || row.question || row.content || row.title || '', supported: false, reason: ['ANSWER_KEY', 'TRANSLATION', 'QUESTION'].includes(error.message) ? error.message : 'UNSUPPORTED_CONTENT_QUESTION' }; }
  });
  return { items, sections, total, nextOffset: offset + candidates.length < total ? offset + candidates.length : null };
}
