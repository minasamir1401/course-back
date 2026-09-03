"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExplicitExamDeletions = resolveExplicitExamDeletions;
const uniqueStringIds = (value) => {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.filter((id) => typeof id === 'string' && id.trim().length > 0))];
};
// Collection snapshots can be stale in an autosave request. Deletion must be
// intentional and explicit, never inferred from a missing collection member.
function resolveExplicitExamDeletions(payload) {
    return {
        moduleIds: uniqueStringIds(payload.deletedModuleIds),
        subExamIds: uniqueStringIds(payload.deletedSubExamIds),
    };
}
