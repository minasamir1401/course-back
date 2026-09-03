"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExamErrorLog = buildExamErrorLog;
exports.logExamRequestError = logExamRequestError;
function buildExamErrorLog(event, req, error) {
    var _a, _b, _c;
    const prismaError = error;
    const exception = error instanceof Error ? error : new Error(String(error));
    return {
        timestamp: new Date().toISOString(),
        event,
        request: {
            method: req.method || 'UNKNOWN',
            path: req.originalUrl || req.url || 'UNKNOWN',
            params: req.params || {},
            query: req.query || {},
            userId: ((_a = req.user) === null || _a === void 0 ? void 0 : _a.id) || null,
            role: ((_b = req.user) === null || _b === void 0 ? void 0 : _b.role) || null,
            schoolId: ((_c = req.user) === null || _c === void 0 ? void 0 : _c.schoolId) || null,
        },
        error: {
            name: exception.name,
            message: exception.message,
            code: prismaError.code || null,
            meta: prismaError.meta || null,
            clientVersion: prismaError.clientVersion || null,
            stack: exception.stack || null,
        },
    };
}
function logExamRequestError(event, req, error) {
    console.error('[exam-api-error]', JSON.stringify(buildExamErrorLog(event, req, error)));
}
