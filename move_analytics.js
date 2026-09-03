const fs = require('fs');

try {
  let content = fs.readFileSync('src/routes/exams.ts', 'utf8');

  // Find the exact block
  const analyticsRouteRegex = /router\.get\('\/api\/exams\/:id\/analytics'[\s\S]*?\n\}\);\n/;
  const match = content.match(analyticsRouteRegex);

  if (!match) {
    console.error('Analytics route not found');
    process.exit(1);
  }

  const analyticsCode = match[0];
  console.log('Found analytics code, length:', analyticsCode.length);

  // Remove the old code
  content = content.replace(analyticsCode, '');

  // Find the generic route
  const targetInsertion = "// 4. Get Exam Details\r\nrouter.get('/api/exams/:id'";
  let insertIdx = content.indexOf(targetInsertion);
  
  if (insertIdx === -1) {
    // Try without \r
    const targetInsertion2 = "// 4. Get Exam Details\nrouter.get('/api/exams/:id'";
    insertIdx = content.indexOf(targetInsertion2);
  }

  if (insertIdx === -1) {
    console.error('Could not find generic route insertion point');
    process.exit(1);
  }

  // Insert before the generic route
  content = content.substring(0, insertIdx) + analyticsCode + '\n' + content.substring(insertIdx);

  fs.writeFileSync('src/routes/exams.ts', content);
  console.log('Successfully moved analytics route!');

} catch (e) {
  console.error('Error:', e);
}
