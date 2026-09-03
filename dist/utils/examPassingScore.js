"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePassingScore = resolvePassingScore;
function resolvePassingScore(examPassingScore, subExamPassingScore) {
    var _a;
    return (_a = subExamPassingScore !== null && subExamPassingScore !== void 0 ? subExamPassingScore : examPassingScore) !== null && _a !== void 0 ? _a : 50;
}
