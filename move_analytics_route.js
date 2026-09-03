// This script moves the analytics route BEFORE the generic /api/exams/:id route
const fs = require('fs');
let content = fs.readFileSync('src/routes/exams.ts', 'utf8');

// Find and extract the analytics route block
const analyticsStart = '\nrouter.get(\'/api/exams/:id/analytics\'';
const analyticsEnd = '});\n'; 

const startIdx = content.indexOf(analyticsStart);
if (startIdx === -1) {
  console.error('Analytics route not found!');
  process.exit(1);
}

// Find the end of the analytics route (the closing }); after it)
// We look for '});\n' after the start
let depth = 0;
let inRoute = false;
let routeEndIdx = -1;

for (let i = startIdx; i < content.length - 2; i++) {
  if (content[i] === '{') depth++;
  if (content[i] === '}') {
    depth--;
    if (depth === 0 && inRoute) {
      // Check for });
      if (content.substring(i, i+3) === '});') {
        routeEndIdx = i + 3;
        break;
      }
    }
  }
  if (depth > 0) inRoute = true;
}

if (routeEndIdx === -1) {
  console.error('Could not find end of analytics route');
  process.exit(1);
}

const analyticsBlock = content.substring(startIdx, routeEndIdx);
console.log('Extracted analytics block of length:', analyticsBlock.length);

// Remove analytics block from current position
content = content.substring(0, startIdx) + content.substring(routeEndIdx);

// Insert before the "// 4. Get Exam Details" comment line 
// Insert before the "// 4. Get Exam Details" comment line (the second occurrence near line 861)
const insertBefore = "// 4. Get Exam Details\nrouter.get('/api/exams/:id', verifyToken";
const insertIdx = content.indexOf(insertBefore);

if (insertIdx === -1) {
  console.error('Could not find insertion point!');
  process.exit(1);
}

content = content.substring(0, insertIdx) + analyticsBlock + '\n\n' + content.substring(insertIdx);
fs.writeFileSync('src/routes/exams.ts', content);
console.log('Done! Analytics route moved before /api/exams/:id');
