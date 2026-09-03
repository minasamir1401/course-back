require('ts-node/register/transpile-only');

const { sanitizeDeep } = require('../../../src/shared');

describe('import sanitization security policy', () => {
  test('strips dangerous <script> tags and onerror handlers from nested JSON', () => {
    const maliciousPayload = {
      course: {
        title: 'Math Grade 10 <script>alert("xss")</script>',
        description: '<img src="x" onerror="alert(1)">Basic Course',
      },
      lessons: [
        {
          title: 'Lesson 1 <script src="evil.js"></script>',
          content: '<p>Hello</p><a href="javascript:alert(1)">Click me</a>',
          questions: [
            {
              text: 'Solve: <script>document.cookie</script> 2+2=?',
              options: ['4', '<svg onload="alert(1)">5'],
            }
          ]
        }
      ]
    };

    const sanitized = sanitizeDeep(maliciousPayload);

    // Verify course title and description
    expect(sanitized.course.title).not.toContain('<script>');
    expect(sanitized.course.title).not.toContain('alert("xss")');
    expect(sanitized.course.title).toContain('Math Grade 10');

    expect(sanitized.course.description).not.toContain('onerror');

    // Verify lessons and questions
    expect(sanitized.lessons[0].title).not.toContain('<script');
    expect(sanitized.lessons[0].questions[0].text).not.toContain('<script>');
    expect(sanitized.lessons[0].questions[0].text).toContain('Solve:  2+2=?');
    expect(sanitized.lessons[0].options ? sanitized.lessons[0].options : sanitized.lessons[0].questions[0].options[1]).not.toContain('onload');
  });

  test('preserves valid safe HTML tags and Arabic text', () => {
    const safePayload = {
      title: 'كورس الرياضيات - الصف الأول الثانوي',
      description: '<p>شرح <strong>مفصل</strong> لمادة الجبر</p>',
    };

    const sanitized = sanitizeDeep(safePayload);

    expect(sanitized.title).toBe('كورس الرياضيات - الصف الأول الثانوي');
    expect(sanitized.description).toContain('<strong>مفصل</strong>');
  });
});
