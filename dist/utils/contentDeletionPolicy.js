"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removesSavedContent = removesSavedContent;
const items = (value) => {
    if (Array.isArray(value))
        return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : null;
        }
        catch (_a) {
            return null;
        }
    }
    return null;
};
function removesSavedContent(previous, next) {
    const before = items(previous);
    const after = items(next);
    if (!before || next === undefined)
        return false;
    if (!after)
        return before.length > 0;
    if (after.length < before.length)
        return true;
    const identity = (item) => { var _a; return (_a = item === null || item === void 0 ? void 0 : item.id) !== null && _a !== void 0 ? _a : item === null || item === void 0 ? void 0 : item.blockId; };
    const retained = new Set(after.map(identity).filter(id => id != null).map(String));
    return before.some(item => identity(item) != null && !retained.has(String(identity(item))));
}
