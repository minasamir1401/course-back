const fs = require('fs');

let controller = fs.readFileSync('src/controllers/courses.controller.ts', 'utf-8');
let route = fs.readFileSync('src/routes/courses.ts', 'utf-8'); // the original one
let newRoute = fs.readFileSync('src/routes/courses.new.ts', 'utf-8');

// 1. Extract ALL imports from original courses.ts and put them at the top of controller
let imports = [];
let lines = route.split('\n');
for (let line of lines) {
  if (line.startsWith('import ')) {
    imports.push(line);
  }
}
let importBlock = imports.join('\n');

controller = controller.replace(/^.*?\n\n/s, importBlock + '\n\n'); // replace the old imports block
fs.writeFileSync('src/controllers/courses.controller.ts', controller);

// 2. Fix the coursesController double prefix in newRoute
newRoute = newRoute.replace(/coursesController\.coursesController\./g, 'coursesController.');
fs.writeFileSync('src/routes/courses.new.ts', newRoute);
