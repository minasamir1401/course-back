const fs = require('fs');
const path = require('path');

const controllerPath = path.join(__dirname, '../../../src/controllers/exams.controller.ts');

describe('exam API error observability', () => {
  test('logs the underlying error when listing or reading an exam fails', () => {
    const source = ['exams.controller.ts', 'examManagement.ts', 'examEditing.ts'].map(file => fs.readFileSync(path.join(path.dirname(controllerPath), file), 'utf8')).join('\n');

    expect(source).toContain("import { logExamRequestError } from '../utils/examErrorLog';");
    expect(source).toContain("logExamRequestError('list', req, error);");
    expect(source).toContain("logExamRequestError('detail', req, error);");
  });
});
