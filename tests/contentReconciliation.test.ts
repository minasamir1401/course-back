import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildLessonFingerprint,
  buildQuestionFingerprint,
  pickReconciliationCandidate,
  sortPersistedOrder,
} from '../src/lib/contentReconciliation';

describe('Content Reconciliation & Data Safety', () => {
  it('repeated ID-less question autosaves reuse the persisted row', () => {
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

  it('same-title lessons with different content remain distinct', () => {
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

  it('same-title lessons with different attachments or metadata remain distinct', () => {
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

  it('explicit incoming IDs are reserved from ID-less reconciliation', () => {
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

  it('order ties have a stable createdAt and ID fallback', () => {
    const sorted = sortPersistedOrder([
      { id: 'b', order: 3, createdAt: '2026-08-12T00:00:01.000Z' },
      { id: 'old', order: 3, createdAt: '2026-08-12T00:00:00.000Z' },
      { id: 'a', order: 3, createdAt: '2026-08-12T00:00:01.000Z' },
    ]);
    assert.deepEqual(sorted.map((item) => item.id), ['old', 'a', 'b']);
  });

  it('course imports never invoke destructive global title deduplication', () => {
    const importsRoute = fs.readFileSync(path.resolve(__dirname, '../src/routes/imports.ts'), 'utf8');
    const coursesController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/courses.controller.ts'), 'utf8');
    assert.equal(/runGlobalDeduplication\s*\(/.test(importsRoute), false);
    assert.equal(/runGlobalDeduplication\s*\(/.test(coursesController), false);
    assert.match(coursesController, /Automatic title-based deduplication is disabled/);
  });

  it('conflicting delete IDs win before question reordering', () => {
    const examsController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/exams.controller.ts'), 'utf8');
    assert.match(
      examsController,
      /if \(typeof q\?\.id === 'string' && explicitDeletedIds\.has\(q\.id\)\)[\s\S]*continue;/
    );
    assert.match(
      examsController,
      /retainedIncomingQuestionIds = incomingQuestionIds\.filter\(\(questionId\) => !explicitDeletedIds\.has\(questionId\)\)/
    );
  });

  it('explicit deduplication uses the recycle bin instead of cascading hard deletes', () => {
    const deduplicateRoute = fs.readFileSync(path.resolve(__dirname, '../src/routes/deduplicate.ts'), 'utf8');
    assert.equal(/tx\.(question|lesson|exam|course)\.deleteMany/.test(deduplicateRoute), false);
    assert.match(deduplicateRoute, /tx\.question\.updateMany[\s\S]*deletedAt: new Date\(\)/);
    assert.match(deduplicateRoute, /where: \{ deletedAt: null \}/);
  });

  it('course and exam updates reject malformed collection payloads', () => {
    const coursesController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/courses.controller.ts'), 'utf8');
    const examsController = fs.readFileSync(path.resolve(__dirname, '../src/controllers/exams.controller.ts'), 'utf8');
    assert.match(coursesController, /lessons !== undefined && !Array\.isArray\(lessons\)[\s\S]*status\(400\)/);
    assert.match(examsController, /questions !== undefined && !Array\.isArray\(questions\)[\s\S]*status\(400\)/);
  });

  it('legacy order ties use deterministic database fallbacks in API and export reads', () => {
    const routeSources = [
      '../src/routes/courses.ts',
      '../src/routes/exams.ts',
      '../src/routes/imports.ts',
      '../src/routes/backups.ts',
    ].map((file) => fs.readFileSync(path.resolve(__dirname, file), 'utf8')).join('\n');
    assert.equal(/orderBy: \{ order: 'asc' \}/.test(routeSources), false);
    assert.match(routeSources, /orderBy: \[\{ order: 'asc' \}, \{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/);
  });
});
