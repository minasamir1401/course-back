import assert from 'node:assert/strict';
import { resolvePassingScore } from '../src/utils/examPassingScore';

assert.equal(
  resolvePassingScore(50, null),
  50,
  'a child exam without its own passing score must inherit the parent exam threshold',
);

assert.equal(resolvePassingScore(50, 30), 30);

console.log('exam passing score tests passed');
