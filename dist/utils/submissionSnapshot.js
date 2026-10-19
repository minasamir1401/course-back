"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSubmissionSnapshot = buildSubmissionSnapshot;
exports.snapshotQuestion = snapshotQuestion;
exports.historicalSubmission = historicalSubmission;
const bilingualMetadata_1 = require("./bilingualMetadata");
const node_crypto_1 = require("node:crypto");
const examPassingScore_1 = require("./examPassingScore");
function buildSubmissionSnapshot(exam, child, student, questions, answers, percentage, earnedXP) {
    var _a;
    const passingScore = (0, examPassingScore_1.resolvePassingScore)(exam.passingScore, child === null || child === void 0 ? void 0 : child.passingScore);
    const correctAnswers = answers.filter(answer => answer.isCorrect).length;
    return {
        version: 1, capturedAt: new Date().toISOString(), timeZone: 'Africa/Cairo',
        examTitle: (child === null || child === void 0 ? void 0 : child.title) || exam.title, examType: exam.type, subject: exam.subjects || null,
        schoolId: (student === null || student === void 0 ? void 0 : student.schoolId) || null, schoolName: ((_a = student === null || student === void 0 ? void 0 : student.school) === null || _a === void 0 ? void 0 : _a.name) || null,
        grade: (student === null || student === void 0 ? void 0 : student.grade) || null, classroomId: (student === null || student === void 0 ? void 0 : student.classroomId) || null,
        passingScore, totalPoints: questions.reduce((sum, question) => sum + question.points, 0),
        totalQuestions: questions.length, correctAnswers, earnedXP,
        passed: percentage >= passingScore && correctAnswers >= Math.ceil(questions.length / 2),
    };
}
function snapshotQuestion(question) {
    const keys = ['id', 'text', 'textEn', 'type', 'options', 'optionsEn', 'correctAnswer', 'correctAnswerEn', 'label', 'cognitive', 'errorPattern', 'points', 'xpPoints', 'order',
        'moduleId', 'subExamId', 'explanation', 'explanationEn', 'hint', 'hintEn', 'imageUrl', 'videoUrl',
        'skill', 'standard', 'indicator', 'learningOutcome', 'domain', 'subskill', 'microSkill', 'level', 'dok', 'course', 'section', 'estimatedTime', ...bilingualMetadata_1.QUESTION_METADATA_FIELDS.map(field => `${field}En`)];
    const content = Object.fromEntries(keys.map(key => { var _a; return [key, (_a = question[key]) !== null && _a !== void 0 ? _a : null]; }));
    return Object.assign(Object.assign({}, content), { revision: (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16) });
}
/** A read never regrades or writes a historical submission, including legacy records. */
function historicalSubmission(submission) {
    var _a, _b, _c;
    const snapshot = submission.reportSnapshot || {};
    const answers = (submission.answers || []).map((answer) => (Object.assign(Object.assign({}, answer), { question: (0, bilingualMetadata_1.metadataForDisplay)(answer.questionSnapshot, answer.question) || answer.question })));
    const correctAnswers = (_a = snapshot.correctAnswers) !== null && _a !== void 0 ? _a : answers.filter((answer) => answer.isCorrect).length;
    const totalQuestions = (_b = snapshot.totalQuestions) !== null && _b !== void 0 ? _b : answers.length;
    const currentPoints = answers.reduce((sum, answer) => { var _a; return sum + (Number((_a = answer.question) === null || _a === void 0 ? void 0 : _a.points) || 0); }, 0);
    // Without a frozen denominator, current question points cannot establish a historical total.
    const totalPoints = (_c = snapshot.totalPoints) !== null && _c !== void 0 ? _c : (Number.isFinite(submission.totalScore) ? null : currentPoints);
    const totalScore = Number.isFinite(submission.totalScore) ? submission.totalScore
        : answers.filter((answer) => answer.isCorrect).reduce((sum, answer) => { var _a; return sum + (Number((_a = answer.question) === null || _a === void 0 ? void 0 : _a.points) || 0); }, 0);
    const percentage = Number.isFinite(submission.percentage) ? submission.percentage : currentPoints ? totalScore / currentPoints * 100 : null;
    return { answers, correctAnswers, totalQuestions, totalPoints, totalScore, percentage, historical: Boolean(submission.reportSnapshot) };
}
