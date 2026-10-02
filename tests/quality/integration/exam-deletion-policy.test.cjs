const { resolveExplicitExamDeletions } = require('../../../src/utils/examDeletionPolicy');

describe('exam deletion policy', () => {
  test('does not infer deletions from a partial save payload', () => {
    expect(resolveExplicitExamDeletions({
      modules: [{ id: 'module-1', subExams: [{ id: 'exam-1' }] }],
    })).toEqual({ moduleIds: [], subExamIds: [] });
  });

  test('accepts only explicit, valid ids for deletion', () => {
    expect(resolveExplicitExamDeletions({
      deletedModuleIds: ['module-1', '', null, 'module-1'],
      deletedSubExamIds: ['exam-1', 42, 'exam-1'],
    })).toEqual({ moduleIds: ['module-1'], subExamIds: ['exam-1'] });
  });
});
