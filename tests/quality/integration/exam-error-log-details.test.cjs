const { execFileSync } = require('child_process');
const path = require('path');

const helperPath = path.resolve(__dirname, '../../../src/utils/examErrorLog.ts');

function buildLogInNodeProcess() {
  const script = `
    const { buildExamErrorLog } = require(${JSON.stringify(helperPath)});
    const error = Object.assign(new Error('Column does not exist'), {
      code: 'P2022',
      meta: { column: 'SubExam.password' },
    });
    const request = {
      method: 'GET',
      originalUrl: '/api/exams?grade=5',
      params: { id: 'exam-1' },
      query: { grade: '5' },
      user: { id: 'user-1', role: 'SCHOOL_ADMIN', schoolId: 'school-1' },
    };
    console.log(JSON.stringify(buildExamErrorLog('list', request, error)));
  `;

  return JSON.parse(execFileSync(process.execPath, ['-r', 'ts-node/register', '-e', script], {
    encoding: 'utf8',
  }));
}

describe('exam error log details', () => {
  test('captures request context and Prisma error details for Dokploy logs', () => {
    const details = buildLogInNodeProcess();

    expect(details.event).toBe('list');
    expect(details.request).toEqual({
      method: 'GET',
      path: '/api/exams?grade=5',
      params: { id: 'exam-1' },
      query: { grade: '5' },
      userId: 'user-1',
      role: 'SCHOOL_ADMIN',
      schoolId: 'school-1',
    });
    expect(details.error).toMatchObject({
      name: 'Error',
      message: 'Column does not exist',
      code: 'P2022',
      meta: { column: 'SubExam.password' },
    });
    expect(details.error.stack).toContain('Column does not exist');
  });
});
