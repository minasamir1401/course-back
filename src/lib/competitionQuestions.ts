import { normalizeTrueFalse, sanitizeHtml, stripHtmlAndNormalize } from '../shared';
import { createHmac } from 'crypto';

export const COMPETITION_QUESTION_LIMIT = 500;
export const COMPETITION_TYPES = ['MCQ', 'TRUE_FALSE', 'MULTI_SELECT', 'TEXT', 'MATCHING', 'DRAG_DROP_FILL', 'GROUP_SORTING', 'CLOCK', 'MIND_MAP', 'VIDEO_CHECKPOINT', 'NUMBER_LINE', 'SWIPE_SORT', 'MAZE', 'WORD_SEARCH', 'GEOGEBRA', 'FLASH_CARD', 'MEMORY_GAME', 'WORD_SCRAMBLE', 'SENTENCE_REORDER', 'MATH_EQUATION', 'SEQUENCE_ORDER', 'CROSSWORD', 'COUNT_OBJECTS', 'IMAGE_LABEL', 'COLOR_MATCH'];
export const parseCompetitionValue = (value: any): any => { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } };
const empty = (value: any) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) || (value && typeof value === 'object' && !Object.keys(value).length);
function safeValue(value: any): any {
  if (typeof value === 'string') return sanitizeHtml(value);
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, val]) => [key, safeValue(val)]));
  return value;
}
export function validateCompetitionQuestion(input: any, order = 0, allowIncomplete = false) {
  const type = input.type || 'MCQ';
  const text = input.text || input.questionText || input.title || input.textEn;
  const seconds = input.seconds ?? 30; const points = input.points ?? 100;
  if (!COMPETITION_TYPES.includes(type) || typeof text !== 'string' || !text.trim() || text.length > 20000 || !Number.isInteger(seconds) || seconds < 5 || seconds > 3600 || !Number.isInteger(points) || points < 1 || points > 10000 || JSON.stringify(input).length > 250000) throw new Error('QUESTION');
  let options = parseCompetitionValue(input.options) ?? [];
  const rawOptionsEn = parseCompetitionValue(input.optionsEn);
  const optionsEn = ['MCQ', 'MULTI_SELECT'].includes(type) && rawOptionsEn && !Array.isArray(rawOptionsEn) ? rawOptionsEn.choices || rawOptionsEn.options : rawOptionsEn;
  let answer = parseCompetitionValue(input.correctAnswer ?? input.correctAnswers);
  let answerEn = parseCompetitionValue(input.correctAnswerEn ?? input.correctAnswersEn);
  let correctIndex = -1;
  if (['MCQ', 'MULTI_SELECT'].includes(type)) {
    options = Array.isArray(options) ? options : options?.choices || options?.options;
    if (!Array.isArray(options) || options.length < 2 || options.length > 12 || options.some((item: any) => typeof item !== 'string' || !item.trim() || item.length > 10000)) throw new Error('QUESTION');
    if (type === 'MCQ') {
      if (empty(answer) && Number.isInteger(input.correctIndex)) answer = options[input.correctIndex];
      correctIndex = options.findIndex((item: string) => item === String(answer));
      if (correctIndex < 0 && typeof answer === 'string' && /^[A-L]$/i.test(answer)) correctIndex = answer.toUpperCase().charCodeAt(0) - 65;
      if (correctIndex < 0 || correctIndex >= options.length) { if (!allowIncomplete) throw new Error('ANSWER_KEY'); correctIndex = -1; }
      else { answer = options[correctIndex]; if (empty(answerEn) && Array.isArray(optionsEn)) answerEn = optionsEn[correctIndex]; }
    } else {
      const valid = Array.isArray(answer) && answer.length && new Set(answer).size === answer.length && answer.every((item: any) => options.includes(item));
      if (!valid && !allowIncomplete) throw new Error('ANSWER_KEY');
      if (valid && empty(answerEn) && Array.isArray(optionsEn)) answerEn = answer.map((item: string) => optionsEn[options.indexOf(item)]);
    }
  } else if (type === 'TRUE_FALSE') {
    if (empty(answer) && Number.isInteger(input.correctIndex) && Array.isArray(options)) answer = options[input.correctIndex];
    const normalized = String(answer).trim().toLowerCase();
    const valid = ['true', 'false', 'صح', 'صحيح', 'صواب', 'خطأ', 'خاطئ', 'غير صحيح', '1', '0'].includes(normalized);
    if (!valid && !allowIncomplete) throw new Error('ANSWER_KEY');
    if (valid) { answer = ['true', 'صح', 'صحيح', 'صواب', '1'].includes(normalized) ? 'True' : 'False'; correctIndex = answer === 'True' ? 0 : 1; }
    options = ['True', 'False'];
  } else if (empty(answer) && !allowIncomplete) throw new Error('ANSWER_KEY');
  if (answer === undefined) answer = null;
  if (optionsEn && ['MCQ', 'MULTI_SELECT'].includes(type) && (!Array.isArray(optionsEn) || optionsEn.length !== options.length || optionsEn.some((item: any) => typeof item !== 'string' || !item.trim()))) throw new Error('TRANSLATION');
  const metadata = safeValue(input.metadata || {});
  for (const field of ['course', 'section', 'domain', 'standard', 'learningOutcome', 'indicator', 'skill', 'subskill', 'microSkill', 'errorPattern', 'level', 'dok', 'cognitive', 'estimatedTime', 'xpPoints', 'gradeTarget', 'imageUrl', 'videoUrl', 'explanation', 'hint', 'tip', 'keyInsight', 'sections', 'group', 'origin']) {
    for (const key of [field, field + 'En']) if (input[key] !== undefined && input[key] !== null) metadata[key] = safeValue(input[key]);
  }
  return { ...(typeof input.id === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.id) ? { id: input.id } : {}), type, text: sanitizeHtml(text.trim()), textEn: input.textEn ? sanitizeHtml(String(input.textEn)) : null, options: safeValue(options), ...(optionsEn ? { optionsEn: safeValue(optionsEn) } : {}), correctIndex, correctAnswer: safeValue(answer), ...(answerEn !== undefined && answerEn !== null ? { correctAnswerEn: safeValue(answerEn) } : {}), metadata, seconds, points, order };
}
export function competitionAnswerCorrect(question: any, answer: any, language = 'ar'): boolean {
  if (empty(answer)) return false;
  const key = question.correctAnswer ?? (Array.isArray(question.options) ? question.options[question.correctIndex] : undefined);
  // Ranked answers are values, never option letters/indices or partial matches.
  // Keep legacy academic grading heuristics out of competition scoring.
  const parseAnswer = (value: any) => typeof value === 'string' && /^[\s]*[\[{]/.test(value) ? parseCompetitionValue(value) : value;
  const equal = (expected: any, actual: any): boolean => {
    if (expected === null || actual === null || expected === undefined || actual === undefined) return expected === actual;
    if (Array.isArray(expected) || Array.isArray(actual)) return Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => equal(item, actual[index]));
    if (typeof expected === 'object' || typeof actual === 'object') {
      if (typeof expected !== 'object' || typeof actual !== 'object') return false;
      const keys = Object.keys(expected);
      return keys.length > 0 && keys.length === Object.keys(actual).length && keys.every(field => Object.prototype.hasOwnProperty.call(actual, field) && equal(expected[field], actual[field]));
    }
    return stripHtmlAndNormalize(expected) === stripHtmlAndNormalize(actual);
  };
  const unordered = (expected: any, actual: any) => {
    if (!Array.isArray(expected) || !Array.isArray(actual) || !expected.length || expected.length !== actual.length) return false;
    const remaining = [...actual];
    for (const item of expected) {
      const index = remaining.findIndex(value => equal(item, value));
      if (index < 0) return false;
      remaining.splice(index, 1);
    }
    return true;
  };
  if (question.type === 'TEXT') {
    const normalize = (value: any) => String(value ?? '').replace(/<[^>]+>/g, '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    return [key, question.correctAnswerEn].filter(value => !empty(value)).some(value => normalize(value) === normalize(answer));
  }
  if (question.type === 'TRUE_FALSE') {
    const expected = normalizeTrueFalse(String(key)), actual = normalizeTrueFalse(String(answer));
    return ['TRUE', 'FALSE'].includes(expected) && actual === expected;
  }
  if (!question.type || question.type === 'MCQ') return (typeof answer === 'string' || typeof answer === 'number') && [key, question.correctAnswerEn].filter(value => !empty(value)).some(value => equal(value, answer));
  const actual = parseAnswer(answer);
  if (['MULTI_SELECT', 'WORD_SEARCH'].includes(question.type)) return [key, question.correctAnswerEn].filter(value => !empty(value)).some(value => unordered(parseAnswer(value), actual));
  if (question.type === 'MEMORY_GAME') {
    const options = parseCompetitionValue(question.options);
    const pairs = Array.isArray(options) ? options : options?.pairs;
    return Array.isArray(pairs) && pairs.length > 0 && Array.isArray(actual) && actual.length === pairs.length && new Set(actual).size === pairs.length && actual.every(value => Number.isInteger(value) && value >= 0 && value < pairs.length);
  }
  const submitted = question.type === 'VIDEO_CHECKPOINT' && actual && typeof actual === 'object' && !Array.isArray(actual) && Object.prototype.hasOwnProperty.call(actual, 'answeredCheckpoints') ? actual.answeredCheckpoints : actual;
  const expected = language === 'en' && question.correctAnswerEn != null ? question.correctAnswerEn : key;
  return !empty(expected) && equal(parseAnswer(expected), submitted);
}
function hideKeys(value: any): any {
  if (Array.isArray(value)) return value.map(hideKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(correctAnswer(?:En)?|correctIndex|isCorrect|solution|answer)$/i.test(key)).map(([key, val]) => [key, hideKeys(val)]));
}
export function publicCompetitionOptions(value: any, type: string, questionId = ''): any {
  const options = hideKeys(value);
  if (!options || typeof options !== 'object') return options;
  // Stable across polling, opaque to the browser, and independent for each list.
  const shuffled = (items: any[], list: string) => items.map((item, index) => ({
    item, key: createHmac('sha256', process.env.JWT_SECRET || 'competition-test').update(JSON.stringify([questionId, type, list, index, items])).digest('hex'),
  })).sort((left, right) => left.key.localeCompare(right.key)).map(row => row.item);
  if (type === 'CROSSWORD' && Array.isArray(options.words)) options.words = options.words.map((item: any) => ({ clue: item.clue, length: String(item.word || '').length }));
  if (type === 'IMAGE_LABEL' && Array.isArray(options.labels)) options.labels = options.labels.map((item: any) => ({ x: item.x, y: item.y }));
  if (type === 'WORD_SCRAMBLE' && options.word) { options.letters = shuffled(String(options.word).split(''), 'letters'); delete options.word; }
  if (type === 'SENTENCE_REORDER' && Array.isArray(options.words)) options.words = shuffled(options.words, 'words');
  if (type === 'SEQUENCE_ORDER' && Array.isArray(options.items)) options.items = shuffled(options.items, 'items');
  if (type === 'MATCHING') for (const list of ['left', 'right']) if (Array.isArray(options[list])) options[list] = shuffled(options[list], list);
  return options;
}
