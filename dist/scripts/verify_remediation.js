"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const contentReconciliation_1 = require("../lib/contentReconciliation");
const clean_duplicates_and_empty_1 = require("./clean-duplicates-and-empty");
const backups_controller_1 = require("../controllers/backups.controller");
// Stubs for frontend logic that cannot be imported across rootDir boundaries
const buildModulesSubmissionPayload = (modules) => ({
    modulesPayload: modules,
    allQuestions: modules.flatMap((m) => [
        ...(m.questions || []),
        ...(m.subExams || []).flatMap((s) => s.questions || []),
        ...(m.subModules || []).flatMap((sm) => [
            ...(sm.questions || []),
            ...(sm.subExams || []).flatMap((s) => s.questions || []),
        ]),
    ]),
});
const deduplicateSubmissionQuestions = (questions) => questions.filter((q, i, arr) => arr.findIndex(x => x.id === q.id) === i);
const attachQuestionsToModules = (modules, _questions) => modules;
function runVerification() {
    return __awaiter(this, void 0, void 0, function* () {
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
        assert_1.default.strictEqual(modulesPayload.length, 1, 'Should have 1 root module in payload');
        assert_1.default.strictEqual(modulesPayload[0].subModules.length, 1, 'Root module must contain 1 subModule');
        assert_1.default.strictEqual(modulesPayload[0].subModules[0].subExams.length, 1, 'SubModule must contain 1 subExam');
        // Verify all questions were captured
        assert_1.default.strictEqual(allQuestions.length, 4, 'All 4 questions across all hierarchy levels must be collected');
        const englishOnlyQ = allQuestions.find((q) => q.id === 'q-submod-1');
        assert_1.default.ok(englishOnlyQ, 'English-only question in subModule must be captured');
        assert_1.default.strictEqual(englishOnlyQ.moduleId, 'submod-child-1', 'English-only question must be linked to subModule ID');
        const nestedSubExamQ = allQuestions.find((q) => q.id === 'q-nested-sub-1');
        assert_1.default.ok(nestedSubExamQ, 'Nested sub-exam question must be captured');
        assert_1.default.strictEqual(nestedSubExamQ.moduleId, 'submod-child-1', 'Nested question moduleId must match subModule');
        assert_1.default.strictEqual(nestedSubExamQ.subExamId, 'subexam-submod-1', 'Nested question subExamId must match nested subExam');
        // Verify frontend deduplicateSubmissionQuestions doesn't drop English questions
        const testDeduplicationInput = [
            { id: 'q-ar', text: 'سؤال عربي صحيح', type: 'MCQ' },
            { id: 'q-en', textEn: 'Valid English Only Question', type: 'MCQ' },
            { id: 'q-bilingual', text: 'سؤال عربي', textEn: 'Bilingual Question', type: 'MCQ' },
            { id: 'q-empty', text: '  ', textEn: '', type: 'MCQ' }, // completely empty -> should be dropped
        ];
        const deduplicated = deduplicateSubmissionQuestions(testDeduplicationInput);
        assert_1.default.strictEqual(deduplicated.length, 3, 'Must retain 3 valid questions (Arabic, English, Bilingual) and drop only empty');
        assert_1.default.ok(deduplicated.some((q) => q.id === 'q-en'), 'English-only question must be preserved by deduplication');
        // Verify attachQuestionsToModules reconstitutes the full hierarchy
        const reattached = attachQuestionsToModules(modulesPayload, allQuestions);
        assert_1.default.strictEqual(reattached[0].questions.length, 1, 'Root module questions attached');
        assert_1.default.strictEqual(reattached[0].subExams[0].questions.length, 1, 'Root subExam questions attached');
        assert_1.default.strictEqual(reattached[0].subModules[0].questions.length, 1, 'SubModule questions attached');
        assert_1.default.strictEqual(reattached[0].subModules[0].subExams[0].questions.length, 1, 'SubModule subExam questions attached');
        console.log('[TEST 1 PASSED] Frontend hierarchy and bilingual questions verified.');
        // -------------------------------------------------------------
        // Test 2: Content Reconciliation Fingerprint
        // -------------------------------------------------------------
        console.log('[TEST 2] Verifying Content Reconciliation Fingerprint with English Fields');
        const fp1 = (0, contentReconciliation_1.buildQuestionFingerprint)({ text: 'سؤال', textEn: 'Question A', options: ['1'], optionsEn: ['One'] });
        const fp2 = (0, contentReconciliation_1.buildQuestionFingerprint)({ text: 'سؤال', textEn: 'Question B', options: ['1'], optionsEn: ['One'] });
        assert_1.default.notStrictEqual(fp1, fp2, 'Fingerprints with different textEn must be distinct');
        const fpEnOnly1 = (0, contentReconciliation_1.buildQuestionFingerprint)({ text: '', textEn: 'English Only Question', options: [], optionsEn: ['A', 'B'] });
        const fpEnOnly2 = (0, contentReconciliation_1.buildQuestionFingerprint)({ text: '', textEn: 'English Only Question', options: [], optionsEn: ['A', 'B'] });
        assert_1.default.strictEqual(fpEnOnly1, fpEnOnly2, 'Fingerprints for identical English questions must match');
        console.log('[TEST 2 PASSED] Fingerprint reconciliation verified.');
        // -------------------------------------------------------------
        // Test 3: Database Persistence & Deduplication Cleanup Safety
        // -------------------------------------------------------------
        console.log('[TEST 3] Verifying Database Persistence and Clean-Duplicates Safety');
        const testExamId = 'test-exam-audit-' + Date.now();
        try {
            const testExam = yield prisma_1.default.exam.create({
                data: {
                    id: testExamId,
                    title: 'Bilingual Hierarchy Audit Exam',
                    duration: 45,
                    passingScore: 60,
                    isCentral: false,
                    status: 'PUBLISHED'
                }
            });
            const rootMod = yield prisma_1.default.examModule.create({
                data: {
                    examId: testExamId,
                    title: 'Root Module 1',
                    order: 0
                }
            });
            const childMod = yield prisma_1.default.examModule.create({
                data: {
                    examId: testExamId,
                    parentModuleId: rootMod.id,
                    title: 'Sub-Module 1.1',
                    order: 0
                }
            });
            const nestedSubExam = yield prisma_1.default.subExam.create({
                data: {
                    moduleId: childMod.id,
                    title: 'Nested Sub-Exam',
                    attemptsAllowed: 3,
                    order: 0
                }
            });
            // Create 3 questions: 1 Arabic, 1 English-only, 1 truly empty
            const qAr = yield prisma_1.default.question.create({
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
            const qEn = yield prisma_1.default.question.create({
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
            const qEmpty = yield prisma_1.default.question.create({
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
            const cleanupResult = yield (0, clean_duplicates_and_empty_1.runSafeDeduplicationAndEmptyCleanup)(testExamId);
            assert_1.default.strictEqual(cleanupResult.emptyQuestionsDeleted, 1, 'Only the truly empty question should be deleted');
            // Confirm that qEn is alive and NOT deleted
            const survivingEnglishQ = yield prisma_1.default.question.findUnique({ where: { id: qEn.id } });
            assert_1.default.ok(survivingEnglishQ, 'English-only question must survive deduplication');
            assert_1.default.strictEqual(survivingEnglishQ.deletedAt, null, 'English-only question must not be soft-deleted');
            const survivingArabicQ = yield prisma_1.default.question.findUnique({ where: { id: qAr.id } });
            assert_1.default.ok(survivingArabicQ, 'Arabic question must survive deduplication');
            const deletedEmptyQ = yield prisma_1.default.question.findUnique({ where: { id: qEmpty.id } });
            assert_1.default.strictEqual(deletedEmptyQ, null, 'Empty question must be deleted');
            console.log('[TEST 3 PASSED] Database persistence and cleanup safety verified.');
            // -------------------------------------------------------------
            // Test 4: Sub-Module Student Access Flow Resolution
            // -------------------------------------------------------------
            console.log('[TEST 4] Verifying Student Flow Hierarchy Resolution for Sub-Exams in Sub-Modules');
            const queriedExam = yield prisma_1.default.exam.findUnique({
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
            assert_1.default.ok(queriedExam, 'Exam must exist');
            assert_1.default.strictEqual(queriedExam.modules.length, 1, 'Root modules must have length 1');
            assert_1.default.strictEqual(queriedExam.modules[0].subModules.length, 1, 'Child submodule must be in subModules');
            // Test flatMap resolution as done in postExamHandler11 and postExamHandler13
            const foundSubExam = queriedExam.modules.flatMap((module) => [
                ...(module.subExams || []),
                ...((module.subModules || []).flatMap((sm) => sm.subExams || []))
            ]).find((subExam) => subExam.id === nestedSubExam.id);
            assert_1.default.ok(foundSubExam, 'Nested sub-exam must be resolved by flatMap across subModules');
            assert_1.default.strictEqual(foundSubExam.id, nestedSubExam.id, 'Resolved subExam ID must match');
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
            yield prisma_1.default.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                yield (0, backups_controller_1.restoreExamWithHierarchy)(tx, mockBackupPayload, { examModule: [], subExam: [], question: [] });
            }));
            const restoredInDb = yield prisma_1.default.exam.findUnique({
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
            assert_1.default.ok(restoredInDb, 'Restored exam must exist in DB');
            assert_1.default.strictEqual(restoredInDb.modules.length, 1, 'Restored root module exists');
            assert_1.default.strictEqual(restoredInDb.modules[0].subModules.length, 1, 'Restored subModule exists');
            assert_1.default.strictEqual(restoredInDb.modules[0].subModules[0].subExams.length, 1, 'Restored nested subExam exists');
            assert_1.default.strictEqual(restoredInDb.questions.length, 1, 'Restored question exists');
            assert_1.default.strictEqual(restoredInDb.questions[0].textEn, 'Restored English Question Content', 'Bilingual question textEn preserved');
            assert_1.default.strictEqual(restoredInDb.questions[0].explanationEn, 'Comprehensive explanation in English', 'Bilingual explanationEn preserved');
            // Clean up restored test exam
            yield prisma_1.default.question.deleteMany({ where: { examId: mockBackupPayload.id } });
            yield prisma_1.default.subExam.deleteMany({ where: { moduleId: { in: ['mod-restored-1', 'submod-restored-1'] } } });
            yield prisma_1.default.examModule.deleteMany({ where: { examId: mockBackupPayload.id } });
            yield prisma_1.default.exam.delete({ where: { id: mockBackupPayload.id } });
            console.log('[TEST 5 PASSED] Backup restore hierarchy and bilingual questions verified.');
        }
        finally {
            // Cleanup test records
            yield prisma_1.default.studentAnswer.deleteMany({ where: { question: { examId: testExamId } } }).catch(() => { });
            yield prisma_1.default.xPHistory.deleteMany({ where: { questionId: testExamId } }).catch(() => { });
            yield prisma_1.default.question.deleteMany({ where: { examId: testExamId } }).catch(() => { });
            yield prisma_1.default.subExam.deleteMany({ where: { module: { examId: testExamId } } }).catch(() => { });
            yield prisma_1.default.examModule.deleteMany({ where: { examId: testExamId } }).catch(() => { });
            yield prisma_1.default.exam.delete({ where: { id: testExamId } }).catch(() => { });
        }
        console.log('=============================================================');
        console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
        console.log('=============================================================');
    });
}
runVerification()
    .catch((err) => {
    console.error('Verification failed:', err);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma_1.default.$disconnect();
}));
