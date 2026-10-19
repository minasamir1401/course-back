"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canManageExam = exports.canViewExam = exports.resolveUserSchoolId = exports.normalizeBackendDok = void 0;
exports.formatCorrectAnswer = formatCorrectAnswer;
exports.formatExplanation = formatExplanation;
const prisma_1 = __importDefault(require("../lib/prisma"));
const examAccessPolicy_1 = require("../utils/examAccessPolicy");
const shared_1 = require("../shared");
const normalizeBackendDok = (raw) => {
    if (!raw)
        return null;
    const s = String(raw).trim();
    if (!s)
        return null;
    const m = s.match(/^(?:dok\s*|level\s*|مستوى\s*)?([1-4])(?:\.0)?$/i);
    if (m)
        return `DOK ${m[1]}`;
    return (0, shared_1.sanitizeHtml)(s);
};
exports.normalizeBackendDok = normalizeBackendDok;
const resolveUserSchoolId = (user) => __awaiter(void 0, void 0, void 0, function* () {
    if (user === null || user === void 0 ? void 0 : user.schoolId)
        return user.schoolId;
    if (user === null || user === void 0 ? void 0 : user.id) {
        try {
            const dbUser = yield prisma_1.default.user.findUnique({
                where: { id: user.id },
                select: { schoolId: true },
            });
            if (dbUser === null || dbUser === void 0 ? void 0 : dbUser.schoolId) {
                user.schoolId = dbUser.schoolId;
                return dbUser.schoolId;
            }
        }
        catch (_a) { }
    }
    return null;
});
exports.resolveUserSchoolId = resolveUserSchoolId;
const canViewExam = (user, exam) => __awaiter(void 0, void 0, void 0, function* () {
    if (!user || !exam)
        return false;
    if (user.role === 'SUPER_ADMIN')
        return true;
    yield (0, exports.resolveUserSchoolId)(user);
    let hasTeacherCourseAccess = false;
    if (user.role === 'TEACHER' && exam.courseId) {
        const teacherCourse = yield prisma_1.default.teacherCourse.findFirst({
            where: {
                teacherId: user.id,
                courseId: exam.courseId,
            },
            select: { id: true },
        });
        hasTeacherCourseAccess = Boolean(teacherCourse);
    }
    return (0, examAccessPolicy_1.canViewExamRecord)(user, exam, hasTeacherCourseAccess);
});
exports.canViewExam = canViewExam;
const canManageExam = (user, exam) => __awaiter(void 0, void 0, void 0, function* () {
    if (!user || !exam)
        return false;
    if (user.role === 'SUPER_ADMIN')
        return true;
    yield (0, exports.resolveUserSchoolId)(user);
    let hasTeacherCourseAccess = false;
    if (user.role === 'TEACHER' && exam.courseId) {
        const teacherCourse = yield prisma_1.default.teacherCourse.findFirst({
            where: {
                teacherId: user.id,
                courseId: exam.courseId,
            },
            select: { id: true },
        });
        hasTeacherCourseAccess = Boolean(teacherCourse);
    }
    return (0, examAccessPolicy_1.canManageExamRecord)(user, exam, hasTeacherCourseAccess);
});
exports.canManageExam = canManageExam;
function formatCorrectAnswer(q) {
    const ans = (Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0)
        ? q.correctAnswers
        : (q.correctAnswer !== undefined && q.correctAnswer !== null && q.correctAnswer !== "" ? q.correctAnswer : q.correctAnswers);
    if (ans === null || ans === undefined)
        return "";
    if (typeof ans === 'string')
        return ans;
    if (Array.isArray(ans) || typeof ans === 'object') {
        return JSON.stringify(ans);
    }
    return String(ans);
}
function formatExplanation(q) {
    if (!q)
        return null;
    // 1. Check structured sections array — takes highest priority
    if (q.sections && Array.isArray(q.sections)) {
        const validSections = q.sections.filter((s) => s && (String(s.content || s.text || '').trim() !== '' ||
            String(s.contentEn || s.textEn || '').trim() !== ''));
        if (validSections.length > 0) {
            const sanitizedValid = validSections.map((s) => (Object.assign(Object.assign({}, s), { content: s.content ? (0, shared_1.sanitizeHtml)(s.content) : s.content, text: s.text ? (0, shared_1.sanitizeHtml)(s.text) : s.text, contentEn: s.contentEn ? (0, shared_1.sanitizeHtml)(s.contentEn) : s.contentEn, textEn: s.textEn ? (0, shared_1.sanitizeHtml)(s.textEn) : s.textEn })));
            return (0, shared_1.extractAndSaveBase64Images)(JSON.stringify(sanitizedValid));
        }
        else {
            // The user edited the question and provided an empty sections array (or all invalid).
            // This means they explicitly deleted the explanation.
            return null;
        }
    }
    // 2. Check explanation field
    if (q.explanation !== undefined && q.explanation !== null) {
        //  SECURITY FIX: Always sanitize HTML regardless of input type.
        // Convert non-strings to string safely before sanitizing.
        const rawExplanation = typeof q.explanation === 'string'
            ? q.explanation
            : JSON.stringify(q.explanation);
        const trimmed = rawExplanation.trim();
        // These are "explicitly empty" values — treat as empty explanation
        if (!trimmed || trimmed === '[]' || trimmed === '""' || trimmed === '[{"type":"EXPLANATION","content":""}]')
            return null;
        // Try parsing as JSON array
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                const valid = parsed.filter((s) => s && (String(s.content || s.text || '').trim() !== '' ||
                    String(s.contentEn || s.textEn || '').trim() !== ''));
                if (valid.length === 0)
                    return null;
                // sanitize each text/content field within array items
                const sanitizedValid = valid.map((s) => (Object.assign(Object.assign({}, s), { content: s.content ? (0, shared_1.sanitizeHtml)(s.content) : s.content, text: s.text ? (0, shared_1.sanitizeHtml)(s.text) : s.text, contentEn: s.contentEn ? (0, shared_1.sanitizeHtml)(s.contentEn) : s.contentEn, textEn: s.textEn ? (0, shared_1.sanitizeHtml)(s.textEn) : s.textEn })));
                return (0, shared_1.extractAndSaveBase64Images)(JSON.stringify(sanitizedValid));
            }
            // parsed is object (not array)
            if (typeof parsed === 'object' && parsed !== null) {
                return (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(trimmed));
            }
        }
        catch (_a) { }
        // Plain string explanation
        return (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(trimmed));
    }
    return null;
}
