const sanitize = require('sanitize-html');
const input = JSON.stringify([{ type: 'EXPLANATION', content: '<p>Some "quotes" and <a href="#">links</a></p>' }]);
const output = sanitize(input, { allowedTags: ['p', 'a'], allowedAttributes: { a: ['href'] } });
console.log('INPUT:', input);
console.log('OUTPUT:', output);
try {
  console.log('PARSED:', JSON.parse(output));
} catch (e) {
  console.error('PARSE ERROR:', e);
}
