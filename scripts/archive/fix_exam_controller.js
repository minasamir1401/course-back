const fs = require('fs');

const filePaths = [
  'd:/mina/back/src/controllers/exams.controller.ts'
];

const VALID_TYPES = ['MCQ', 'TRUE_FALSE', 'MULTI_SELECT', 'FLASH_CARD', 'FILL_BLANK', 'ESSAY', 'VIDEO_RESPONSE', 'AUDIO_RESPONSE', 'MATCHING', 'ORDERING', 'TEXT', 'IMAGE', 'VIDEO'];

filePaths.forEach(filePath => {
  let c = fs.readFileSync(filePath, 'utf8');
  
  c = c.replace(/type: q\.type === 'QUESTION' && q\.label \? sanitizeHtml\(q\.label\) : \(q\.type \? sanitizeHtml\(q\.type\) : 'MCQ'\),/g,
    `type: ${JSON.stringify(VALID_TYPES)}.includes(q.type === 'QUESTION' && q.label ? q.label : q.type) ? sanitizeHtml(q.type === 'QUESTION' && q.label ? q.label : q.type) : 'MCQ',`);
  
  c = c.replace(/type: q\.type \? sanitizeHtml\(q\.type\) : 'MCQ',/g, 
    `type: ${JSON.stringify(VALID_TYPES)}.includes(q.type) ? sanitizeHtml(q.type) : 'MCQ',`);
  
  c = c.replace(/type: question\.type \? sanitizeHtml\(question\.type\) : 'MCQ',/g, 
    `type: ${JSON.stringify(VALID_TYPES)}.includes(question.type) ? sanitizeHtml(question.type) : 'MCQ',`);

  fs.writeFileSync(filePath, c);
});

console.log("Done");
