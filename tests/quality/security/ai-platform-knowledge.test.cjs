require('ts-node/register/transpile-only');
const { DEFAULT_PLATFORM_KNOWLEDGE, PLATFORM_RUNTIME_GUIDE, platformKnowledgeContext } = require('../../../src/services/aiKnowledge.service');
test('reference preserves release uncertainty and does not import document instructions as policies', () => {
  expect(DEFAULT_PLATFORM_KNOWLEDGE).toContain('قيد التطوير');
  expect(DEFAULT_PLATFORM_KNOWLEDGE).toContain('ولي الأمر');
  expect(DEFAULT_PLATFORM_KNOWLEDGE).toContain('غير متحقق');
  expect(DEFAULT_PLATFORM_KNOWLEDGE).toContain('الأسعار');
  expect(DEFAULT_PLATFORM_KNOWLEDGE).not.toMatch(/Mandatory AI Response Rules|Suggested Welcome Messages|Maintenance & Pre-Launch/);
});
test.each(['ما مسار نافس للصف الثالث؟', 'What subjects does NAFS cover?', 'What is GAT quantitative reasoning?', 'ما أسعار الاشتراكات؟', 'بكام الاشتراك؟'])('retrieves relevant factual sections within a bounded prompt: %s', question => {
  const context = platformKnowledgeContext(DEFAULT_PLATFORM_KNOWLEDGE, question);
  expect(context.length).toBeLessThanOrEqual(10000);
  expect(context).toContain('حالة الإتاحة'); expect(context).toContain('قيد التطوير');
  if (/نافس|NAFS/.test(question)) { expect(context).toContain('الصف الثالث'); expect(context).toContain('Grades 6/9'); }
  if (/GAT/.test(question)) expect(context).toContain('الاستدلال الكمي واللفظي');
  if (/أسعار|بكام/.test(question)) expect(context).toContain('لا تحدد أسعارًا');
});

test.each(['عرفني علي موقهني وتصفيل كليفرو', 'Tell me everything about Klevro', 'طب كمل', 'إزاي أشوف نتيجتي؟'])('small references retain all facts and verified navigation even for vague or misspelled questions: %s', question => {
  const context = platformKnowledgeContext(DEFAULT_PLATFORM_KNOWLEDGE, question);
  expect(context).toContain(DEFAULT_PLATFORM_KNOWLEDGE);
  expect(context).toContain(PLATFORM_RUNTIME_GUIDE);
  expect(context).toContain('Reading/Writing');
  expect(context).toContain('الأسعار');
  expect(context).toContain('[مقرراتي / Courses](/courses)');
  expect(context).toContain('[تقارير الأداء / Reports](/reports)');
  expect(context).toContain('زر إنشاء حساب عام');
});

test('large references use prior user topics for follow-ups without treating assistant claims as a source', () => {
  const source = '## Identity\nOwner reference.\n## ZetaPath\nVerified ZetaPath curriculum.\n## Noise\n' + 'Other subject '.repeat(1200);
  const context = platformKnowledgeContext(source, 'Tell me more', 10000, [
    { role: 'user', content: 'Explain ZetaPath' }, { role: 'assistant', content: 'Invented feature: ZetaPath diplomas' },
  ]);
  expect(context).toContain('Verified ZetaPath curriculum');
  expect(context).not.toContain('ZetaPath diplomas');
  expect(context).toContain(PLATFORM_RUNTIME_GUIDE);
  expect(context.length).toBeLessThanOrEqual(10000);
});
test('admin edits are used as reference and long sources are bounded without a document runtime dependency', () => {
  const custom = '## تعريف المنصة\nOwner-approved platform text.\n## Example\n' + 'Content '.repeat(2000);
  const result = platformKnowledgeContext(custom, 'content', 500);
  expect(result).toContain('Owner-approved platform text'); expect(result.length).toBeLessThanOrEqual(500);
});
