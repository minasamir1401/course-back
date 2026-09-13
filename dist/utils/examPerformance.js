"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changedQuestionFields = changedQuestionFields;
exports.changedQuestionOrders = changedQuestionOrders;
exports.calculateSubmissionStats = calculateSubmissionStats;
function changedQuestionFields(existing, incoming) {
    return Object.fromEntries(Object.entries(incoming).filter(([key, value]) => value !== undefined && value !== existing[key]));
}
function changedQuestionOrders(existing, ids) {
    const positions = new Map(existing.map(q => [q.id, q.order]));
    return ids.map((id, order) => ({ id, order })).filter(q => positions.get(q.id) !== q.order);
}
function calculateSubmissionStats(questions, answers, firstAttempt) {
    const byId = new Map(questions.map(q => [q.id, q]));
    const answeredIds = new Set(answers.map(a => a.questionId));
    const relevant = questions.filter(q => answeredIds.has(q.id));
    const ordered = [...answers].sort((a, b) => { var _a, _b, _c, _d; return ((_b = (_a = byId.get(a.questionId)) === null || _a === void 0 ? void 0 : _a.order) !== null && _b !== void 0 ? _b : 0) - ((_d = (_c = byId.get(b.questionId)) === null || _c === void 0 ? void 0 : _c.order) !== null && _d !== void 0 ? _d : 0); });
    let earnedXP = 0, dynamicTotalScore = 0, streak = 0, bonus = 0;
    let hasFive = false, hasTen = false;
    for (const answer of ordered) {
        const question = byId.get(answer.questionId);
        if (!question)
            continue;
        if (answer.isCorrect) {
            streak++;
            dynamicTotalScore += Number(question.points) || 0;
            if (firstAttempt)
                earnedXP += question.xpPoints !== undefined ? Number(question.xpPoints) : 10;
            if (streak === 5 && !hasFive) {
                bonus += 10;
                hasFive = true;
            }
            if (streak === 10 && !hasTen) {
                bonus += 30;
                hasTen = true;
            }
        }
        else
            streak = 0;
    }
    return { earnedXP: earnedXP + (firstAttempt ? bonus : 0), dynamicTotalScore,
        totalPoints: relevant.reduce((sum, q) => sum + (Number(q.points) || 0), 0),
        correctAnswers: answers.filter(a => a.isCorrect).length, totalQuestions: relevant.length };
}
