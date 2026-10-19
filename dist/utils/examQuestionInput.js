"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deduplicateExamQuestionInput = deduplicateExamQuestionInput;
const contentReconciliation_1 = require("../lib/contentReconciliation");
/** A draft question can reach the server through more than one editor list. */
function deduplicateExamQuestionInput(questions) {
    const ids = new Set();
    const drafts = new Set();
    return questions.filter(question => {
        var _a, _b, _c, _d;
        if (!question)
            return false;
        const id = question.id === undefined || question.id === null ? '' : String(question.id).trim();
        if (id && ids.has(id))
            return false;
        if (id)
            ids.add(id);
        // Keep separate persisted rows and identical questions in different sections.
        const persisted = id && !/^[\d.]+$/.test(id) && !/^(temp|draft|new)[_-]/i.test(id);
        if (persisted)
            return true;
        const key = JSON.stringify([(_a = question.moduleId) !== null && _a !== void 0 ? _a : null, (_b = question.subExamId) !== null && _b !== void 0 ? _b : null, (0, contentReconciliation_1.buildQuestionFingerprint)(question), (_c = question.imageUrl) !== null && _c !== void 0 ? _c : null, (_d = question.videoUrl) !== null && _d !== void 0 ? _d : null]);
        if (drafts.has(key))
            return false;
        drafts.add(key);
        return true;
    });
}
