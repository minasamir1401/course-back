require('ts-node/register/transpile-only');
const { buildBudgetedAiPrompt, compactStudentPrompt, aiMessageTokens } = require('../../../src/services/aiPromptBudget.service');
const { AI_CORE_INSTRUCTIONS } = require('../../../src/services/aiLearning.service');

const student = () => ({ student: { name: 'Synthetic student', grade: 'Grade 3' }, dashboard: {
  metrics: { averageScore: 62, passRate: 50, totalAttempts: 77, selectedAttempts: 12, overallCourseProgress: 25 },
  timeZone: 'Africa/Cairo', notifications: { unread: 17, items: Array.from({ length: 20 }, (_, i) => ({ title: `تنبيه واجب ${i}`, body: 'تفاصيل الموعد '.repeat(150), unread: true })) },
  courses: Array.from({ length: 40 }, (_, i) => ({ title: `مقرر ${i}`, totalLessons: 30, completedLessons: 5, progressPercent: 17, href: `/courses/${i}` })),
  tasks: Array.from({ length: 15 }, (_, i) => ({ title: `واجب ${i}`, dueAt: '2026-10-29T12:00:00Z', href: `/exams/${i}/details` })),
}, evidence: { assessmentsAnalyzed: 12, assessedAnswersCount: 150,
  skills: Array.from({ length: 30 }, (_, i) => ({ name: `مهارة ${i}`, total: 5, percent: 20, evidenceLevel: 'limited evidence' })),
  reviewIssues: Array.from({ length: 12 }, () => ({ question: 'تفاصيل السؤال '.repeat(400), selectedAnswer: 'إجابتي', skill: 'الكسور' })),
  nextLessons: [{ title: 'مراجعة الكسور', href: '/lessons/fractions?courseId=math' }],
} });

test('large Arabic context and long history fit the input budget while all dashboard metrics remain exact', () => {
  const context = student(), message = 'حللي الداشبورد والمهارات والتنبيهات';
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'كلام سابق '.repeat(700) }));
  expect(aiMessageTokens([{ role: 'system', content: JSON.stringify(context) }, ...history])).toBeGreaterThan(8000);
  const messages = buildBudgetedAiPrompt({ core: AI_CORE_INSTRUCTIONS, studentContext: context, history, message }, 5500);
  expect(aiMessageTokens(messages)).toBeLessThanOrEqual(5500);
  expect(messages.at(-1)).toEqual({ role: 'user', content: message });
  expect(messages[0].content).toContain(AI_CORE_INSTRUCTIONS);
  const records = JSON.parse(messages[0].content.match(/Verified student records; read only:\n(\{[^\n]+\})/)[1]);
  expect(records.dashboard.metrics).toEqual(context.dashboard.metrics);
  expect(records.dashboard.notifications.unread).toBe(17);
  expect(records.evidence.assessmentsAnalyzed).toBe(12); expect(records.evidence.assessedAnswersCount).toBe(150);
  expect(records.detailCoverage.notifications.included).toBeLessThan(20);
  expect(records.detailCoverage.notifications.available).toBe(20);
});

test('notification queries retain inbox evidence and report omitted detail instead of inventing an empty account', () => {
  const compact = compactStudentPrompt(student(), 'إيه تنبيهات الواجب المطلوبة مني؟', 1900);
  expect(compact.dashboard.notifications.unread).toBe(17);
  expect(compact.dashboard.notifications.items.length).toBeGreaterThan(0);
  expect(compact.dashboard.tasks.length).toBeGreaterThan(0);
  expect(compact.detailCoverage.notifications).toEqual({ available: 20, included: compact.dashboard.notifications.items.length });
});

test('public requests never serialize personal or private lesson context', () => {
  const messages = buildBudgetedAiPrompt({ core: 'Public assistant', publicRequest: true, message: 'What is Klevro?', studentContext: student(), lesson: JSON.stringify({ text: 'private-lesson-secret' }) }, 5500);
  expect(JSON.stringify(messages)).not.toMatch(/Synthetic student|private-lesson-secret/);
});

test('large lesson excerpts stay parseable and disclose their scope', () => {
  const messages = buildBudgetedAiPrompt({ core: AI_CORE_INSTRUCTIONS, message: 'اشرح الدرس', studentContext: student(), lesson: JSON.stringify({ title: 'درس المصفوفات', content: 'شرح رياضي '.repeat(8000) }) }, 5500);
  expect(aiMessageTokens(messages)).toBeLessThanOrEqual(5500);
  expect(messages[0].content).toContain('درس المصفوفات');
  expect(messages[0].content).toContain('"excerpt":true');
});

test('an oversized current question is rejected explicitly instead of silently truncated', () => {
  expect(() => buildBudgetedAiPrompt({ core: AI_CORE_INSTRUCTIONS, message: 'سؤال كبير '.repeat(7000) }, 5500)).toThrow(expect.objectContaining({ code: 'AI_INPUT_TOO_LARGE', status: 413 }));
});
