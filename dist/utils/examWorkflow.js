"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeStudentProfile = mergeStudentProfile;
exports.countQuestions = countQuestions;
exports.countModuleContent = countModuleContent;
exports.getAvailability = getAvailability;
exports.filterQuestionsForSubExam = filterQuestionsForSubExam;
exports.resolveExamAccessPassword = resolveExamAccessPassword;
function mergeStudentProfile(tokenUser, dbUser) {
    var _a, _b;
    if (!dbUser)
        return tokenUser;
    return Object.assign(Object.assign({}, tokenUser), { grade: (_a = dbUser.grade) !== null && _a !== void 0 ? _a : tokenUser.grade, schoolId: (_b = dbUser.schoolId) !== null && _b !== void 0 ? _b : tokenUser.schoolId });
}
function countQuestions(item) {
    var _a;
    if (!item)
        return 0;
    if (typeof ((_a = item._count) === null || _a === void 0 ? void 0 : _a.questions) === 'number')
        return item._count.questions;
    return Array.isArray(item.questions) ? item.questions.length : 0;
}
function countModuleContent(module) {
    const subExams = Array.isArray(module.subExams) ? module.subExams : [];
    return {
        examsCount: subExams.length,
        // New workflow owns questions on child Exams. Direct Module questions are
        // legacy content and must not inflate totals when child Exams exist.
        questionsCount: subExams.length > 0
            ? subExams.reduce((total, subExam) => total + countQuestions(subExam), 0)
            : countQuestions(module),
    };
}
function getAvailability(entity, now = new Date()) {
    if (entity.publishDate && now < new Date(entity.publishDate))
        return 'UPCOMING';
    if (entity.cutOffDate && now > new Date(entity.cutOffDate))
        return 'EXPIRED';
    return 'AVAILABLE';
}
function filterQuestionsForSubExam(questions, subExamId) {
    if (!subExamId)
        return questions;
    return questions.filter((question) => question.subExamId === subExamId);
}
function resolveExamAccessPassword(exam, selectedSubExam) {
    if (selectedSubExam === null || selectedSubExam === void 0 ? void 0 : selectedSubExam.password)
        return selectedSubExam.password;
    return (exam === null || exam === void 0 ? void 0 : exam.password) || null;
}
