"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LESSON_METADATA_FIELDS = exports.QUESTION_METADATA_FIELDS = void 0;
exports.metadataTranslations = metadataTranslations;
exports.metadataForDisplay = metadataForDisplay;
exports.moduleMetadata = moduleMetadata;
exports.QUESTION_METADATA_FIELDS = ['course', 'section', 'domain', 'standard', 'learningOutcome', 'indicator', 'skill', 'subskill', 'microSkill', 'errorPattern'];
exports.LESSON_METADATA_FIELDS = ['domain', 'standards', 'indicators', 'learningOutcomes'];
/** Undefined means omitted, null/empty means intentionally cleared. */
function metadataTranslations(source, sanitize = String, fields = exports.QUESTION_METADATA_FIELDS) {
    return Object.fromEntries(fields.filter(field => (source === null || source === void 0 ? void 0 : source[`${field}En`]) !== undefined).map(field => {
        const value = source[`${field}En`];
        return [`${field}En`, value ? sanitize(String(value)) : null];
    }));
}
/** Enrich only an identical historical label; never substitute a changed skill or score. */
function metadataForDisplay(snapshot, current) {
    if (!snapshot || !current || snapshot === current)
        return snapshot;
    const result = Object.assign({}, snapshot);
    for (const field of exports.QUESTION_METADATA_FIELDS) {
        const value = snapshot[field];
        if (!value || (value !== current[field] && value !== current[`${field}En`]))
            continue;
        result[field] = current[field] || value;
        result[`${field}En`] = snapshot[`${field}En`] || current[`${field}En`] || null;
    }
    return result;
}
function moduleMetadata(source, sanitize = String) {
    return Object.fromEntries(exports.LESSON_METADATA_FIELDS.flatMap(field => [field, `${field}En`]).filter(field => (source === null || source === void 0 ? void 0 : source[field]) !== undefined).map(field => [field, source[field] ? sanitize(String(source[field])) : null]));
}
