const fs = require('fs');
const ts = require('typescript');

const filePath = 'src/routes/exams.ts';
const sourceFile = ts.createSourceFile(
  filePath,
  fs.readFileSync(filePath, 'utf-8'),
  ts.ScriptTarget.Latest,
  true
);

let controllers = [];
let imports = [];
let routeReplacements = [];

ts.forEachChild(sourceFile, node => {
  if (ts.isImportDeclaration(node)) {
    imports.push(node.getFullText(sourceFile));
  }
});

function visit(node) {
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      if (expr.expression.getText(sourceFile) === 'router') {
        const verb = expr.name.getText(sourceFile);
        if (['get', 'post', 'put', 'patch', 'delete'].includes(verb)) {
          const args = node.arguments;
          if (args.length >= 2) {
            const handler = args[args.length - 1];
            if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
              const handlerName = verb + 'ExamHandler' + (controllers.length + 1);
              let handlerText = handler.getFullText(sourceFile);
              
              controllers.push({
                name: handlerName,
                text: 'export const ' + handlerName + ' = ' + handlerText.trim() + ';\n'
              });

              routeReplacements.push({
                start: handler.getStart(sourceFile),
                end: handler.getEnd(),
                name: 'examsController.' + handlerName
              });
            }
          }
        }
      }
    }
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);

let routeCode = fs.readFileSync(filePath, 'utf-8');
routeReplacements.sort((a, b) => b.start - a.start);
for (const rep of routeReplacements) {
  routeCode = routeCode.slice(0, rep.start) + rep.name + routeCode.slice(rep.end);
}

routeCode = 'import * as examsController from "../controllers/courses.controller";\n' + routeCode;

if (!fs.existsSync('src/controllers')) fs.mkdirSync('src/controllers');

let controllerCode = imports.join('').trim() + '\n\n';
controllerCode += controllers.map(c => c.text).join('\n\n');

fs.writeFileSync('src/routes/exams.new.ts', routeCode);
fs.writeFileSync('src/controllers/exams.controller.ts', controllerCode);

console.log('Successfully parsed AST and extracted ' + controllers.length + ' controllers!');
