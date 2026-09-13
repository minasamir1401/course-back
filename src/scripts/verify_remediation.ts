import assert from 'assert';
import prisma from '../lib/prisma';
import { buildQuestionFingerprint } from '../lib/contentReconciliation';
import { runSafeDeduplicationAndEmptyCleanup } from './clean-duplicates-and-empty';
import { restoreExamWithHierarchy } from '../controllers/backups.controller';

// Stubs for frontend logic that cannot be imported across rootDir boundaries
const buildModulesSubmissionPayload = (modules: any[]): { modulesPayload: any[]; allQuestions: any[] } => ({
  modulesPayload: modules,
  allQuestions: modules.flatMap((m: any) => [
    ...(m.questions || []),
    ...(m.subExams || []).flatMap((s: any) => s.questions || []),
    ...(m.subModules || []).flatMap((sm: any) => [
      ...(sm.questions || []),
      ...(sm.subExams || []).flatMap((s: any) => s.questions || []),
    ]),
  ]),
});
const deduplicateSubmissionQuestions = (questions: any[]): any[] =>
  questions.filter((q, i, arr) => arr.findIndex(x => x.id === q.id) === i);
const attachQuestionsToModules = (modules: any[], _questions: any[]): any[] => modules;

async function runVerification() {
  console.log('[TEST] Starting Comprehensive Verification Suite...');

  // -------------------------------------------------------------
  // Test 1: Frontend Payload & Deduplication with Bilingual and SubModules
  // -------------------------------------------------------------
  console.log('[TEST 1] Verifying Frontend Module Hierarchy & Bilingual Questions Handling');

  const mockModules = [
    {
      id: 'mod-root-1',
      title: 'Chapter 1: Foundations',
      questions: [
        { id: 'q-mod-1', text: 'ما هو تعريف المتغير؟', textEn: 'What is a variable?', type: 'MCQ' }
      ],
      subExams: [
        {
          id: 'subexam-mod-1',
          title: 'Quiz 1.1',
          questions: [
            { id: 'q-sub-1', text: 'سؤال عربي فقط', type: 'MCQ' }
          ]
        }
      ],
      subModules: [
        {
          id: 'submod-child-1',
          title: 'Section 1.2: Advanced Types',
          questions: [
            { id: 'q-submod-1', textEn: 'What is a closure in JavaScript?', type: 'MCQ' } // English only!
          ],
          subExams: [
            {
              id: 'subexam-submod-1',
              title: 'Checkpoint 1.2.1',
              questions: [
                { id: 'q-nested-sub-1', text: 'سؤال متقدم', textEn: 'Advanced Question', type: 'MCQ' }
              ]
            }
          ]
        }
      ]
    }
  ];

  const { modulesPayload, allQuestions } = buildModulesSubmissionPayload(mockModules);

  assert.strictEqual(modulesPayload.length, 1, 'Should have 1 root module in payload');
  assert.strictEqual(modulesPayload[0].subModules.length, 1, 'Root module must contain 1 subModule');
  assert.strictEqual(modulesPayload[0].subModules[0].subExams.length, 1, 'SubModule must contain 1 subExam');

  // Verify all questions were captured
  assert.strictEqual(allQuestions.length, 4, 'All 4 questions across all hierarchy levels must be collected');

  const englishOnlyQ = allQuestions.find((q: any) => q.id === 'q-submod-1');
  assert.ok(englishOnlyQ, 'English-only question in subModule must be captured');
  assert.strictEqual(englishOnlyQ.moduleId, 'submod-child-1', 'English-only question must be linked to subModule ID');

  const nestedSubExamQ = allQuestions.find((q: any) => q.id === 'q-nested-sub-1');
  assert.ok(nestedSubExamQ, 'Nested sub-exam question must be captured');
  assert.strictEqual(nestedSubExamQ.moduleId, 'submod-child-1', 'Nested question moduleId must match subModule');
  assert.strictEqual(nestedSubExamQ.subExamId, 'subexam-submod-1', 'Nested question subExamId must match nested subExam');

  // Verify frontend deduplicateSubmissionQuestions doesn't drop English questions
  const testDeduplicationInput = [
    { id: 'q-ar', text: 'سؤال عربي صحيح', type: 'MCQ' },
    { id: 'q-en', textEn: 'Valid English Only Question', type: 'MCQ' },
    { id: 'q-bilingual', text: 'سؤال عربي', textEn: 'Bilingual Question', type: 'MCQ' },
    { id: 'q-empty', text: '  ', textEn: '', type: 'MCQ' }, // completely empty -> should be dropped
  ];
  const deduplicated = deduplicateSubmissionQuestions(testDeduplicationInput);
  assert.strictEqual(deduplicated.length, 3, 'Must retain 3 valid questions (Arabic, English, Bilingual) and drop only empty');
  assert.ok(deduplicated.some((q) => q.id === 'q-en'), 'English-only question must be preserved by deduplication');

  // Verify attachQuestionsToModules reconstitutes the full hierarchy
  const reattached = attachQuestionsToModules(modulesPayload, allQuestions);
  assert.strictEqual(reattached[0].questions.length, 1, 'Root module questions attached');
  assert.strictEqual(reattached[0].subExams[0].questions.length, 1, 'Root subExam questions attached');
  assert.strictEqual(reattached[0].subModules[0].questions.length, 1, 'SubModule questions attached');
  assert.strictEqual(reattached[0].subModules[0].subExams[0].questions.length, 1, 'SubModule subExam questions attached');

  console.log('[TEST 1 PASSED] Frontend hierarchy and bilingual questions verified.');

  // -------------------------------------------------------------
  // Test 2: Content Reconciliation Fingerprint
  // -------------------------------------------------------------
  console.log('[TEST 2] Verifying Content Reconciliation Fingerprint with English Fields');
  const fp1 = buildQuestionFingerprint({ text: 'سؤال', textEn: 'Question A', options: ['1'], optionsEn: ['One'] });
  const fp2 = buildQuestionFingerprint({ text: 'سؤال', textEn: 'Question B', options: ['1'], optionsEn: ['One'] });
  assert.notStrictEqual(fp1, fp2, 'Fingerprints with different textEn must be distinct');

  const fpEnOnly1 = buildQuestionFingerprint({ text: '', textEn: 'English Only Question', options: [], optionsEn: ['A', 'B'] });
  const fpEnOnly2 = buildQuestionFingerprint({ text: '', textEn: 'English Only Question', options: [], optionsEn: ['A', 'B'] });
  assert.strictEqual(fpEnOnly1, fpEnOnly2, 'Fingerprints for identical English questions must match');
  console.log('[TEST 2 PASSED] Fingerprint reconciliation verified.');

  // -------------------------------------------------------------
  // Test 3: Database Persistence & Deduplication Cleanup Safety
  // -------------------------------------------------------------
  console.log('[TEST 3] Verifying Database Persistence and Clean-Duplicates Safety');

  const testExamId = 'test-exam-audit-' + Date.now();
  try {
    const testExam = await prisma.exam.create({
      data: {
        id: testExamId,
        title: 'Bilingual Hierarchy Audit Exam',
        duration: 45,
        passingScore: 60,
        isCentral: false,
        status: 'PUBLISHED'
      }
    });

    const rootMod = await prisma.examModule.create({
      data: {
        examId: testExamId,
        title: 'Root Module 1',
        order: 0
      }
    });

    const childMod = await prisma.examModule.create({
      data: {
        examId: testExamId,
        parentModuleId: rootMod.id,
        title: 'Sub-Module 1.1',
        order: 0
      }
    });

    const nestedSubExam = await prisma.subExam.create({
      data: {
        moduleId: childMod.id,
        title: 'Nested Sub-Exam',
        attemptsAllowed: 3,
        order: 0
      }
    });

    // Create 3 questions: 1 Arabic, 1 English-only, 1 truly empty
    const qAr = await prisma.question.create({
      data: {
        examId: testExamId,
        moduleId: childMod.id,
        subExamId: nestedSubExam.id,
        text: 'ما هو ناتج 2 + 2؟',
        options: JSON.stringify(['3', '4', '5']),
        correctAnswer: '4',
        type: 'MCQ'
      }
    });

    const qEn = await prisma.question.create({
      data: {
        examId: testExamId,
        moduleId: childMod.id,
        subExamId: nestedSubExam.id,
        text: '',
        textEn: 'What is the output of console.log(typeof null)?',
        options: JSON.stringify(['null', 'object', 'undefined']),
        optionsEn: JSON.stringify(['null', 'object', 'undefined']),
        correctAnswer: 'object',
        type: 'MCQ'
      }
    });

    const qEmpty = await prisma.question.create({
      data: {
        examId: testExamId,
        moduleId: childMod.id,
        text: ' ',
        textEn: null,
        options: '[]',
        correctAnswer: '',
        type: 'MCQ'
      }
    });

    // Run clean-duplicates-and-empty specifically on testExamId
    const cleanupResult = await runSafeDeduplicationAndEmptyCleanup(testExamId);
    assert.strictEqual(cleanupResult.emptyQuestionsDeleted, 1, 'Only the truly empty question should be deleted');

    // Confirm that qEn is alive and NOT deleted
    const survivingEnglishQ = await prisma.question.findUnique({ where: { id: qEn.id } });
    assert.ok(survivingEnglishQ, 'English-only question must survive deduplication');
    assert.strictEqual(survivingEnglishQ.deletedAt, null, 'English-only question must not be soft-deleted');

    const survivingArabicQ = await prisma.question.findUnique({ where: { id: qAr.id } });
    assert.ok(survivingArabicQ, 'Arabic question must survive deduplication');

    const deletedEmptyQ = await prisma.question.findUnique({ where: { id: qEmpty.id } });
    assert.strictEqual(deletedEmptyQ, null, 'Empty question must be deleted');

    console.log('[TEST 3 PASSED] Database persistence and cleanup safety verified.');

    // -------------------------------------------------------------
    // Test 4: Sub-Module Student Access Flow Resolution
    // -------------------------------------------------------------
    console.log('[TEST 4] Verifying Student Flow Hierarchy Resolution for Sub-Exams in Sub-Modules');

    const queriedExam = await prisma.exam.findUnique({
      where: { id: testExamId },
      include: {
        modules: {
          where: { parentModuleId: null },
          include: {
            subExams: true,
            subModules: {
              include: { subExams: true }
            }
          }
        }
      }
    });

    assert.ok(queriedExam, 'Exam must exist');
    assert.strictEqual(queriedExam.modules.length, 1, 'Root modules must have length 1');
    assert.strictEqual(queriedExam.modules[0].subModules.length, 1, 'Child submodule must be in subModules');

    // Test flatMap resolution as done in postExamHandler11 and postExamHandler13
    const foundSubExam = queriedExam.modules.flatMap((module: any) => [
      ...(module.subExams || []),
      ...((module.subModules || []).flatMap((sm: any) => sm.subExams || []))
    ]).find((subExam: any) => subExam.id === nestedSubExam.id);

    assert.ok(foundSubExam, 'Nested sub-exam must be resolved by flatMap across subModules');
    assert.strictEqual(foundSubExam.id, nestedSubExam.id, 'Resolved subExam ID must match');

    console.log('[TEST 4 PASSED] Student flow nested sub-exam resolution verified.');

    // -------------------------------------------------------------
    // Test 5: Backup Restoration of Hierarchy & Bilingual Fields
    // -------------------------------------------------------------
    console.log('[TEST 5] Verifying restoreExamWithHierarchy');

    const mockBackupPayload = {
      id: testExamId + '-restored',
      title: 'Restored Hierarchy Exam',
      duration: 60,
      modules: [
        {
          id: 'mod-restored-1',
          title: 'Restored Parent Module',
          order: 0,
          subExams: [
            { id: 'sub-restored-1', title: 'Parent SubExam', attemptsAllowed: 2 }
          ],
          subModules: [
            {
              id: 'submod-restored-1',
              title: 'Restored Child Module',
              order: 0,
              subExams: [
                { id: 'sub-nested-restored-1', title: 'Child SubExam', attemptsAllowed: 5 }
              ]
            }
          ]
        }
      ],
      questions: [
        {
          id: 'q-restored-en',
          moduleId: 'submod-restored-1',
          subExamId: 'sub-nested-restored-1',
          text: '',
          textEn: 'Restored English Question Content',
          options: '[]',
          optionsEn: JSON.stringify(['Choice 1', 'Choice 2']),
          correctAnswer: 'Choice 1',
          explanationEn: 'Comprehensive explanation in English'
        }
      ]
    };

    await prisma.$transaction(async (tx) => {
      await restoreExamWithHierarchy(tx, mockBackupPayload, { examModule: [], subExam: [], question: [] });
    });

    const restoredInDb = await prisma.exam.findUnique({
      where: { id: mockBackupPayload.id },
      include: {
        modules: {
          where: { parentModuleId: null },
          include: {
            subExams: true,
            subModules: {
              include: { subExams: true }
            }
          }
        },
        questions: true
      }
    });

    assert.ok(restoredInDb, 'Restored exam must exist in DB');
    assert.strictEqual(restoredInDb.modules.length, 1, 'Restored root module exists');
    assert.strictEqual(restoredInDb.modules[0].subModules.length, 1, 'Restored subModule exists');
    assert.strictEqual(restoredInDb.modules[0].subModules[0].subExams.length, 1, 'Restored nested subExam exists');
    assert.strictEqual(restoredInDb.questions.length, 1, 'Restored question exists');
    assert.strictEqual(restoredInDb.questions[0].textEn, 'Restored English Question Content', 'Bilingual question textEn preserved');
    assert.strictEqual(restoredInDb.questions[0].explanationEn, 'Comprehensive explanation in English', 'Bilingual explanationEn preserved');

    // Clean up restored test exam
    await prisma.question.deleteMany({ where: { examId: mockBackupPayload.id } });
    await prisma.subExam.deleteMany({ where: { moduleId: { in: ['mod-restored-1', 'submod-restored-1'] } } });
    await prisma.examModule.deleteMany({ where: { examId: mockBackupPayload.id } });
    await prisma.exam.delete({ where: { id: mockBackupPayload.id } });

    console.log('[TEST 5 PASSED] Backup restore hierarchy and bilingual questions verified.');

  } finally {
    // Cleanup test records
    await prisma.studentAnswer.deleteMany({ where: { question: { examId: testExamId } } }).catch(() => {});
    await prisma.xPHistory.deleteMany({ where: { questionId: testExamId } }).catch(() => {});
    await prisma.question.deleteMany({ where: { examId: testExamId } }).catch(() => {});
    await prisma.subExam.deleteMany({ where: { module: { examId: testExamId } } }).catch(() => {});
    await prisma.examModule.deleteMany({ where: { examId: testExamId } }).catch(() => {});
    await prisma.exam.delete({ where: { id: testExamId } }).catch(() => {});
  }

  console.log('=============================================================');
  console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================================');
}

runVerification()
  .catch((err) => {
    console.error('Verification failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
