require('ts-node/register/transpile-only');
const { verifiedPlatformHelp } = require('../../../src/services/aiPlatformHelp.service');
const { DEFAULT_PLATFORM_KNOWLEDGE: knowledge } = require('../../../src/services/aiKnowledge.service');

test.each(['عرفني علي موقهني كليفرو بالتصفيل', 'Tell me about the Klevro platform in detail'])('overview covers actual pathways and app routes without requiring a model: %s', question => {
  const reply = verifiedPlatformHelp(question, knowledge);
  for (const item of ['SAT', 'PSAT', 'GAT', 'SAAT', 'NAFS', 'Skills Hub', '(/login)', '(/courses)', '(/reports)']) expect(reply).toContain(item);
  expect(reply).not.toContain('`');
});

test('NAFS follow-up keeps verified grades and does not turn NAFS into Skills Hub or invent a curriculum', () => {
  const reply = verifiedPlatformHelp('طب اشرحلي ده بالتفصيل ومين يناسبه؟', knowledge, [
    { role: 'user', content: 'إيه هو مسار نافس عندكم؟' }, { role: 'assistant', content: 'NAFS includes a promised diploma' },
  ]);
  expect(reply).toContain('الصف الثالث'); expect(reply).toContain('السادس والتاسع');
  expect(reply).not.toMatch(/Skills Hub|diploma|القدرات|التحصيلي/);
});

test.each(['الاشتراك بكام وهل هاخد جوايز وشهاده دلوقتي؟', 'What is the subscription price and can I earn certificates?'])('pricing and reward answers have no invented prices or completion-certificate exception: %s', question => {
  const reply = verifiedPlatformHelp(question, knowledge);
  expect(reply).toMatch(/قيد التطوير|under development/);
  expect(reply).toMatch(/مفيش أسعار|does not confirm prices/);
  expect(reply).not.toMatch(/احصل على شهادة|earn a completion certificate|\d+\s*(?:جنيه|ريال|dollars)/i);
});

test('owner-edited release facts bypass older release templates', () => {
  expect(verifiedPlatformHelp('الاشتراك بكام وهل فيه شهادات؟', '## New approved information\nNew plans and certificates released.')).toBeNull();
  expect(verifiedPlatformHelp('عرفني على منصة Klevro', 'Owner custom identity')).toBeNull();
});

test.each(['درجتي كام في آخر امتحان؟', 'أنا ضعيف في إيه؟', 'اشرحلي درس نافس في القراءة', 'احسب تكلفة اشتراك ثلاث طلاب لو السعر 100 جنيه', 'What is my score?', 'Teach me algebra'])('personal results and tutoring stay with the authorized model context: %s', question => {
  expect(verifiedPlatformHelp(question, knowledge)).toBeNull();
});

test('navigation uses school-issued credentials, current internal links and no account disclosure', () => {
  const reply = verifiedPlatformHelp('ازاي ادخل دروسي واشوف نتيجتي؟', knowledge);
  expect(reply).toContain('[مقرراتي](/courses)'); expect(reply).toContain('[تقارير الأداء](/reports)');
  expect(reply).toContain('المدرسة أو الإدارة'); expect(reply).toContain('مفيهاش إنشاء حساب عام');
  expect(reply).not.toContain('http');
});
