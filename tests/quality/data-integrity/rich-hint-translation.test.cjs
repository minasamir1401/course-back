require('ts-node/register/transpile-only');
const { translateSingleText } = require('../../../src/services/translation.service');

const translate = async (text, from = 'en', to = 'ar') => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = jest.fn(async url => {
    const source = new URL(url).searchParams.get('q');
    requests.push(source);
    const dictionary = { 'Use the formula': 'استخدم القانون', 'to find the answer.': 'لإيجاد الإجابة.', 'English hint': 'تلميح عربي', 'A < B & C': 'أ < ب & ج', 'Check': 'تحقق', 'Now': 'الآن' };
    return { ok: true, json: async () => [[[dictionary[source] || source]]] };
  });
  try { return { html: await translateSingleText(text, from, to), requests }; }
  finally { global.fetch = originalFetch; }
};

test('formatted hints translate their visible text and preserve headings, colours and spaces', async () => {
  const input = '<h2 style="color:rgb(37, 99, 235);text-align:center"><b>Use the formula</b> to find the answer.</h2>';
  const result = await translate(input);
  expect(result.html).toBe('<h2 style="color:rgb(37, 99, 235);text-align:center"><b>استخدم القانون</b> لإيجاد الإجابة.</h2>');
  expect(result.requests.every(text => !text.includes('__HTML_') && !text.includes('<h2'))).toBe(true);
});

test('hint translation preserves images, rendered maths and literal LaTeX without sending them to providers', async () => {
  const math = '<span class="math-tex" dir="ltr" data-latex="x+1"><span class="katex"><math>x+1</math></span></span>';
  const image = '<img src="/uploads/arabic-question.webp" style="width:40%">';
  const input = '<p>Check ' + math + ' ' + String.raw`\(a+b\)` + ' ' + image + ' Now</p>';
  const result = await translate(input);
  expect(result.html).toBe('<p>تحقق ' + math + ' ' + String.raw`\(a+b\)` + ' ' + image + ' الآن</p>');
  expect(result.requests.join(' ')).not.toMatch(/katex|uploads|a\+b|x\+1|__HTML_|__MATH_/);
});

test('translated text stays text when it contains comparison symbols and entities', async () => {
  expect((await translate('<p>A &lt; B &amp; C</p>')).html).toBe('<p>أ &lt; ب &amp; ج</p>');
});
