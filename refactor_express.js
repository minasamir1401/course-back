const fs = require('fs');

const routeFile = 'src/routes/courses.ts';
const controllerFile = 'src/controllers/courses.controller.ts';

if (!fs.existsSync('src/controllers')) {
  fs.mkdirSync('src/controllers');
}

let code = fs.readFileSync(routeFile, 'utf-8');

// We will scan character by character
let newRouteCode = '';
let controllerCode = `// Extracted Controller Functions\nimport prisma from "../lib/prisma";\nimport { sanitizeDeep, setCache, getCache, syncCourseToCloud } from "../shared";\n// Note: Add any other required imports here based on the extracted logic\n\n`;
let i = 0;
let handlerCount = 1;

while (i < code.length) {
  let routerMatch = code.slice(i).match(/^router\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/);
  if (routerMatch) {
    // Found a route!
    let verb = routerMatch[1];
    let routePath = routerMatch[2];
    
    // Create a generic name for the handler
    let handlerName = verb + 'CourseHandler' + handlerCount++;
    
    // Find where the async function starts
    let asyncIndex = code.slice(i).search(/async\s*\([^\)]*\)\s*=>\s*\{/);
    if (asyncIndex === -1 || asyncIndex > 500) {
      // Maybe not an async inline function, just append normal
      newRouteCode += code[i];
      i++;
      continue;
    }
    
    let absoluteAsyncStart = i + asyncIndex;
    let matchStr = code.slice(absoluteAsyncStart).match(/async\s*\([^\)]*\)\s*=>\s*\{/)[0];
    
    // Append everything before the async function to newRouteCode
    newRouteCode += code.slice(i, absoluteAsyncStart);
    
    // Now extract the function body by counting braces
    let bodyStart = absoluteAsyncStart + matchStr.length - 1; // points to '{'
    let braceCount = 1;
    let j = bodyStart + 1;
    while (j < code.length && braceCount > 0) {
      if (code[j] === '{') braceCount++;
      if (code[j] === '}') braceCount--;
      j++;
    }
    
    // Extract the function
    let funcSignature = matchStr.replace('{', '').trim();
    let funcBody = code.slice(bodyStart, j);
    
    controllerCode += `export const ${handlerName} = async (req: any, res: any, next?: any) => ${funcBody}\n\n`;
    
    // Replace the function in route code with the handlerName
    newRouteCode += handlerName;
    
    i = j; // advance past the function
  } else {
    newRouteCode += code[i];
    i++;
  }
}

// Add imports to route file
newRouteCode = `import * as coursesController from '../controllers/courses.controller';\n` + newRouteCode;
// Replace the handler names with the imported ones
for (let c = 1; c < handlerCount; c++) {
  let h = new RegExp(`(get|post|put|delete|patch)CourseHandler${c}`, 'g');
  newRouteCode = newRouteCode.replace(h, `coursesController.$1CourseHandler${c}`);
}

fs.writeFileSync('src/routes/courses.new.ts', newRouteCode);
fs.writeFileSync(controllerFile, controllerCode);
console.log('Done splitting! Controller generated with ' + (handlerCount - 1) + ' functions.');
