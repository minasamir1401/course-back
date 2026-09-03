import assert from 'node:assert/strict';
import { resolvePassingScore } from '../src/utils/examPassingScore';

describe('examPassingScore', () => {
  it('inherits parent exam threshold when child has null score', () => {
    assert.equal(
      resolvePassingScore(50, null),
      50,
      'a child exam without its own passing score must inherit the parent exam threshold',
    );
  });

  it('uses child score when provided', () => {
    assert.equal(resolvePassingScore(50, 30), 30);
  });
});
