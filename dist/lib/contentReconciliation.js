"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickReconciliationCandidate = exports.sortPersistedOrder = exports.comparePersistedOrder = exports.buildLessonFingerprint = exports.buildQuestionFingerprint = exports.canonicalContent = void 0;
const shared_1 = require("../shared");
const parseJsonish = (value) => {
    if (typeof value !== 'string')
        return value;
    const trimmed = value.trim();
    if (!trimmed || !((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}')))) {
        return trimmed.replace(/\r\n/g, '\n');
    }
    try {
        return JSON.parse(trimmed);
    }
    catch (_a) {
        return trimmed.replace(/\r\n/g, '\n');
    }
};
const canonicalize = (value) => {
    const parsed = parseJsonish(value);
    if (parsed instanceof Date)
        return parsed.toISOString();
    if (Array.isArray(parsed))
        return parsed.map(canonicalize);
    if (parsed && typeof parsed === 'object') {
        return Object.keys(parsed)
            .sort()
            .reduce((result, key) => {
            const nested = parsed[key];
            if (nested !== undefined)
                result[key] = canonicalize(nested);
            return result;
        }, {});
    }
    return parsed !== null && parsed !== void 0 ? parsed : null;
};
const canonicalContent = (value) => JSON.stringify(canonicalize(value));
exports.canonicalContent = canonicalContent;
const buildQuestionFingerprint = (question) => {
    var _a, _b, _c, _d, _e;
    return (0, exports.canonicalContent)({
        text: (_a = question === null || question === void 0 ? void 0 : question.text) !== null && _a !== void 0 ? _a : '',
        type: (_b = question === null || question === void 0 ? void 0 : question.type) !== null && _b !== void 0 ? _b : 'MCQ',
        options: (_c = question === null || question === void 0 ? void 0 : question.options) !== null && _c !== void 0 ? _c : [],
        correctAnswer: (_e = (_d = question === null || question === void 0 ? void 0 : question.correctAnswer) !== null && _d !== void 0 ? _d : question === null || question === void 0 ? void 0 : question.correctAnswers) !== null && _e !== void 0 ? _e : '',
    });
};
exports.buildQuestionFingerprint = buildQuestionFingerprint;
const buildLessonFingerprint = (lesson) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    return (0, exports.canonicalContent)({
        title: (_a = lesson === null || lesson === void 0 ? void 0 : lesson.title) !== null && _a !== void 0 ? _a : '',
        domain: (_b = lesson === null || lesson === void 0 ? void 0 : lesson.domain) !== null && _b !== void 0 ? _b : null,
        videoUrl: (_c = lesson === null || lesson === void 0 ? void 0 : lesson.videoUrl) !== null && _c !== void 0 ? _c : null,
        content: (_d = lesson === null || lesson === void 0 ? void 0 : lesson.content) !== null && _d !== void 0 ? _d : null,
        summary: (_e = lesson === null || lesson === void 0 ? void 0 : lesson.summary) !== null && _e !== void 0 ? _e : null,
        notes: (_f = lesson === null || lesson === void 0 ? void 0 : lesson.notes) !== null && _f !== void 0 ? _f : null,
        attachments: (_g = lesson === null || lesson === void 0 ? void 0 : lesson.attachments) !== null && _g !== void 0 ? _g : [],
        slides: (_h = lesson === null || lesson === void 0 ? void 0 : lesson.slides) !== null && _h !== void 0 ? _h : [],
        questions: (_j = lesson === null || lesson === void 0 ? void 0 : lesson.questions) !== null && _j !== void 0 ? _j : [],
        assignments: (_k = lesson === null || lesson === void 0 ? void 0 : lesson.assignments) !== null && _k !== void 0 ? _k : [],
        standards: (_l = lesson === null || lesson === void 0 ? void 0 : lesson.standards) !== null && _l !== void 0 ? _l : null,
        indicators: (_m = lesson === null || lesson === void 0 ? void 0 : lesson.indicators) !== null && _m !== void 0 ? _m : null,
        learningOutcomes: (_o = lesson === null || lesson === void 0 ? void 0 : lesson.learningOutcomes) !== null && _o !== void 0 ? _o : null,
        isVisible: (_p = lesson === null || lesson === void 0 ? void 0 : lesson.isVisible) !== null && _p !== void 0 ? _p : true,
        publishDate: (_q = lesson === null || lesson === void 0 ? void 0 : lesson.publishDate) !== null && _q !== void 0 ? _q : null,
        cutOffDate: (_r = lesson === null || lesson === void 0 ? void 0 : lesson.cutOffDate) !== null && _r !== void 0 ? _r : null,
    });
};
exports.buildLessonFingerprint = buildLessonFingerprint;
const createdAtValue = (value) => {
    if (!value)
        return 0;
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
};
const comparePersistedOrder = (left, right) => {
    var _a, _b;
    const orderDifference = ((_a = left.order) !== null && _a !== void 0 ? _a : 0) - ((_b = right.order) !== null && _b !== void 0 ? _b : 0);
    if (orderDifference !== 0)
        return orderDifference;
    const createdDifference = createdAtValue(left.createdAt) - createdAtValue(right.createdAt);
    if (createdDifference !== 0)
        return createdDifference;
    return left.id.localeCompare(right.id);
};
exports.comparePersistedOrder = comparePersistedOrder;
const sortPersistedOrder = (items) => [...items].sort(exports.comparePersistedOrder);
exports.sortPersistedOrder = sortPersistedOrder;
/**
 * Reconciles an ID-less editor item with a row already persisted by an earlier
 * autosave. IDs explicitly present elsewhere in the incoming payload are
 * reserved first, so inserting a genuinely new item cannot overwrite them.
 *
 * allowOrderFallback is intentionally strict: we only allow an order-based
 * match when the two questions share the same text content. A position match
 * on different content was a root cause of duplicate question creation during
 * rapid successive autosaves.
 */
const extractText = (fingerprint) => {
    try {
        const parsed = JSON.parse(fingerprint);
        return typeof (parsed === null || parsed === void 0 ? void 0 : parsed.text) === 'string' ? parsed.text.trim() : '';
    }
    catch (_a) {
        return '';
    }
};
const pickReconciliationCandidate = (existing, incomingOrder, incomingFingerprint, reservedIds, usedIds, allowOrderFallback = false) => {
    const available = existing.filter((item) => !reservedIds.has(item.id) && !usedIds.has(item.id));
    // 1. Exact fingerprint match (always safe)
    const exactMatch = available.find((item) => item.fingerprint === incomingFingerprint);
    if (exactMatch)
        return exactMatch;
    // 1.5 Match by core signature (handles HTML tag differences, question number prefixes)
    const incomingText = extractText(incomingFingerprint);
    const incomingSig = (0, shared_1.getQuestionCoreSignature)(incomingText);
    if (incomingSig && incomingSig.length >= 5) {
        const sigMatch = available.find((item) => {
            const itemSig = (0, shared_1.getQuestionCoreSignature)(extractText(item.fingerprint));
            return itemSig === incomingSig || (0, shared_1.robustNormalizeText)(extractText(item.fingerprint)) === (0, shared_1.robustNormalizeText)(incomingText);
        });
        if (sigMatch)
            return sigMatch;
    }
    // 2. Order-based fallback — only when the question text core signature matches.
    //    This guards against matching a completely different question that happens
    //    to sit at the same position after an interleaved autosave.
    if (allowOrderFallback && incomingSig && incomingSig.length >= 5) {
        return available.find((item) => {
            var _a;
            return ((_a = item.order) !== null && _a !== void 0 ? _a : 0) === incomingOrder &&
                (0, shared_1.getQuestionCoreSignature)(extractText(item.fingerprint)) === incomingSig;
        });
    }
    return undefined;
};
exports.pickReconciliationCandidate = pickReconciliationCandidate;
