"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attemptPolicy = attemptPolicy;
exports.selectAttempts = selectAttempts;
exports.roundMetric = roundMetric;
exports.ratio = ratio;
exports.passingThreshold = passingThreshold;
exports.attemptPassed = attemptPassed;
exports.csvCell = csvCell;
function attemptPolicy(raw) {
    if (raw === undefined || raw === '')
        return 'latest';
    if (raw === 'first' || raw === 'latest' || raw === 'best')
        return raw;
    throw new Error('Invalid attempt policy');
}
function selectAttempts(rows, policy) {
    var _a, _b;
    const result = new Map();
    for (const row of rows) {
        const key = JSON.stringify([row.userId, row.examId, row.subExamId || null]);
        const previous = result.get(key);
        const time = new Date(row.createdAt).getTime(), previousTime = previous ? new Date(previous.createdAt).getTime() : 0;
        const newer = !previous || time > previousTime || (time === previousTime && row.id > previous.id);
        if (!previous || (policy === 'first' ? !newer : policy === 'latest' ? newer
            : ((_a = row.percentage) !== null && _a !== void 0 ? _a : -1) > ((_b = previous.percentage) !== null && _b !== void 0 ? _b : -1) || (row.percentage === previous.percentage && newer)))
            result.set(key, row);
    }
    return [...result.values()];
}
function roundMetric(value) { return Math.round(value * 10) / 10; }
function ratio(numerator, denominator) { return denominator ? roundMetric(numerator / denominator * 100) : null; }
function passingThreshold(row) {
    var _a, _b, _c, _d, _e, _f, _g;
    return Number((_g = (_e = (_c = (_b = (_a = row.reportSnapshot) === null || _a === void 0 ? void 0 : _a.passingScore) !== null && _b !== void 0 ? _b : row.passingScoreAtSubmission) !== null && _c !== void 0 ? _c : (_d = row.subExam) === null || _d === void 0 ? void 0 : _d.passingScore) !== null && _e !== void 0 ? _e : (_f = row.exam) === null || _f === void 0 ? void 0 : _f.passingScore) !== null && _g !== void 0 ? _g : 50);
}
function attemptPassed(row) {
    var _a, _b, _c, _d, _e;
    if (typeof ((_a = row.reportSnapshot) === null || _a === void 0 ? void 0 : _a.passed) === 'boolean')
        return row.reportSnapshot.passed;
    const total = (_c = (_b = row.reportSnapshot) === null || _b === void 0 ? void 0 : _b.totalQuestions) !== null && _c !== void 0 ? _c : row.totalQuestions;
    const correct = (_e = (_d = row.reportSnapshot) === null || _d === void 0 ? void 0 : _d.correctAnswers) !== null && _e !== void 0 ? _e : row.correctAnswers;
    // Match the existing result page's weighted-score and minimum-correct policy.
    return typeof row.percentage === 'number' && row.percentage >= passingThreshold(row)
        && (typeof total !== 'number' || typeof correct !== 'number' || correct >= Math.ceil(total / 2));
}
function csvCell(value) {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text))
        text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}
