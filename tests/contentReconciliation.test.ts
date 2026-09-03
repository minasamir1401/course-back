import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildLessonFingerprint,
  buildQuestionFingerprint,
  pickReconciliationCandidate,
  sortPersistedOrder,
} from '../src/lib/contentReconciliation';

const test = (name: string, assertion: () => void) => {
  assertion();
  console.log(`PASS ${name}`);
};

test('repeated ID-less question autosaves reuse the persisted row', () => {
  const persisted = {
    id: 'question-1',
    order: 0,
    createdAt: '2026-08-12T00:00:00.000Z',
    fingerprint: buildQuestionFingerprint({
      text: '2 + 2?',
      type: 'MCQ',
      options: '["3","4"]',
      correctAnswer: '4',
    }),
  };
  const repeatedPayloadFingerprint = buildQuestionFingerprint({
    text: '2 + 2?',
    type: 'MCQ',
    options: ['3', '4'],
    correctAnswer: '4',
  });

  const firstRetry = pickReconciliationCandidate(
    [persisted], 0, repeatedPayloadFingerprint, new Set(), new Set()
  );
  const laterRetry = pickReconciliationCandidate(
    [persisted], 0, repeatedPayloadFingerprint, new Set(), new Set()
  );

  assert.equal(firstRetry?.id, 'question-1');
  assert.equal(laterRetry?.id, 'question-1');
});

test('same-title lessons with different content remain distinct', () => {
  const persisted = {
    id: 'lesson-1',
    order: 0,
    createdAt: '2026-08-12T00:00:00.000Z',
    fingerprint: buildLessonFingerprint({
      title: 'Introduction',
      slides: [{ type: 'TEXT', content: 'First topic' }],
    }),
  };
  const distinctSameTitle = buildLessonFingerprint({
    title: 'Introduction',
    slides: [{ type: 'TEXT', content: 'Second topic' }],
  });

  assert.equal(
    pickReconciliationCandidate([persisted], 0, distinctSameTitle, new Set(), new Set()),
    undefined
  );
  assert.equal(
    pickReconciliationCandidate([persisted], 0, persisted.fingerprint, new Set(), new Set())?.id,
    'lesson-1'
  );
});

test('same-title lessons with different attachments or metadata remain distinct', () => {
  const persistedFingerprint = buildLessonFingerprint({
    title: 'Introduction',
    slides: [{ type: 'TEXT', content: 'Shared content' }],
    attachments: [{ name: 'worksheet-a.pdf', url: '/uploads/a.pdf' }],
    standards: 'STANDARD-A',
  });
  const incomingFingerprint = buildLessonFingerprint({
    title: 'Introduction',
    slides: [{ type: 'TEXT', content: 'Shared content' }],
    attachments: [{ name: 'worksheet-b.pdf', url: '/uploads/b.pdf' }],
    standards: 'STANDARD-B',
  });
  const persisted = { id: 'lesson-metadata', order: 0, fingerprint: persistedFingerprint };

  assert.notEqual(persistedFingerprint, incomingFingerprint);
  assert.equal(
    pickReconciliationCandidate([persisted], 0, incomingFingerprint, new Set(), new Set()),
    undefined
  );
});

test('explicit incoming IDs are reserved from ID-less reconciliation', () => {
  const persisted = {
    id: 'question-reserved',
    order: 0,
    fingerprint: buildQuestionFingerprint({ text: 'same', options: [] }),
  };
  assert.equal(
    pickReconciliationCandidate(
      [persisted],
      0,
      persisted.fingerprint,
      new Set(['question-reserved']),
      new Set()
    ),
    undefined
  );
});

test('order ties have a stable createdAt and ID fallback', () => {
  const sorted = sortPersistedOrder([
    { id: 'b', order: 3, createdAt: '2026-08-12T00:00:01.000Z' },
    { id: 'old', order: 3, createdAt: '2026-08-12T00:00:00.000Z' },
    { id: 'a', order: 3, createdAt: '2026-08-12T00:00:01.000Z' },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ['old', 'a', 'b']);
});

test('course imports never invoke destructive global title deduplication', () => {
  const importsRoute = fs.readFileSync(path.resolve(__dirname, '../src/routes/imports.ts'), 'utf8');
  const coursesRoute = fs.readFileSync(path.resolve(__dirname, '../src/routes/courses.ts'), 'utf8');
  assert.equal(/runGlobalDeduplication\s*\(/.test(importsRoute), false);
  assert.equal(/runGlobalDeduplication\s*\(/.test(coursesRoute), false);
  assert.match(coursesRoute, /Automatic title-based deduplication is disabled/);
});

test('conflicting delete IDs win before question reordering', () => {
  const examsRoute = fs.readFileSync(path.resolve(__dirname, '../src/routes/exams.ts'), 'utf8');
  assert.match(
    examsRoute,
    /if \(typeof q\?\.id === 'string' && explicitDeletedIds\.has\(q\.id\)\)[\s\S]*continue;/
  );
  assert.match(
    examsRoute,
    /retainedIncomingQuestionIds = incomingQuestionIds\.filter\(\(questionId\) => !explicitDeletedIds\.has\(questionId\)\)/
  );
});

test('explicit deduplication uses the recycle bin instead of cascading hard deletes', () => {
  const deduplicateRoute = fs.readFileSync(path.resolve(__dirname, '../src/routes/deduplicate.ts'), 'utf8');
  assert.equal(/tx\.(question|lesson|exam|course)\.deleteMany/.test(deduplicateRoute), false);
  assert.match(deduplicateRoute, /tx\.question\.updateMany[\s\S]*deletedAt: new Date\(\)/);
  assert.match(deduplicateRoute, /where: \{ deletedAt: null \}/);
});

test('course and exam updates reject malformed collection payloads', () => {
  const coursesRoute = fs.readFileSync(path.resolve(__dirname, '../src/routes/courses.ts'), 'utf8');
  const examsRoute = fs.readFileSync(path.resolve(__dirname, '../src/routes/exams.ts'), 'utf8');
  assert.match(coursesRoute, /lessons !== undefined && !Array\.isArray\(lessons\)[\s\S]*status\(400\)/);
  assert.match(examsRoute, /questions !== undefined && !Array\.isArray\(questions\)[\s\S]*status\(400\)/);
});

test('legacy order ties use deterministic database fallbacks in API and export reads', () => {
  const routeSources = [
    '../src/routes/courses.ts',
    '../src/routes/exams.ts',
    '../src/routes/imports.ts',
    '../src/routes/backups.ts',
  ].map((file) => fs.readFileSync(path.resolve(__dirname, file), 'utf8')).join('\n');
  assert.equal(/orderBy: \{ order: 'asc' \}/.test(routeSources), false);
  assert.match(routeSources, /orderBy: \[\{ order: 'asc' \}, \{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/);
});

console.log('\nAll content reconciliation tests passed.');
