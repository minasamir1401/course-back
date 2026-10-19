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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.putExamHandler29 = exports.postExamHandler33 = exports.postExamHandler28 = exports.deleteExamHandler20 = exports.putExamHandler19 = exports.postExamHandler18 = exports.postExamHandler17 = exports.postExamHandler16 = exports.getExamHandler15 = exports.getExamHandler14 = exports.postExamHandler13 = exports.getExamHandler12 = exports.postExamHandler11 = exports.getExamHandler10 = exports.getExamQuestionsHandler = exports.getExamHandler9 = void 0;
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const reporting_service_1 = require("../services/reporting.service");
const prisma_1 = __importDefault(require("../lib/prisma"));
const examWorkflow_1 = require("../utils/examWorkflow");
const examErrorLog_1 = require("../utils/examErrorLog");
const examPassingScore_1 = require("../utils/examPassingScore");
const systemSettings_service_1 = require("../services/systemSettings.service");
const shared_1 = require("../shared");
const examControllerSupport_1 = require("./examControllerSupport");
const submissionSnapshot_1 = require("../utils/submissionSnapshot");
const reportMetrics_1 = require("../utils/reportMetrics");
const getExamHandler9 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const _a = yield (0, reporting_service_1.generateReport)(req.user, Object.assign(Object.assign({}, req.query), { examId: req.params.id })), { exportRows } = _a, report = __rest(_a, ["exportRows"]);
        res.json(Object.assign(Object.assign({}, report), { overall: { totalSubmissions: report.summary.selectedAttempts, uniqueStudents: report.summary.uniqueStudents,
                totalAttempts: report.summary.totalAttempts, passRate: report.summary.passRate, avgScore: report.summary.averageScore }, schools: report.schools.map(school => (Object.assign(Object.assign({}, school), { count: school.uniqueStudents, avgScore: school.averageScore }))) }));
    }
    catch (error) {
        res.status(error instanceof reporting_service_1.ReportError ? error.status : 500).json({ error: error.message || 'Failed to generate analytics' });
    }
});
exports.getExamHandler9 = getExamHandler9;
const getExamQuestionsHandler = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : null;
        const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : null;
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id, deletedAt: null },
            select: {
                id: true,
                isCentral: true,
                schoolId: true,
                grade: true,
                grades: true,
                status: true,
                creatorId: true,
                courseId: true,
                schools: { select: { id: true } }
            }
        });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        const role = req.user.role;
        const isPrivilegedRole = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR', 'STUDENT'].includes(role);
        if (!isPrivilegedRole) {
            return res.status(403).json({ error: 'Access denied (Role: ' + role + ')' });
        }
        if (role === 'STUDENT') {
            const student = yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { grade: true, schoolId: true } });
            if (!student || !(0, shared_1.examMatchesStudent)(exam, (0, examWorkflow_1.mergeStudentProfile)(req.user, student))) {
                return res.status(403).json({ error: 'Access denied (Student)' });
            }
        }
        else if (['SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR'].includes(role)) {
            const canAccessExam = yield (0, examControllerSupport_1.canViewExam)(req.user, exam);
            if (!canAccessExam) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }
        const where = { examId: id, deletedAt: null };
        if (subExamId)
            where.subExamId = subExamId;
        if (moduleId)
            where.moduleId = moduleId;
        const questions = yield prisma_1.default.question.findMany({
            where,
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
        });
        const parsedQuestions = questions.map(q => {
            let options = [];
            try {
                options = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
            }
            catch (e) {
                options = [];
            }
            let optionsEn = null;
            if (q.optionsEn) {
                try {
                    optionsEn = typeof q.optionsEn === 'string' ? JSON.parse(q.optionsEn) : q.optionsEn;
                }
                catch (e) {
                    optionsEn = q.optionsEn;
                }
            }
            let sections = [];
            if (q.explanation) {
                try {
                    const parsed = JSON.parse(q.explanation);
                    if (Array.isArray(parsed)) {
                        sections = role === 'STUDENT' ? parsed.filter((s) => s && s.type === 'HINT') : parsed;
                    }
                }
                catch (_a) { }
            }
            if (role === 'STUDENT') {
                const { correctAnswer, explanation, explanationEn } = q, rest = __rest(q, ["correctAnswer", "explanation", "explanationEn"]);
                return Object.assign(Object.assign({}, rest), { options, optionsEn, sections });
            }
            return Object.assign(Object.assign({}, q), { options, optionsEn, sections });
        });
        res.json({ questions: parsedQuestions });
    }
    catch (error) {
        (0, examErrorLog_1.logExamRequestError)('detail', req, error);
        res.status(500).json({ error: 'Error fetching exam questions' });
    }
});
exports.getExamQuestionsHandler = getExamQuestionsHandler;
const getExamHandler10 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { id } = req.params;
        const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : null;
        const includeQuestions = req.query.includeQuestions !== 'false';
        const onlyQuestions = req.query.onlyQuestions === 'true';
        if (onlyQuestions) {
            return (0, exports.getExamQuestionsHandler)(req, res);
        }
        const queryStartTime = Date.now();
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id, deletedAt: null },
            include: Object.assign({ _count: { select: { questions: { where: { deletedAt: null } } } }, schools: { select: { id: true, name: true } }, modules: {
                    where: { parentModuleId: null },
                    orderBy: { order: 'asc' },
                    include: {
                        parentModule: { select: { id: true, title: true } },
                        subModules: {
                            orderBy: { order: 'asc' },
                            include: {
                                _count: { select: { questions: { where: { deletedAt: null } } } },
                                subExams: {
                                    orderBy: { order: 'asc' },
                                    include: { _count: { select: { questions: { where: { deletedAt: null } } } } }
                                }
                            }
                        },
                        _count: { select: { questions: { where: { deletedAt: null } } } },
                        subExams: {
                            orderBy: { order: 'asc' },
                            include: { _count: { select: { questions: { where: { deletedAt: null } } } } }
                        }
                    }
                } }, (includeQuestions ? {
                questions: {
                    where: subExamId ? { subExamId, deletedAt: null } : { deletedAt: null },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                }
            } : {}))
        });
        const queryDuration = Date.now() - queryStartTime;
        if (queryDuration > 1000) {
            console.log(`[Exam GET] Exam "${(exam === null || exam === void 0 ? void 0 : exam.title) || id}" query took ${queryDuration}ms (${includeQuestions ? (((_a = exam === null || exam === void 0 ? void 0 : exam.questions) === null || _a === void 0 ? void 0 : _a.length) || 0) : 0} questions)`);
        }
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        const role = req.user.role;
        const userId = req.user.id;
        const isPrivilegedRole = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR', 'STUDENT'].includes(role);
        if (!isPrivilegedRole) {
            return res.status(403).json({ error: 'Access denied (Role: ' + role + ')' });
        }
        if (role === 'STUDENT') {
            const accessUser = (0, examWorkflow_1.mergeStudentProfile)(req.user, yield prisma_1.default.user.findUnique({ where: { id: userId }, select: { grade: true, schoolId: true } }));
            if (!(0, shared_1.examMatchesStudent)(exam, accessUser)) {
                return res.status(403).json({ error: 'Access denied (Student)' });
            }
        }
        else if (['SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR'].includes(role)) {
            const canAccessExam = yield (0, examControllerSupport_1.canViewExam)(req.user, exam);
            if (!canAccessExam) {
                return res.status(403).json({ error: 'Access denied (Role: ' + role + ', isCentral: ' + exam.isCentral + ')' });
            }
        }
        const selectedSubExam = subExamId
            ? exam.modules.flatMap((module) => [
                ...(module.subExams || []),
                ...((module.subModules || []).flatMap((sm) => sm.subExams || []))
            ]).find((subExam) => subExam.id === subExamId)
            : null;
        if (subExamId && !selectedSubExam)
            return res.status(404).json({ error: 'Exam section not found' });
        let parsedQuestions = [];
        if (includeQuestions && Array.isArray(exam.questions)) {
            parsedQuestions = exam.questions.map((q) => {
                let options = [];
                try {
                    options = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
                }
                catch (e) {
                    options = [];
                }
                let optionsEn = null;
                if (q.optionsEn) {
                    try {
                        optionsEn = typeof q.optionsEn === 'string' ? JSON.parse(q.optionsEn) : q.optionsEn;
                    }
                    catch (e) {
                        optionsEn = q.optionsEn;
                    }
                }
                let sections = [];
                if (q.explanation) {
                    try {
                        const parsed = JSON.parse(q.explanation);
                        if (Array.isArray(parsed)) {
                            sections = role === 'STUDENT' ? parsed.filter((s) => s && s.type === 'HINT') : parsed;
                        }
                    }
                    catch (_a) { }
                }
                if (role === 'STUDENT') {
                    const { correctAnswer, explanation, explanationEn } = q, rest = __rest(q, ["correctAnswer", "explanation", "explanationEn"]);
                    return Object.assign(Object.assign({}, rest), { options, optionsEn, sections });
                }
                return Object.assign(Object.assign({}, q), { options, optionsEn, sections });
            });
        }
        // Attach questionsCount to modules, subModules, and subExams for instant frontend display
        const enrichedModules = (exam.modules || []).map((module) => {
            var _a;
            return (Object.assign(Object.assign({}, module), { questionsCount: ((_a = module._count) === null || _a === void 0 ? void 0 : _a.questions) || 0, subModules: (module.subModules || []).map((sm) => {
                    var _a;
                    return (Object.assign(Object.assign({}, sm), { questionsCount: ((_a = sm._count) === null || _a === void 0 ? void 0 : _a.questions) || 0, subExams: (sm.subExams || []).map((subExam) => {
                            var _a;
                            return (Object.assign(Object.assign({}, subExam), { questionsCount: ((_a = subExam._count) === null || _a === void 0 ? void 0 : _a.questions) || 0, questions: subExam.questions || [] }));
                        }) }));
                }), subExams: (module.subExams || []).map((subExam) => {
                    var _a;
                    return (Object.assign(Object.assign({}, subExam), { questionsCount: ((_a = subExam._count) === null || _a === void 0 ? void 0 : _a.questions) || 0, questions: subExam.questions || [] }));
                }) }));
        });
        // If student, hide correct answers
        const activePassword = (0, examWorkflow_1.resolveExamAccessPassword)(exam, selectedSubExam);
        if (req.user.role === 'STUDENT') {
            const sanitizedQuestions = parsedQuestions.map(q => {
                const { correctAnswer, explanation, explanationEn } = q, rest = __rest(q, ["correctAnswer", "explanation", "explanationEn"]);
                return rest;
            });
            return res.json(Object.assign(Object.assign({}, (0, shared_1.sanitizeExam)(exam)), { questionsCount: (_c = (_b = exam._count) === null || _b === void 0 ? void 0 : _b.questions) !== null && _c !== void 0 ? _c : parsedQuestions.length, 
                // Only the current student's attempt identities; never expose answers or other students.
                submissions: !includeQuestions ? yield prisma_1.default.examSubmission.findMany({
                    where: { examId: id, userId },
                    select: { id: true, subExamId: true, createdAt: true },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
                }) : undefined, modules: enrichedModules, selectedSubExam, password: activePassword ? true : null, questions: sanitizedQuestions }));
        }
        res.json(Object.assign(Object.assign({}, (0, shared_1.sanitizeExam)(exam)), { modules: enrichedModules, selectedSubExam, password: activePassword, questions: parsedQuestions }));
    }
    catch (error) {
        (0, examErrorLog_1.logExamRequestError)('detail', req, error);
        res.status(500).json({ error: 'Error fetching exam details' });
    }
});
exports.getExamHandler10 = getExamHandler10;
const postExamHandler11 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id: examId } = req.params;
        const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : (((_a = req.body) === null || _a === void 0 ? void 0 : _a.subExamId) || null);
        const { password } = req.body;
        const userId = req.user.id;
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id: examId },
            include: {
                schools: { select: { id: true } },
                modules: {
                    include: {
                        subExams: true,
                        subModules: {
                            include: { subExams: true }
                        }
                    }
                },
                _count: {
                    select: { submissions: { where: { userId } } }
                }
            }
        });
        if (!exam)
            return res.status(404).json({ error: 'الامتحان غير موجود' });
        const selectedSubExam = subExamId
            ? exam.modules.flatMap((module) => [
                ...(module.subExams || []),
                ...((module.subModules || []).flatMap((sm) => sm.subExams || []))
            ]).find((subExam) => subExam.id === subExamId)
            : null;
        if (subExamId && !selectedSubExam)
            return res.status(404).json({ error: 'الاختبار غير موجود داخل هذا الموديول.' });
        const accessUser = req.user.role === 'STUDENT'
            ? (0, examWorkflow_1.mergeStudentProfile)(req.user, yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { grade: true, schoolId: true } }))
            : req.user;
        if (req.user.role === 'STUDENT' && !(0, shared_1.examMatchesStudent)(exam, accessUser)) {
            return res.status(403).json({ error: 'This exam is not assigned to you.', type: 'ACCESS_DENIED' });
        }
        // 1. Check Dates (skip for admins and teachers testing)
        const isAdminOrTeacher = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR'].includes(req.user.role);
        const now = new Date();
        if (!isAdminOrTeacher && exam.startDate && now < new Date(exam.startDate)) {
            return res.status(403).json({ error: 'The exam has not started yet.', type: 'EARLY_ACCESS' });
        }
        if (!isAdminOrTeacher && exam.endDate && now > new Date(exam.endDate)) {
            return res.status(403).json({ error: 'The exam has expired.', type: 'EXPIRED' });
        }
        if (!isAdminOrTeacher && selectedSubExam && (0, examWorkflow_1.getAvailability)(selectedSubExam, now) !== 'AVAILABLE') {
            return res.status(403).json({ error: (0, examWorkflow_1.getAvailability)(selectedSubExam, now) === 'UPCOMING' ? 'This exam has not started yet.' : 'This exam has expired.', type: (0, examWorkflow_1.getAvailability)(selectedSubExam, now) });
        }
        // 2. Check Attempts (999 means unlimited)
        const submissionCount = yield prisma_1.default.examSubmission.count({ where: Object.assign({ examId, userId }, (subExamId ? { subExamId } : {})) });
        const attemptsAllowed = (_b = selectedSubExam === null || selectedSubExam === void 0 ? void 0 : selectedSubExam.attemptsAllowed) !== null && _b !== void 0 ? _b : exam.attemptsAllowed;
        if (!isAdminOrTeacher && attemptsAllowed !== 999 && submissionCount >= attemptsAllowed) {
            return res.status(403).json({ error: 'You have reached the maximum number of attempts allowed for this exam.', type: 'ATTEMPTS_EXCEEDED' });
        }
        // 3. Check Password
        const requiredPassword = (0, examWorkflow_1.resolveExamAccessPassword)(exam, selectedSubExam);
        if (!isAdminOrTeacher && requiredPassword && requiredPassword !== password) {
            return res.status(403).json({ error: 'Incorrect password.', type: 'INVALID_PASSWORD' });
        }
        res.json({ success: true, message: 'Access verified successfully.' });
    }
    catch (error) {
        res.status(500).json({ error: 'Error verifying access.' });
    }
});
exports.postExamHandler11 = postExamHandler11;
const getExamHandler12 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { id: examId } = req.params;
        const userId = req.user.id;
        const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : null;
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id: examId },
            select: {
                attemptsAllowed: true,
                isCentral: true,
                schoolId: true,
                schools: { select: { id: true } },
                grade: true,
                grades: true,
                status: true,
                deletedAt: true,
                modules: {
                    select: {
                        subExams: { where: subExamId ? { id: subExamId } : undefined, select: { attemptsAllowed: true } },
                        subModules: {
                            select: {
                                subExams: { where: subExamId ? { id: subExamId } : undefined, select: { attemptsAllowed: true } }
                            }
                        }
                    }
                }
            }
        });
        if (!exam || exam.deletedAt)
            return res.status(404).json({ error: 'Exam not found' });
        if (req.user.role === 'STUDENT') {
            const student = yield prisma_1.default.user.findUnique({ where: { id: userId }, select: { grade: true, schoolId: true } });
            if (!student || !(0, shared_1.examMatchesStudent)(exam, (0, examWorkflow_1.mergeStudentProfile)(req.user, student))) {
                return res.status(403).json({ error: 'Access denied (Student)' });
            }
        }
        const submissionCount = yield prisma_1.default.examSubmission.count({
            where: Object.assign({ examId, userId }, (subExamId ? { subExamId } : {}))
        });
        const lastSubmission = yield prisma_1.default.examSubmission.findFirst({
            where: Object.assign({ examId, userId }, (subExamId ? { subExamId } : {})),
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        const allMatchingSubExams = (exam === null || exam === void 0 ? void 0 : exam.modules) ? exam.modules.flatMap((module) => [
            ...(module.subExams || []),
            ...((module.subModules || []).flatMap((sm) => sm.subExams || []))
        ]) : [];
        const selectedAttemptsAllowed = (_a = allMatchingSubExams[0]) === null || _a === void 0 ? void 0 : _a.attemptsAllowed;
        res.json({
            taken: submissionCount > 0,
            submissionId: lastSubmission === null || lastSubmission === void 0 ? void 0 : lastSubmission.id,
            attemptsUsed: submissionCount,
            attemptsAllowed: (_b = selectedAttemptsAllowed !== null && selectedAttemptsAllowed !== void 0 ? selectedAttemptsAllowed : exam === null || exam === void 0 ? void 0 : exam.attemptsAllowed) !== null && _b !== void 0 ? _b : 1,
            canTakeAgain: submissionCount < ((_c = selectedAttemptsAllowed !== null && selectedAttemptsAllowed !== void 0 ? selectedAttemptsAllowed : exam === null || exam === void 0 ? void 0 : exam.attemptsAllowed) !== null && _c !== void 0 ? _c : 1)
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Error checking exam status' });
    }
});
exports.getExamHandler12 = getExamHandler12;
const postExamHandler13 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { id: examId } = req.params;
    const userId = req.user.id;
    const { subExamId = null } = req.body || {};
    const lockKey = `submit_exam_${userId}_${examId}_${subExamId || 'root'}`;
    if (!(0, shared_1.acquireLock)(lockKey)) {
        return res.status(429).json({ error: 'Submitting exam... please wait.' });
    }
    try {
        const { answers, totalTime, password } = req.body; // Array of { questionId, selectedAnswer }, totalTime in seconds
        if (!Array.isArray(answers)) {
            (0, shared_1.releaseLock)(lockKey);
            return res.status(400).json({ error: 'answers array is required.' });
        }
        // Check attempts limit
        const submissionCount = yield prisma_1.default.examSubmission.count({
            where: Object.assign({ examId, userId }, (subExamId ? { subExamId } : {}))
        });
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id: examId },
            select: {
                id: true, title: true, type: true, subjects: true, passingScore: true, attemptsAllowed: true, isCentral: true, schoolId: true,
                startDate: true, endDate: true, resultVisibility: true, password: true,
                grade: true, grades: true,
                schools: { select: { id: true } },
                modules: {
                    include: {
                        subExams: true,
                        subModules: {
                            include: { subExams: true }
                        }
                    }
                },
                questions: {
                    where: Object.assign({ deletedAt: null }, (subExamId ? { subExamId } : {})),
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                }
            }
        });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        const selectedSubExam = subExamId
            ? exam.modules.flatMap((module) => [
                ...(module.subExams || []),
                ...((module.subModules || []).flatMap((sm) => sm.subExams || []))
            ]).find((subExam) => subExam.id === subExamId)
            : null;
        if (subExamId && !selectedSubExam)
            return res.status(404).json({ error: 'Exam section not found' });
        const accessUser = req.user.role === 'STUDENT'
            ? (0, examWorkflow_1.mergeStudentProfile)(req.user, yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { grade: true, schoolId: true } }))
            : req.user;
        if (req.user.role === 'STUDENT' && !(0, shared_1.examMatchesStudent)(exam, accessUser)) {
            return res.status(403).json({ error: 'This exam is not assigned to you.' });
        }
        const isAdminOrTeacher = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(req.user.role);
        const attemptsAllowed = (_a = selectedSubExam === null || selectedSubExam === void 0 ? void 0 : selectedSubExam.attemptsAllowed) !== null && _a !== void 0 ? _a : exam.attemptsAllowed;
        if (!isAdminOrTeacher && attemptsAllowed !== 999 && submissionCount >= attemptsAllowed) {
            return res.status(400).json({ error: 'You have reached the maximum number of attempts allowed for this exam.' });
        }
        // Check dates again on submission (skip for admins and teachers testing)
        const now = new Date();
        if (!isAdminOrTeacher && exam.startDate && now < new Date(exam.startDate)) {
            return res.status(403).json({ error: 'The exam has not started yet.' });
        }
        if (!isAdminOrTeacher && exam.endDate && now > new Date(exam.endDate)) {
            return res.status(403).json({ error: 'The exam has expired.' });
        }
        if (!isAdminOrTeacher && selectedSubExam && (0, examWorkflow_1.getAvailability)(selectedSubExam, now) !== 'AVAILABLE') {
            return res.status(403).json({ error: (0, examWorkflow_1.getAvailability)(selectedSubExam, now) === 'UPCOMING' ? 'This exam has not started yet.' : 'This exam has expired.' });
        }
        const requiredPassword = (0, examWorkflow_1.resolveExamAccessPassword)(exam, selectedSubExam);
        if (requiredPassword && requiredPassword !== password) {
            return res.status(403).json({ error: 'Incorrect password.' });
        }
        exam.questions = subExamId ? exam.questions.filter((question) => question.subExamId === subExamId) : exam.questions;
        if (exam.questions.length === 0) {
            return res.status(400).json({ error: 'Cannot submit an exam without questions.' });
        }
        let totalScore = 0;
        let maxPossibleScore = 0;
        const studentAnswersData = [];
        const submittedAnswerMap = new Map();
        for (const answer of answers)
            if (!submittedAnswerMap.has(answer.questionId))
                submittedAnswerMap.set(answer.questionId, answer);
        exam.questions.forEach(q => {
            maxPossibleScore += q.points;
            const studentAnswer = submittedAnswerMap.get(q.id);
            const selectedAnswer = studentAnswer === null || studentAnswer === void 0 ? void 0 : studentAnswer.selectedAnswer;
            const isCorrect = (0, shared_1.isAnswerCorrect)(q, selectedAnswer);
            if (isCorrect)
                totalScore += q.points;
            studentAnswersData.push({
                userId,
                questionId: q.id,
                selectedAnswer: Array.isArray(selectedAnswer) ? JSON.stringify(selectedAnswer) : (selectedAnswer || ''),
                isCorrect
            });
        });
        if (maxPossibleScore <= 0) {
            return res.status(400).json({ error: 'Cannot grade an exam without points.' });
        }
        const percentage = (totalScore / maxPossibleScore) * 100;
        // Gamification System calculation
        const isFirstExamAttempt = submissionCount === 0;
        let regularXP = 0;
        // Sort questions by order to ensure streak is computed in order
        const sortedQuestions = [...exam.questions].sort((a, b) => { var _a, _b; return ((_a = a.order) !== null && _a !== void 0 ? _a : 0) - ((_b = b.order) !== null && _b !== void 0 ? _b : 0); });
        let hasStreak5 = false;
        let hasStreak10 = false;
        let tempStreak = 0;
        let maxStreak = 0;
        const gradedAnswerMap = new Map(studentAnswersData.map(answer => [answer.questionId, answer]));
        sortedQuestions.forEach(q => {
            const sa = gradedAnswerMap.get(q.id);
            const isCorrect = (sa === null || sa === void 0 ? void 0 : sa.isCorrect) || false;
            if (isCorrect) {
                tempStreak++;
                if (tempStreak > maxStreak)
                    maxStreak = tempStreak;
                if (tempStreak === 5)
                    hasStreak5 = true;
                if (tempStreak === 10)
                    hasStreak10 = true;
                if (isFirstExamAttempt) {
                    regularXP += q.xpPoints !== undefined ? Number(q.xpPoints) : 10;
                }
            }
            else {
                tempStreak = 0;
            }
        });
        const bonusXP = isFirstExamAttempt ? ((hasStreak5 ? 10 : 0) + (hasStreak10 ? 30 : 0)) : 0;
        const totalXPToAward = regularXP + bonusXP;
        const studentContext = yield prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { schoolId: true, grade: true, classroomId: true, school: { select: { name: true } } },
        });
        const reportSnapshot = (0, submissionSnapshot_1.buildSubmissionSnapshot)(exam, selectedSubExam, studentContext, exam.questions, studentAnswersData, percentage, totalXPToAward);
        const questionSnapshots = new Map(exam.questions.map(question => [question.id, (0, submissionSnapshot_1.snapshotQuestion)(question)]));
        const submission = yield prisma_1.default.examSubmission.create({
            data: {
                examId,
                subExamId,
                userId,
                totalScore,
                percentage,
                totalTime: totalTime != null && totalTime !== '' && Number.isFinite(Number(totalTime)) ? Math.max(0, Math.min(Math.floor(Number(totalTime)), 86400)) : null,
                reportSnapshot,
                schoolIdAtSubmission: (studentContext === null || studentContext === void 0 ? void 0 : studentContext.schoolId) || null,
                gradeAtSubmission: (studentContext === null || studentContext === void 0 ? void 0 : studentContext.grade) || null,
                answers: {
                    create: studentAnswersData.map(a => ({
                        userId,
                        questionId: a.questionId,
                        selectedAnswer: a.selectedAnswer,
                        isCorrect: a.isCorrect,
                        questionSnapshot: questionSnapshots.get(a.questionId)
                    }))
                }
            },
            include: (exam.resultVisibility === 'SHOW_ANSWERS' || exam.resultVisibility === 'SHOW_ALL')
                ? { answers: { include: { question: true } } } : undefined
        });
        // Save XPHistory log entries in bulk
        const xpHistoryData = exam.questions.map(q => {
            const sa = gradedAnswerMap.get(q.id);
            const isCorrect = (sa === null || sa === void 0 ? void 0 : sa.isCorrect) || false;
            const earnedXP = (isFirstExamAttempt && isCorrect) ? (q.xpPoints !== undefined ? Number(q.xpPoints) : 10) : 0;
            return {
                userId,
                xp: earnedXP,
                sourceType: 'EXAM',
                sourceId: examId,
                questionId: q.id,
                isCorrect,
                attemptNum: submissionCount + 1,
                isBonus: false
            };
        });
        if (xpHistoryData.length > 0) {
            yield prisma_1.default.xPHistory.createMany({
                data: xpHistoryData
            });
        }
        // Save streak bonuses
        if (isFirstExamAttempt) {
            if (hasStreak5) {
                yield prisma_1.default.xPHistory.create({
                    data: {
                        userId,
                        xp: 10,
                        sourceType: 'EXAM',
                        sourceId: examId,
                        questionId: 'streak_5',
                        isCorrect: true,
                        attemptNum: 1,
                        isBonus: true
                    }
                });
            }
            if (hasStreak10) {
                yield prisma_1.default.xPHistory.create({
                    data: {
                        userId,
                        xp: 30,
                        sourceType: 'EXAM',
                        sourceId: examId,
                        questionId: 'streak_10',
                        isCorrect: true,
                        attemptNum: 1,
                        isBonus: true
                    }
                });
            }
            if (totalXPToAward > 0) {
                yield prisma_1.default.user.update({
                    where: { id: userId },
                    data: { xp: { increment: totalXPToAward } }
                });
            }
        }
        // Invalidate student stats cache
        yield (0, shared_1.invalidateCache)(`student_stats_${userId}`);
        res.json(Object.assign(Object.assign({ message: 'Exam submitted successfully', submissionId: submission.id }, (exam.resultVisibility === 'HIDE_ALL' ? {} : { score: totalScore, percentage })), { earnedXP: regularXP, bonusXP, currentStreak: isFirstExamAttempt ? maxStreak : 0, resultVisibility: exam.resultVisibility, details: (exam.resultVisibility === 'SHOW_ANSWERS' || exam.resultVisibility === 'SHOW_ALL') ? submission.answers : null }));
    }
    catch (error) {
        console.error(' Submission error:', error);
        res.status(500).json({ error: 'Error submitting exam', details: error.message });
    }
    finally {
        (0, shared_1.releaseLock)(lockKey);
    }
});
exports.postExamHandler13 = postExamHandler13;
const getExamHandler14 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const { id } = req.params;
        const submission = yield prisma_1.default.examSubmission.findUnique({
            where: { id },
            include: {
                exam: true,
                user: { select: { name: true, role: true, schoolId: true } },
                answers: {
                    include: { question: true }
                }
            }
        });
        if (!submission)
            return res.status(404).json({ error: 'Submission not found' });
        let subExamDetails = null;
        if (submission.subExamId) {
            subExamDetails = yield prisma_1.default.subExam.findUnique({
                where: { id: submission.subExamId }
            });
        }
        if (subExamDetails && submission.reportSnapshot) {
            const saved = submission.reportSnapshot;
            subExamDetails = Object.assign(Object.assign({}, subExamDetails), { title: saved.examTitle || subExamDetails.title, passingScore: (_a = saved.passingScore) !== null && _a !== void 0 ? _a : subExamDetails.passingScore });
        }
        // Authorization check
        const role = req.user.role;
        if (!['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR', 'STUDENT'].includes(role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (role === 'STUDENT' && submission.userId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (role === 'SCHOOL_ADMIN' && (submission.schoolIdAtSubmission || submission.user.schoolId) !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if ((role === 'TEACHER' || role === 'SUPERVISOR') && (submission.schoolIdAtSubmission || submission.user.schoolId) !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const history = (0, submissionSnapshot_1.historicalSubmission)(submission);
        const gradedAnswers = history.answers.map((ans) => {
            var _a, _b;
            const parseOptions = (value) => { try {
                return typeof value === 'string' ? JSON.parse(value) : value || [];
            }
            catch (_a) {
                return [];
            } };
            return Object.assign(Object.assign({}, ans), { question: Object.assign(Object.assign({}, ans.question), { options: parseOptions((_a = ans.question) === null || _a === void 0 ? void 0 : _a.options), optionsEn: parseOptions((_b = ans.question) === null || _b === void 0 ? void 0 : _b.optionsEn) }) });
        });
        const submissionXpStats = Object.assign(Object.assign({}, history), { dynamicTotalScore: history.totalScore, earnedXP: (_c = (_b = submission.reportSnapshot) === null || _b === void 0 ? void 0 : _b.earnedXP) !== null && _c !== void 0 ? _c : null });
        const dynamicPercentage = history.percentage;
        submission.exam.passingScore = (_e = (_d = submission.reportSnapshot) === null || _d === void 0 ? void 0 : _d.passingScore) !== null && _e !== void 0 ? _e : (0, examPassingScore_1.resolvePassingScore)(submission.exam.passingScore, subExamDetails === null || subExamDetails === void 0 ? void 0 : subExamDetails.passingScore);
        submission.exam.title = ((_f = submission.reportSnapshot) === null || _f === void 0 ? void 0 : _f.examTitle) || (subExamDetails === null || subExamDetails === void 0 ? void 0 : subExamDetails.title) || submission.exam.title;
        const passed = (0, reportMetrics_1.attemptPassed)(Object.assign(Object.assign({}, submission), { percentage: dynamicPercentage, correctAnswers: history.correctAnswers, totalQuestions: history.totalQuestions }));
        // Apply Result Policy for Students
        if (req.user.role === 'STUDENT') {
            const policy = submission.exam.resultVisibility;
            // Result metadata must never disclose access passwords.
            if (subExamDetails) {
                const { password: _password } = subExamDetails, safeChild = __rest(subExamDetails, ["password"]);
                subExamDetails = safeChild;
            }
            if (policy === 'HIDE_ALL') {
                return res.json({
                    id: submission.id,
                    createdAt: submission.createdAt,
                    exam: { title: (subExamDetails === null || subExamDetails === void 0 ? void 0 : subExamDetails.title) || submission.exam.title, skill: submission.exam.skill, level: submission.exam.level },
                    subExam: subExamDetails,
                    message: 'Results will be revealed later',
                    policy: 'HIDE_ALL'
                });
            }
            const sanitizedAnswers = gradedAnswers.map((ans) => {
                const baseAnswer = {
                    id: ans.id,
                    selectedAnswer: ans.selectedAnswer,
                    isCorrect: ans.isCorrect,
                    question: Object.assign(Object.assign({ id: ans.question.id, text: ans.question.text, textEn: ans.question.textEn || null, type: ans.question.type, label: ans.question.label || null, imageUrl: ans.question.imageUrl || null }, (0, bilingualMetadata_1.metadataTranslations)(ans.question)), { domain: ans.question.domain || null, standard: ans.question.standard || null, indicator: ans.question.indicator || null, learningOutcome: ans.question.learningOutcome || null, skill: ans.question.skill || null, subskill: ans.question.subskill || null, microSkill: ans.question.microSkill || null, dok: ans.question.dok || null, level: ans.question.level || null, cognitive: ans.question.cognitive || null, errorPattern: ans.question.errorPattern || null, options: ans.question.options, optionsEn: ans.question.optionsEn, points: ans.question.points, explanation: (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') ? ans.question.explanation : null, explanationEn: (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') ? (ans.question.explanationEn || null) : null })
                };
                if (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') {
                    return Object.assign(Object.assign({}, baseAnswer), { question: Object.assign(Object.assign({}, baseAnswer.question), { correctAnswer: ans.question.correctAnswer, correctAnswerEn: ans.question.correctAnswerEn || null }) });
                }
                if (policy === 'SHOW_MARK_ONLY') {
                    return baseAnswer;
                }
                return { id: ans.id };
            });
            const safeExam = Object.assign({}, submission.exam);
            safeExam.totalPoints = submissionXpStats.totalPoints;
            if (subExamDetails) {
                safeExam.title = ((_g = submission.reportSnapshot) === null || _g === void 0 ? void 0 : _g.examTitle) || subExamDetails.title || safeExam.title;
                safeExam.passingScore = (_j = (_h = submission.reportSnapshot) === null || _h === void 0 ? void 0 : _h.passingScore) !== null && _j !== void 0 ? _j : (0, examPassingScore_1.resolvePassingScore)(safeExam.passingScore, subExamDetails.passingScore);
                safeExam.duration = subExamDetails.duration;
            }
            delete safeExam.questions;
            delete safeExam.password;
            return res.json(Object.assign(Object.assign({}, submission), { historicalSnapshot: Boolean(submission.reportSnapshot), passed, totalScore: submissionXpStats.dynamicTotalScore, percentage: dynamicPercentage, exam: safeExam, subExam: subExamDetails, answers: policy === 'SHOW_SCORE' ? [] : sanitizedAnswers, earnedXP: submissionXpStats.earnedXP, correctAnswers: submissionXpStats.correctAnswers, totalQuestions: submissionXpStats.totalQuestions }));
        }
        // Admins see everything
        if (subExamDetails) {
            submission.exam.title = ((_k = submission.reportSnapshot) === null || _k === void 0 ? void 0 : _k.examTitle) || subExamDetails.title || submission.exam.title;
            submission.exam.passingScore = (_m = (_l = submission.reportSnapshot) === null || _l === void 0 ? void 0 : _l.passingScore) !== null && _m !== void 0 ? _m : (0, examPassingScore_1.resolvePassingScore)(submission.exam.passingScore, subExamDetails.passingScore);
            submission.exam.duration = subExamDetails.duration;
        }
        submission.exam.totalPoints = submissionXpStats.totalPoints;
        res.json(Object.assign(Object.assign({}, submission), { subExam: subExamDetails, historicalSnapshot: Boolean(submission.reportSnapshot), passed, totalScore: submissionXpStats.dynamicTotalScore, percentage: dynamicPercentage, answers: gradedAnswers, earnedXP: submissionXpStats.earnedXP, correctAnswers: submissionXpStats.correctAnswers, totalQuestions: submissionXpStats.totalQuestions }));
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching submission' });
    }
});
exports.getExamHandler14 = getExamHandler14;
const getExamHandler15 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: { schools: { select: { id: true } } }
        });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield (0, examControllerSupport_1.canViewExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const where = { examId: id, user: { role: 'STUDENT', deletedAt: null } };
        if (req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'TEACHER') {
            where.user.schoolId = req.user.schoolId;
        }
        const submissions = yield prisma_1.default.examSubmission.findMany({
            where,
            include: {
                user: {
                    select: {
                        name: true,
                        username: true,
                        schoolId: true,
                        school: { select: { name: true } }
                    }
                },
                exam: { select: { title: true, type: true, passingScore: true } },
                answers: { select: { isCorrect: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        res.json(submissions.map((_a) => {
            var { answers } = _a, submission = __rest(_a, ["answers"]);
            return (Object.assign(Object.assign({}, submission), { correctAnswers: answers.filter((answer) => answer.isCorrect).length, totalQuestions: answers.length }));
        }));
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching submissions' });
    }
});
exports.getExamHandler15 = getExamHandler15;
const postExamHandler16 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const exam = yield prisma_1.default.exam.update({
            where: { id },
            data: { deletedAt: null }
        });
        res.json({ message: 'Exam restored successfully', exam });
    }
    catch (error) {
        console.error(' Restore exam error:', error);
        res.status(500).json({ error: 'Error restoring exam' });
    }
});
exports.postExamHandler16 = postExamHandler16;
const postExamHandler17 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const question = yield prisma_1.default.question.update({
            where: { id },
            data: { deletedAt: null }
        });
        res.json({ message: 'Question restored successfully', question });
    }
    catch (error) {
        console.error(' Restore question error:', error);
        res.status(500).json({ error: 'Error restoring question' });
    }
});
exports.postExamHandler17 = postExamHandler17;
const postExamHandler18 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, description, order, duration, passingScore, parentModuleId } = req.body;
        if (!title)
            return res.status(400).json({ error: 'Title is required' });
        const exam = yield prisma_1.default.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
        }
        if (parentModuleId) {
            const parentMod = yield prisma_1.default.examModule.findFirst({ where: { id: parentModuleId, examId: id } });
            if (!parentMod) {
                return res.status(400).json({ error: 'Specified parent module not found in this exam.' });
            }
        }
        const module = yield prisma_1.default.examModule.create({
            data: {
                examId: id,
                parentModuleId: parentModuleId ? String(parentModuleId).trim() : null,
                title,
                description,
                order: order || 0,
                duration: duration ? parseInt(duration) : null,
                passingScore: passingScore ? parseInt(passingScore) : null
            }
        });
        res.status(201).json(module);
    }
    catch (error) {
        console.error('Error creating exam module:', error);
        res.status(500).json({ error: 'Failed to create exam module' });
    }
});
exports.postExamHandler18 = postExamHandler18;
const putExamHandler19 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId } = req.params;
        const { title, description, order, duration, passingScore, gradeTarget, parentModuleId, publishDate, cutOffDate } = req.body;
        const exam = yield prisma_1.default.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
        }
        if (parentModuleId !== undefined && parentModuleId !== null) {
            if (parentModuleId === moduleId) {
                return res.status(400).json({ error: 'Cannot set a module as its own parent.' });
            }
            const parentMod = yield prisma_1.default.examModule.findFirst({ where: { id: parentModuleId, examId: id } });
            if (!parentMod) {
                return res.status(400).json({ error: 'Specified parent module not found in this exam.' });
            }
        }
        const module = yield prisma_1.default.examModule.update({
            where: { id: moduleId },
            data: {
                title: title !== undefined ? title : undefined,
                description: description !== undefined ? description : undefined,
                order: order !== undefined ? parseInt(order) : undefined,
                duration: duration !== undefined ? (duration ? parseInt(duration) : null) : undefined,
                passingScore: passingScore !== undefined ? (passingScore ? parseInt(passingScore) : null) : undefined,
                gradeTarget: gradeTarget !== undefined ? (gradeTarget ? (0, shared_1.sanitizeHtml)(gradeTarget) : null) : undefined,
                parentModuleId: parentModuleId !== undefined ? (parentModuleId ? String(parentModuleId).trim() : null) : undefined,
                publishDate: publishDate !== undefined ? (publishDate ? new Date(publishDate) : null) : undefined,
                cutOffDate: cutOffDate !== undefined ? (cutOffDate ? new Date(cutOffDate) : null) : undefined,
            }
        });
        res.json(module);
    }
    catch (error) {
        console.error('Error updating exam module:', error);
        res.status(500).json({ error: 'Failed to update exam module' });
    }
});
exports.putExamHandler19 = putExamHandler19;
const deleteExamHandler20 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id, moduleId } = req.params;
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'SUPER_ADMIN') {
            const allowed = yield (0, systemSettings_service_1.isContentDeletionAllowed)();
            if (!allowed) {
                return res.status(403).json({ error: 'حذف الموديولات والمحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.' });
            }
        }
        const exam = yield prisma_1.default.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
        }
        const module = yield prisma_1.default.examModule.findFirst({
            where: { id: moduleId, examId: id },
            select: { id: true }
        });
        if (!module)
            return res.status(404).json({ error: 'Exam module not found' });
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const subExamIds = (yield tx.subExam.findMany({
                where: { moduleId },
                select: { id: true }
            })).map((subExam) => subExam.id);
            // Clear question links first so module/sub-exam deletion never hits FK constraints.
            yield tx.question.updateMany({
                where: {
                    examId: id,
                    OR: [
                        { moduleId },
                        ...(subExamIds.length > 0 ? [{ subExamId: { in: subExamIds } }] : [])
                    ]
                },
                data: {
                    moduleId: null,
                    subExamId: null
                }
            });
            if (subExamIds.length > 0) {
                yield tx.subExam.deleteMany({
                    where: { id: { in: subExamIds } }
                });
            }
            yield tx.examModule.delete({ where: { id: moduleId } });
            const remainingModules = yield tx.examModule.count({ where: { examId: id } });
            if (remainingModules === 0) {
                yield tx.exam.update({ where: { id }, data: { deletedAt: new Date() } });
            }
        }));
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error deleting exam module:', error);
        res.status(500).json({ error: 'Failed to delete exam module' });
    }
});
exports.deleteExamHandler20 = deleteExamHandler20;
const postExamHandler28 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId } = req.params;
        const { title, password, duration, passingScore, attemptsAllowed, publishDate, cutOffDate } = req.body || {};
        if (!title || !String(title).trim())
            return res.status(400).json({ error: 'Exam title is required' });
        const module = yield prisma_1.default.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
        if (!module)
            return res.status(404).json({ error: 'Exam module not found' });
        const subExam = yield prisma_1.default.subExam.create({
            data: {
                moduleId,
                title: (0, shared_1.sanitizeHtml)(String(title).trim()),
                password: password ? (0, shared_1.sanitizeHtml)(String(password).trim()) : null,
                duration: duration ? parseInt(duration) : null,
                passingScore: passingScore ? parseInt(passingScore) : null,
                attemptsAllowed: attemptsAllowed ? parseInt(attemptsAllowed) || 1 : 1,
                order: yield prisma_1.default.subExam.count({ where: { moduleId } }),
                publishDate: publishDate ? new Date(publishDate) : null,
                cutOffDate: cutOffDate ? new Date(cutOffDate) : null,
            }
        });
        res.status(201).json(subExam);
    }
    catch (error) {
        console.error('Error creating child exam:', error);
        res.status(500).json({ error: 'Failed to create exam inside module' });
    }
});
exports.postExamHandler28 = postExamHandler28;
const postExamHandler33 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id, moduleId, subExamId } = req.params;
        const includeStandalone = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.includeStandalone) === true;
        const includeModuleQuestions = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.includeModuleQuestions) !== false;
        const module = yield prisma_1.default.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
        if (!module)
            return res.status(404).json({ error: 'Exam module not found' });
        const subExam = yield prisma_1.default.subExam.findFirst({ where: { id: subExamId, moduleId }, select: { id: true } });
        if (!subExam)
            return res.status(404).json({ error: 'Exam not found inside module' });
        const sourceFilters = [];
        if (includeModuleQuestions)
            sourceFilters.push({ moduleId, subExamId: null });
        if (includeStandalone)
            sourceFilters.push({ moduleId: null });
        const sourceQuestions = yield prisma_1.default.question.findMany({
            where: {
                examId: id,
                deletedAt: null,
                OR: sourceFilters,
            },
            select: { id: true, text: true },
        });
        if (sourceQuestions.length > 0) {
            // Check existing questions in target subExam to prevent duplicating questions into the subExam
            const existingInTarget = yield prisma_1.default.question.findMany({
                where: {
                    examId: id,
                    moduleId,
                    subExamId,
                    deletedAt: null,
                },
                select: { id: true, text: true },
            });
            const targetSignatures = new Set(existingInTarget.map((q) => (0, shared_1.robustNormalizeText)(q.text)).filter((t) => t.length > 5));
            const questionsToMove = [];
            for (const q of sourceQuestions) {
                const sig = (0, shared_1.robustNormalizeText)(q.text);
                if (sig && targetSignatures.has(sig)) {
                    // Check if this source question has any student answers
                    const answerCount = yield prisma_1.default.studentAnswer.count({ where: { questionId: q.id } });
                    if (answerCount === 0) {
                        // It's a duplicate question with 0 answers; remove it from active questions
                        yield prisma_1.default.question.update({
                            where: { id: q.id },
                            data: { deletedAt: new Date() },
                        });
                        continue;
                    }
                }
                questionsToMove.push(q.id);
            }
            if (questionsToMove.length > 0) {
                yield prisma_1.default.question.updateMany({
                    where: { id: { in: questionsToMove } },
                    data: { moduleId, subExamId },
                });
            }
        }
        res.json({ movedQuestionIds: sourceQuestions.map((question) => question.id) });
    }
    catch (error) {
        console.error('Error collecting module questions into exam:', error);
        res.status(500).json({ error: 'Failed to collect questions into exam' });
    }
});
exports.postExamHandler33 = postExamHandler33;
const putExamHandler29 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId, subExamId } = req.params;
        const parent = yield prisma_1.default.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
        if (!parent)
            return res.status(404).json({ error: 'Exam module not found' });
        const data = {};
        if (req.body.title !== undefined)
            data.title = (0, shared_1.sanitizeHtml)(String(req.body.title).trim());
        if (req.body.password !== undefined)
            data.password = req.body.password ? (0, shared_1.sanitizeHtml)(String(req.body.password).trim()) : null;
        if (req.body.duration !== undefined)
            data.duration = req.body.duration ? parseInt(req.body.duration) : null;
        if (req.body.passingScore !== undefined)
            data.passingScore = req.body.passingScore ? parseInt(req.body.passingScore) : null;
        if (req.body.attemptsAllowed !== undefined)
            data.attemptsAllowed = parseInt(req.body.attemptsAllowed) || 1;
        if (req.body.publishDate !== undefined)
            data.publishDate = req.body.publishDate ? new Date(req.body.publishDate) : null;
        if (req.body.cutOffDate !== undefined)
            data.cutOffDate = req.body.cutOffDate ? new Date(req.body.cutOffDate) : null;
        const subExam = yield prisma_1.default.subExam.updateMany({ where: { id: subExamId, moduleId }, data });
        if (!subExam.count)
            return res.status(404).json({ error: 'Exam not found inside module' });
        res.json(yield prisma_1.default.subExam.findUnique({ where: { id: subExamId } }));
    }
    catch (error) {
        console.error('Error updating child exam:', error);
        res.status(500).json({ error: 'Failed to update exam inside module' });
    }
});
exports.putExamHandler29 = putExamHandler29;
