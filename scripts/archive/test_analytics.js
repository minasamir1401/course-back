const fetch = require('node-fetch') || function() { return import('node-fetch').then(m => m.default(...arguments)) };

async function test() {
  try {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InNvbWUtdXNlci1pZCIsInJvbGUiOiJTVVBFUl9BRE1JTiIsInNjaG9vbElkIjoic29tZS1zY2hvb2wtaWQiLCJpYXQiOjE3ODcwMjg5Njd9.pOQpZZL3zj1HfQ-5x00FNCuszkue-OKXTA4yeEU8y8M';
    const res = await globalThis.fetch('http://localhost:5000/api/exams/fb9a25ec-6aa2-4613-9258-05b4dc49ee74/analytics', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Status:', res.status);
    const json = await res.text();
    console.log('Body:', json.substring(0, 500));
  } catch (e) {
    console.error(e);
  }
}
test();
