import prisma from '../lib/prisma';
import { AiError } from '../lib/aiSecurity';

const PREFIX = 'KLEVRO_PRACTICE_V1\n';
type QuestionType = 'single_choice' | 'multiple_choice' | 'short_answer';
type Answer = string | string[];
type Result = { submittedAnswer: Answer; isCorrect: boolean; answeredAt: string };
type Question = { id: string; type: QuestionType; prompt: string; options: { id: string; text: string }[];
  correctAnswers: string[]; acceptedAnswers: string[]; hint: string; explanation: string };
export type PracticeDocument = { version: 1; title: string; introduction: string; layout: 'step' | 'list'; questions: Question[]; answers: Record<string, Result> };

function normalized(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670ـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0));
}
export function practiceRequest(message: string): { count: number } | null {
  const value = normalized(message);
  const direct = /اسالني|دربني|اختبرني|نتدرب|\b(quiz me|test me|ask me|practice questions|practice exercises)\b/.test(value);
  const action = /اعمل|جهز|حضر|اديني|عايز|اريد|ممكن|انشئ|^(?:تدريب|تمارين)(?:\s|$)|\b(create|generate|make|give me|prepare|practice)\b/.test(value);
  const subject = /تدريب|تمارين|تمرين|اسئله|اساله|سؤال|سوال|كويز|\b(questions?|quiz|exercises|practice)\b/.test(value);
  if (!direct && !(action && subject)) return null;
  const digits = value.match(/(?:^|\s)(\d{1,3})\s*(?:اسئله|اساله|سؤال|سوال|تمارين|تمرين|questions?|exercises)(?=\s|$|[،,.!؟?])/)?.[1]
    || value.match(/(?:اسئله|اساله|questions|exercises)\s*[:：]?\s*(\d{1,3})(?:\s|$)/)?.[1];
  const word = /خمس|five/.test(value) ? 5 : /ثلاث|three/.test(value) ? 3 : /عشر|ten/.test(value) ? 10 : /سؤال واحد|سوال واحد|one question/.test(value) ? 1 : null;
  return { count: Math.min(10, Math.max(1, digits ? Number(digits) : word || 5)) };
}

export function practiceInstructions(count: number) {
  return `INTERACTIVE PRACTICE OUTPUT CONTRACT — for this response return ONLY a JSON object, no Markdown fences, no HTML, no code, no prose outside JSON.
Create exactly ${count} NEW formative practice questions about the student's requested subject, using the permitted lesson and conversation when present. Never reproduce an active assessment or its answer key. Do not claim to change official grades or course progress. Match the user's language and level. If the subject is unspecified, choose a concrete topic from available study context and name it honestly.
Schema: {"version":1,"title":"short title","introduction":"one short sentence","layout":"step","questions":[{"type":"single_choice","prompt":"question","options":["option one","option two","option three"],"correctAnswers":[0],"hint":"help without revealing answer","explanation":"worked explanation after submission"}]}
Allowed types: single_choice (2–6 distinct options, exactly one correctAnswers zero-based index); multiple_choice (2–6 options, one or more correctAnswers indexes, explicitly ask to select ALL correct options); short_answer (options:[], acceptedAnswers:["canonical answer","valid alternative"], clear unambiguous expected format). Mix types when educationally appropriate; respect a requested type. Short answers must be objectively gradeable (a number or short phrase, NOT an essay). Include common valid alternatives, Arabic/English forms and numerical formats when relevant. Check every answer and explanation for consistency. No trick or ambiguous questions.
layout is "step" by default, or "list" if the user requests seeing all questions. Provide a useful hint and concise worked explanation for EVERY question. Use plain text or LaTeX delimiters for math, JSON-escape backslashes correctly. Never put the correct answer in the title, introduction, prompt or hint. All keys are required as applicable; version must be 1.`;
}
const invalid = () => new AiError(502, 'AI_PRACTICE_INVALID', 'المساعد لم يجهّز أسئلة سليمة هذه المرة. أعد طلب التدريب أو حدّد موضوعه.');
function bounded(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw invalid();
  return value.trim();
}
export function parsePractice(raw: string, expectedCount: number): PracticeDocument {
  if (raw.length > 100000) throw invalid();
  let value: any;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw invalid(); }
  if (!value || value.version !== 1 || !Array.isArray(value.questions) || value.questions.length !== expectedCount || expectedCount < 1 || expectedCount > 10 || !['step', 'list'].includes(value.layout)) throw invalid();
  const questions: Question[] = value.questions.map((item: any, index: number) => {
    if (!item || !['single_choice', 'multiple_choice', 'short_answer'].includes(item.type)) throw invalid();
    const question: Question = { id: `q${index + 1}`, type: item.type, prompt: bounded(item.prompt, 1800),
      options: [], correctAnswers: [], acceptedAnswers: [], hint: bounded(item.hint, 800), explanation: bounded(item.explanation, 2400) };
    if (item.type === 'short_answer') {
      if (!Array.isArray(item.acceptedAnswers) || !item.acceptedAnswers.length || item.acceptedAnswers.length > 8) throw invalid();
      question.acceptedAnswers = item.acceptedAnswers.map((answer: unknown) => bounded(answer, 300));
    } else {
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6) throw invalid();
      question.options = item.options.map((option: unknown, key: number) => ({ id: `o${key + 1}`, text: bounded(option, 1000) }));
      if (new Set(question.options.map(option => normalized(option.text))).size !== question.options.length) throw invalid();
      if (!Array.isArray(item.correctAnswers) || !item.correctAnswers.length || item.correctAnswers.length > question.options.length || (item.type === 'single_choice' && item.correctAnswers.length !== 1)) throw invalid();
      if (item.correctAnswers.some((answer: unknown) => !Number.isInteger(answer) || (answer as number) < 0 || (answer as number) >= question.options.length)) throw invalid();
      if (new Set(item.correctAnswers).size !== item.correctAnswers.length) throw invalid();
      question.correctAnswers = item.correctAnswers.map((answer: number) => question.options[answer].id);
    }
    return question;
  });
  return { version: 1, title: bounded(value.title, 180), introduction: bounded(value.introduction, 900), layout: value.layout, questions, answers: {} };
}
export const encodePractice = (practice: PracticeDocument) => PREFIX + JSON.stringify(practice);
function decodePractice(content: string): PracticeDocument | null {
  if (!content.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(content.slice(PREFIX.length));
    if (value.version === 1 && Array.isArray(value.questions) && value.answers && typeof value.answers === 'object') return value;
  } catch { /* Reserved envelopes are never returned as plain text. */ }
  throw new AiError(409, 'AI_PRACTICE_UNAVAILABLE', 'تعذر فتح هذا التدريب. اطلب تدريبًا جديدًا.');
}
export function publicPractice(messageId: string, practice: PracticeDocument) {
  const results = Object.values(practice.answers);
  const correct = results.filter(result => result.isCorrect).length;
  return { messageId, version: 1, title: practice.title, introduction: practice.introduction, layout: practice.layout,
    questions: practice.questions.map(question => {
      const result = practice.answers[question.id];
      return { id: question.id, type: question.type, prompt: question.prompt, options: question.options, hint: question.hint,
        ...(result ? { result: { ...result, correctAnswer: question.type === 'short_answer' ? question.acceptedAnswers[0] : question.options.filter(option => question.correctAnswers.includes(option.id)).map(option => option.text).join('، '), explanation: question.explanation } } : {}) };
    }), score: { answered: results.length, total: practice.questions.length, correct, completed: results.length === practice.questions.length,
      percent: Math.round(correct / practice.questions.length * 100) } };
}
export function serializeAiMessage<T extends { id?: string; role: string; content: string }>(message: T) {
  if (message.role !== 'assistant') return message;
  try {
    const practice = decodePractice(message.content);
    return practice ? { ...message, content: `${practice.title}\n${practice.introduction}`, practice: publicPractice(message.id || '', practice) } : message;
  } catch { return { ...message, content: 'تعذر فتح هذا التدريب. اطلب تدريبًا جديدًا.' }; }
}
export function practiceHistoryText(content: string, role: string) {
  if (role !== 'assistant') return content;
  try {
    const practice = decodePractice(content);
    if (!practice) return content;
    return `${practice.title}\n${practice.questions.map(question => {
      const result = practice.answers[question.id];
      return `${question.id}: ${question.prompt}${result ? `\nStudent answer: ${JSON.stringify(result.submittedAnswer)}. Correct: ${result.isCorrect}. Feedback: ${question.explanation}` : '\nNot answered yet.'}`;
    }).join('\n')}`;
  } catch { return 'Practice unavailable.'; }
}
const shortAnswer = (value: string) => {
  const text = normalized(value).replace(/٫/g, '.').replace(/٪/g, '%').replace(/\s+/g, ' ').trim().replace(/\s*%$/, '%');
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(text)) {
    const unsigned = text.replace(/^[+-]/, '').replace('%', '');
    const [whole, fraction = ''] = unsigned.split('.');
    const integer = (whole || '0').replace(/^0+(?=\d)/, ''), decimal = fraction.replace(/0+$/, '');
    const zero = integer === '0' && !decimal;
    return `${text.startsWith('-') && !zero ? '-' : ''}${integer}${decimal ? '.' + decimal : ''}${text.endsWith('%') ? '%' : ''}`;
  }
  return text;
};
export function gradePractice(practice: PracticeDocument, questionId: string, answer: unknown): PracticeDocument {
  const question = practice.questions.find(item => item.id === questionId);
  if (!question) throw new AiError(400, 'AI_PRACTICE_QUESTION', 'السؤال غير موجود في التدريب.');
  if (practice.answers[questionId]) return practice;
  let submittedAnswer: Answer, isCorrect: boolean;
  if (question.type === 'short_answer') {
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 300) throw new AiError(400, 'AI_PRACTICE_ANSWER', 'اكتب إجابة قصيرة لا تتجاوز 300 حرف.');
    submittedAnswer = answer.trim(); isCorrect = question.acceptedAnswers.some(item => shortAnswer(item) === shortAnswer(submittedAnswer as string));
  } else {
    if (!Array.isArray(answer) || !answer.length || answer.length > question.options.length || new Set(answer).size !== answer.length || answer.some(id => typeof id !== 'string' || !question.options.some(option => option.id === id)) || (question.type === 'single_choice' && answer.length !== 1)) throw new AiError(400, 'AI_PRACTICE_ANSWER', 'اختر إجابة صالحة للسؤال.');
    submittedAnswer = [...answer].sort(); isCorrect = submittedAnswer.length === question.correctAnswers.length && submittedAnswer.every(id => question.correctAnswers.includes(id));
  }
  return { ...practice, answers: { ...practice.answers, [questionId]: { submittedAnswer, isCorrect, answeredAt: new Date().toISOString() } } };
}

// Persist a typed private envelope in the existing message; official grades and progress are untouched.
export async function savedPractice(userId: string, messageId: string, submission?: { questionId: string; answer: unknown }, db: any = prisma) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const message = await db.aiMessage.findFirst({ where: { id: messageId, role: 'assistant', conversation: { userId } } });
    if (!message) throw new AiError(404, 'NOT_FOUND', 'التدريب غير موجود.');
    const practice = decodePractice(message.content);
    if (!practice) throw new AiError(404, 'NOT_FOUND', 'التدريب غير موجود.');
    if (!submission) return publicPractice(messageId, practice);
    const graded = gradePractice(practice, submission.questionId, submission.answer);
    if (graded === practice) return publicPractice(messageId, practice);
    // Compare-and-swap prevents simultaneous answers from losing previously saved progress.
    const updated = await db.aiMessage.updateMany({ where: { id: messageId, content: message.content, conversation: { userId } }, data: { content: encodePractice(graded) } });
    if (updated.count) return publicPractice(messageId, graded);
  }
  throw new AiError(409, 'AI_PRACTICE_CHANGED', 'تم تحديث التدريب من نافذة أخرى. أعد المحاولة.');
}
