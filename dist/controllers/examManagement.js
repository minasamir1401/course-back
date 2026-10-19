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
exports.postExamHandler8 = exports.postExamHandler7 = exports.deleteExamHandler6 = exports.putExamHandler5 = exports.getExamHandler4 = exports.getExamHandler3 = exports.postExamHandler2 = exports.getExamHandler1 = void 0;
const bilingualMetadata_1 = require("../utils/bilingualMetadata");
const examQuestionWrites_1 = require("../utils/examQuestionWrites");
const examQuestionInput_1 = require("../utils/examQuestionInput");
const node_crypto_1 = require("node:crypto");
const examPerformance_1 = require("../utils/examPerformance");
const prisma_1 = __importDefault(require("../lib/prisma"));
const contentReconciliation_1 = require("../lib/contentReconciliation");
const examWorkflow_1 = require("../utils/examWorkflow");
const examErrorLog_1 = require("../utils/examErrorLog");
const examDeletionPolicy_1 = require("../utils/examDeletionPolicy");
const examAccessPolicy_1 = require("../utils/examAccessPolicy");
const systemSettings_service_1 = require("../services/systemSettings.service");
const shared_1 = require("../shared");
const examControllerSupport_1 = require("./examControllerSupport");
const getExamHandler1 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        // 1. Get total XP from User model
        const user = yield prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { xp: true, name: true, avatar: true, grade: true }
        });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        // 2. Get recent exams
        const submissions = yield prisma_1.default.examSubmission.findMany({
            where: { userId },
            include: {
                exam: {
                    select: {
                        id: true,
                        title: true,
                        type: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        const portfolio = submissions.map(sub => ({
            examId: sub.exam.id,
            examTitle: sub.exam.title,
            score: sub.totalScore,
            date: sub.createdAt
        }));
        res.json({
            user,
            portfolio
        });
    }
    catch (error) {
        console.error('Error fetching student portfolio:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});
exports.getExamHandler1 = getExamHandler1;
const postExamHandler2 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, description, type, duration, passingScore, showAnswers, isCentral, schoolIds, schoolId, grade, grades, subjects, courseId, folderId, questions, courseName, section, domain, learningOutcomes, indicators, skills, gradeTarget } = req.body;
        const missing = (0, shared_1.hasRequiredFields)(req.body, ['title']);
        if (missing) {
            return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
        }
        if (questions && !Array.isArray(questions)) {
            return res.status(400).json({ error: 'questions must be an array.' });
        }
        let schoolAdminSchoolId = req.user.schoolId;
        if (req.user.role === 'SCHOOL_ADMIN' && !schoolAdminSchoolId && req.user.id) {
            const u = yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { schoolId: true } });
            schoolAdminSchoolId = (u === null || u === void 0 ? void 0 : u.schoolId) || null;
        }
        const rawCreateSchoolList = schoolIds !== undefined && Array.isArray(schoolIds) && schoolIds.length > 0
            ? schoolIds
            : (schoolId ? [schoolId] : (req.user.role === 'SCHOOL_ADMIN' ? [schoolAdminSchoolId] : []));
        const sanitizedCreateSchoolIds = (Array.isArray(rawCreateSchoolList) ? rawCreateSchoolList : [rawCreateSchoolList])
            .map((s) => (typeof s === 'object' && s ? s.id : s))
            .filter((id) => Boolean(id && typeof id === 'string' && id !== 'null' && id !== 'undefined' && id.trim() !== ''))
            .map((id) => id.trim());
        // Prepare target schools — only SUPER_ADMIN may mark an exam as Central, and only when no specific schools are targeted
        const effectiveIsCentral = req.user.role === 'SUPER_ADMIN'
            ? (isCentral === false ? false : (sanitizedCreateSchoolIds.length > 0 ? false : (isCentral !== undefined ? !!isCentral : true)))
            : false;
        const finalSchoolIds = effectiveIsCentral
            ? []
            : req.user.role === 'SCHOOL_ADMIN'
                ? (schoolAdminSchoolId ? [schoolAdminSchoolId] : sanitizedCreateSchoolIds)
                : sanitizedCreateSchoolIds;
        const ownerSchoolId = effectiveIsCentral
            ? null
            : (finalSchoolIds.length > 0 ? finalSchoolIds[0] : null);
        if (ownerSchoolId && !finalSchoolIds.includes(ownerSchoolId)) {
            finalSchoolIds.push(ownerSchoolId);
        }
        // Check if duplicate exam already exists in the same target school
        if (req.body.status !== 'DRAFT') {
            const existingExam = yield prisma_1.default.exam.findFirst({
                where: {
                    title,
                    schoolId: ownerSchoolId,
                    courseId,
                    deletedAt: null,
                    status: { not: 'DRAFT' }
                }
            });
            if (existingExam) {
                return res.status(400).json({ error: 'يوجد امتحان بنفس هذا العنوان مسجل مسبقاً.' });
            }
        }
        const sanitizedQuestions = (0, examQuestionInput_1.deduplicateExamQuestionInput)((0, shared_1.sanitizeDeep)(questions || []));
        const sanitizedModulesInput = Array.isArray(req.body.modules) ? req.body.modules : [];
        const exam = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const newExam = yield tx.exam.create({
                data: {
                    title: (0, shared_1.sanitizeHtml)(title),
                    description: description ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(description)) : null,
                    // The exam workflow exposes one assessment type only; normalize legacy Quiz input.
                    type: type ? (String(type).toLowerCase() === 'quiz' ? 'Exam' : (0, shared_1.sanitizeHtml)(type)) : 'Exam',
                    courseId: courseId ? (0, shared_1.sanitizeHtml)(courseId) : null,
                    folderId: folderId ? (0, shared_1.sanitizeHtml)(folderId) : null,
                    isCentral: effectiveIsCentral,
                    creatorId: req.user.id,
                    schoolId: ownerSchoolId,
                    duration: parseInt(duration) || 30,
                    passingScore: parseInt(passingScore) || 50,
                    skill: req.body.skill ? (0, shared_1.sanitizeHtml)(req.body.skill) : null,
                    level: req.body.level ? (0, shared_1.sanitizeHtml)(req.body.level) : "Medium",
                    showAnswers: showAnswers !== undefined ? showAnswers : true,
                    resultVisibility: req.body.resultVisibility || "SHOW_SCORE",
                    password: req.body.password || null,
                    startDate: req.body.startDate ? new Date(req.body.startDate) : null,
                    endDate: req.body.endDate ? new Date(req.body.endDate) : null,
                    attemptsAllowed: parseInt(req.body.attemptsAllowed) || 1,
                    status: req.body.status || "PUBLISHED",
                    category: req.body.category ? (0, shared_1.sanitizeHtml)(req.body.category) : null,
                    grade: grade ? (0, shared_1.sanitizeHtml)(grade) : null,
                    grades: Array.isArray(grades) ? JSON.stringify(grades) : (grade ? JSON.stringify([grade]) : null),
                    subjects: Array.isArray(subjects) ? JSON.stringify(subjects) : (req.body.category ? JSON.stringify([req.body.category]) : null),
                    schools: {
                        connect: finalSchoolIds.filter((id) => id && id !== 'null').map((id) => ({ id }))
                    },
                    courseName: courseName ? (0, shared_1.sanitizeHtml)(courseName) : null,
                    section: section ? (0, shared_1.sanitizeHtml)(section) : null,
                    domain: domain ? (0, shared_1.sanitizeHtml)(domain) : null,
                    learningOutcomes: learningOutcomes ? (0, shared_1.sanitizeHtml)(learningOutcomes) : null,
                    indicators: indicators ? (0, shared_1.sanitizeHtml)(indicators) : null,
                    skills: skills ? (0, shared_1.sanitizeHtml)(skills) : null,
                    gradeTarget: gradeTarget ? (0, shared_1.sanitizeHtml)(gradeTarget) : null
                }
            });
            // Sequential Module Creation with Deduplication
            const seenModuleKeys = new Set();
            const deduplicatedModules = [];
            for (const m of sanitizedModulesInput) {
                if (!m)
                    continue;
                const key = m.id ? String(m.id).trim() : (m.title ? String(m.title).trim().toLowerCase() : `__index_${deduplicatedModules.length}`);
                if (seenModuleKeys.has(key))
                    continue;
                seenModuleKeys.add(key);
                const seenSubExamKeys = new Set();
                const deduplicatedSubExams = [];
                for (const s of (Array.isArray(m.subExams) ? m.subExams : [])) {
                    if (!s)
                        continue;
                    const subKey = s.id ? String(s.id).trim() : (s.title ? String(s.title).trim().toLowerCase() : `__sub_${deduplicatedSubExams.length}`);
                    if (seenSubExamKeys.has(subKey))
                        continue;
                    seenSubExamKeys.add(subKey);
                    deduplicatedSubExams.push(s);
                }
                deduplicatedModules.push(Object.assign(Object.assign({}, m), { subExams: deduplicatedSubExams }));
            }
            const moduleIdMap = {};
            const subExamIdMap = {};
            for (let i = 0; i < deduplicatedModules.length; i++) {
                const m = deduplicatedModules[i];
                const frontendModuleId = m.id;
                const createdMod = yield tx.examModule.create({
                    data: Object.assign(Object.assign({ examId: newExam.id, title: m.title ? (0, shared_1.sanitizeHtml)(m.title) : `Module ${i + 1}`, description: m.description ? (0, shared_1.sanitizeHtml)(m.description) : null, order: m.order !== undefined ? parseInt(m.order) : i, duration: m.duration ? parseInt(m.duration) : null, passingScore: m.passingScore ? parseInt(m.passingScore) : null }, (0, bilingualMetadata_1.moduleMetadata)(m, shared_1.sanitizeHtml)), { gradeTarget: m.gradeTarget ? (0, shared_1.sanitizeHtml)(m.gradeTarget) : null, publishDate: m.publishDate ? new Date(m.publishDate) : null, cutOffDate: m.cutOffDate ? new Date(m.cutOffDate) : null })
                });
                if (frontendModuleId)
                    moduleIdMap[frontendModuleId] = createdMod.id;
                const subExamsInput = Array.isArray(m.subExams) ? m.subExams : [];
                for (let j = 0; j < subExamsInput.length; j++) {
                    const s = subExamsInput[j];
                    const createdSubExam = yield tx.subExam.create({
                        data: {
                            moduleId: createdMod.id,
                            title: s.title ? (0, shared_1.sanitizeHtml)(s.title) : `Sub-Exam ${j + 1}`,
                            password: s.password ? (0, shared_1.sanitizeHtml)(s.password) : null,
                            duration: s.duration ? parseInt(s.duration) : null,
                            passingScore: s.passingScore ? parseInt(s.passingScore) : null,
                            attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
                            order: s.order !== undefined ? parseInt(s.order) : j,
                            publishDate: s.publishDate ? new Date(s.publishDate) : null,
                            cutOffDate: s.cutOffDate ? new Date(s.cutOffDate) : null,
                        }
                    });
                    if (s.id)
                        subExamIdMap[s.id] = createdSubExam.id;
                }
                const subModulesInput = Array.isArray(m.subModules) ? m.subModules : [];
                for (let smIdx = 0; smIdx < subModulesInput.length; smIdx++) {
                    const sm = subModulesInput[smIdx];
                    if (!sm)
                        continue;
                    const frontendSubModId = sm.id;
                    const createdSubMod = yield tx.examModule.create({
                        data: Object.assign(Object.assign({ examId: newExam.id, parentModuleId: createdMod.id, title: sm.title ? (0, shared_1.sanitizeHtml)(sm.title) : `Sub-Module ${smIdx + 1}`, description: sm.description ? (0, shared_1.sanitizeHtml)(sm.description) : null, order: sm.order !== undefined ? parseInt(sm.order) : smIdx, duration: sm.duration ? parseInt(sm.duration) : null, passingScore: sm.passingScore ? parseInt(sm.passingScore) : null }, (0, bilingualMetadata_1.moduleMetadata)(sm, shared_1.sanitizeHtml)), { gradeTarget: sm.gradeTarget ? (0, shared_1.sanitizeHtml)(sm.gradeTarget) : null, publishDate: sm.publishDate ? new Date(sm.publishDate) : null, cutOffDate: sm.cutOffDate ? new Date(sm.cutOffDate) : null })
                    });
                    if (frontendSubModId)
                        moduleIdMap[frontendSubModId] = createdSubMod.id;
                    const smSubExamsInput = Array.isArray(sm.subExams) ? sm.subExams : [];
                    for (let sj = 0; sj < smSubExamsInput.length; sj++) {
                        const s = smSubExamsInput[sj];
                        if (!s)
                            continue;
                        const createdSubExam = yield tx.subExam.create({
                            data: {
                                moduleId: createdSubMod.id,
                                title: s.title ? (0, shared_1.sanitizeHtml)(s.title) : `Sub-Exam ${sj + 1}`,
                                password: s.password ? (0, shared_1.sanitizeHtml)(s.password) : null,
                                duration: s.duration ? parseInt(s.duration) : null,
                                passingScore: s.passingScore ? parseInt(s.passingScore) : null,
                                attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
                                order: s.order !== undefined ? parseInt(s.order) : sj,
                                publishDate: s.publishDate ? new Date(s.publishDate) : null,
                                cutOffDate: s.cutOffDate ? new Date(s.cutOffDate) : null,
                            }
                        });
                        if (s.id)
                            subExamIdMap[s.id] = createdSubExam.id;
                    }
                }
            }
            // Sequential Question Creation
            for (let index = 0; index < sanitizedQuestions.length; index++) {
                const q = sanitizedQuestions[index];
                const resolvedModuleId = q.moduleId
                    ? (moduleIdMap[(0, shared_1.sanitizeHtml)(q.moduleId)] || null)
                    : null;
                yield tx.question.create({
                    data: Object.assign(Object.assign({ examId: newExam.id, text: (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.text || '')), textEn: q.textEn ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.textEn)) : null, type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(q.type) ? (0, shared_1.sanitizeHtml)(q.type) : 'MCQ', options: (0, shared_1.extractAndSaveBase64Images)(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])), optionsEn: q.optionsEn ? (0, shared_1.extractAndSaveBase64Images)(typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(q.optionsEn || [])) : null, correctAnswer: (0, examControllerSupport_1.formatCorrectAnswer)(q), points: parseInt(q.points) || 1, xpPoints: parseInt(q.xpPoints) || 10 }, (0, bilingualMetadata_1.metadataTranslations)(q, shared_1.sanitizeHtml)), { skill: q.skill ? (0, shared_1.sanitizeHtml)(q.skill) : null, learningOutcome: ((_a = q.learningOutcome) !== null && _a !== void 0 ? _a : q.standard) ? (0, shared_1.sanitizeHtml)((_b = q.learningOutcome) !== null && _b !== void 0 ? _b : q.standard) : null, standard: ((_c = q.standard) !== null && _c !== void 0 ? _c : q.learningOutcome) ? (0, shared_1.sanitizeHtml)((_d = q.standard) !== null && _d !== void 0 ? _d : q.learningOutcome) : null, indicator: q.indicator ? (0, shared_1.sanitizeHtml)(q.indicator) : null, videoUrl: q.videoUrl ? (0, shared_1.sanitizeHtml)(q.videoUrl) : null, level: q.level ? (0, shared_1.sanitizeHtml)(q.level) : 'Medium', dok: (0, examControllerSupport_1.normalizeBackendDok)(q.dok), cognitive: q.cognitive ? (0, shared_1.sanitizeHtml)(q.cognitive) : null, course: q.course ? (0, shared_1.sanitizeHtml)(q.course) : null, section: q.section ? (0, shared_1.sanitizeHtml)(q.section) : null, domain: q.domain ? (0, shared_1.sanitizeHtml)(q.domain) : null, subskill: q.subskill ? (0, shared_1.sanitizeHtml)(q.subskill) : null, microSkill: q.microSkill ? (0, shared_1.sanitizeHtml)(q.microSkill) : null, gradeTarget: q.gradeTarget ? (0, shared_1.sanitizeHtml)(q.gradeTarget) : null, errorPattern: q.errorPattern ? (0, shared_1.sanitizeHtml)(q.errorPattern) : null, estimatedTime: q.estimatedTime ? (0, shared_1.sanitizeHtml)(q.estimatedTime) : null, explanation: (0, examControllerSupport_1.formatExplanation)(q), explanationEn: q.explanationEn ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.explanationEn)) : null, hint: q.hint ? (0, shared_1.sanitizeHtml)(q.hint) : null, hintEn: q.hintEn ? (0, shared_1.sanitizeHtml)(q.hintEn) : null, imageUrl: q.imageUrl ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.imageUrl)) : null, moduleId: resolvedModuleId, subExamId: q.subExamId
                            ? (subExamIdMap[(0, shared_1.sanitizeHtml)(q.subExamId)] || null)
                            : null, order: index })
                });
            }
            // Return full exam
            const fullExam = yield tx.exam.findUnique({
                where: { id: newExam.id },
                include: {
                    questions: {
                        where: { deletedAt: null },
                        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                    },
                    modules: {
                        where: { parentModuleId: null },
                        orderBy: { order: 'asc' },
                        include: {
                            subExams: { orderBy: { order: 'asc' } },
                            subModules: {
                                orderBy: { order: 'asc' },
                                include: { subExams: { orderBy: { order: 'asc' } } }
                            }
                        }
                    }
                }
            });
            return (0, shared_1.sanitizeExam)(fullExam);
        }), { maxWait: 15000, timeout: 120000 });
        res.json({ message: 'Exam created successfully', exam });
    }
    catch (error) {
        console.error(' Exam creation error:', error);
        res.status(500).json({ error: 'Error creating exam', details: error.message });
    }
});
exports.postExamHandler2 = postExamHandler2;
const getExamHandler3 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { schoolId, isCentral, grade, folderId } = req.query;
        const where = { deletedAt: null };
        if (folderId) {
            where.folderId = folderId;
        }
        const buildGradeFilter = (g) => ({
            OR: [
                { grade: g },
                { grades: { contains: `"${g}"` } }
            ]
        });
        if (isCentral === 'true' && req.user.role === 'SUPER_ADMIN') {
            where.isCentral = true;
        }
        else if (req.user.role === 'SUPER_ADMIN') {
            if (schoolId) {
                where.OR = [
                    { isCentral: true },
                    { schoolId: schoolId },
                    { schools: { some: { id: schoolId } } }
                ];
            }
            if (grade) {
                where.AND = [
                    ...(where.AND || []),
                    buildGradeFilter(grade)
                ];
            }
        }
        else if (req.user.role === 'SCHOOL_ADMIN') {
            let schoolIdToUse = req.user.schoolId;
            if (!schoolIdToUse && req.user.id) {
                const u = yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { schoolId: true } });
                schoolIdToUse = (u === null || u === void 0 ? void 0 : u.schoolId) || null;
            }
            where.OR = [
                { isCentral: true },
                ...(schoolIdToUse ? [
                    { schoolId: schoolIdToUse },
                    { schools: { some: { id: schoolIdToUse } } }
                ] : [])
            ];
            if (grade) {
                where.AND = [
                    ...(where.AND || []),
                    buildGradeFilter(grade)
                ];
            }
        }
        else if (req.user.role === 'TEACHER') {
            where.OR = [
                { creatorId: req.user.id },
                { course: { teachers: { some: { teacherId: req.user.id } } } }
            ];
            if (grade) {
                where.AND = [
                    ...(where.AND || []),
                    buildGradeFilter(grade)
                ];
            }
        }
        else if (req.user.role === 'STUDENT') {
            const student = yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { grade: true, schoolId: true } });
            if (!student)
                return res.status(403).json({ error: 'Student account not found' });
            req.user = (0, examWorkflow_1.mergeStudentProfile)(req.user, student);
            const currentGrade = student.grade;
            const schoolId = student.schoolId;
            // Base filters: Truly central exams (no specific school restriction)
            const orFilters = [
                {
                    isCentral: true,
                    schoolId: null,
                    schools: { none: {} }
                }
            ];
            // Only add school filters if student belongs to a school
            if (schoolId) {
                orFilters.push({ schoolId: schoolId });
                orFilters.push({ schools: { some: { id: schoolId } } });
            }
            const studentGrades = (0, shared_1.getStudentGradeAndStage)(currentGrade);
            const gradeOrConditions = [{ grade: null, OR: [{ grades: null }, { grades: '[]' }, { grades: '' }] }];
            for (const g of studentGrades) {
                gradeOrConditions.push({ grade: g });
                gradeOrConditions.push({ grades: { contains: `"${g}"` } });
            }
            where.AND = [
                { OR: orFilters },
                ...(gradeOrConditions.length > 0 ? [{ OR: gradeOrConditions }] : [])
            ];
            where.status = 'PUBLISHED';
            // Student must only see exams that have at least one module
            where.modules = { some: {} };
        }
        else if (req.user.role === 'TEACHER') {
            const teacherCourses = yield prisma_1.default.teacherCourse.findMany({
                where: { teacherId: req.user.id },
                select: { courseId: true }
            });
            const courseIds = teacherCourses.map(tc => tc.courseId);
            where.courseId = { in: courseIds };
        }
        let exams = yield prisma_1.default.exam.findMany({
            where,
            include: Object.assign(Object.assign({}, (req.user.role === 'STUDENT' ? {
                submissions: {
                    where: { userId: req.user.id },
                    select: { id: true, subExamId: true, createdAt: true }
                }
            } : {})), { school: { select: { name: true } }, schools: { select: { name: true, id: true } }, creator: { select: { name: true } }, _count: { select: { questions: { where: { deletedAt: null } } } }, modules: {
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
                        subExams: {
                            orderBy: { order: 'asc' },
                            include: { _count: { select: { questions: { where: { deletedAt: null } } } } }
                        },
                        _count: { select: { questions: { where: { deletedAt: null } } } }
                    }
                } }),
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        if (req.user.role === 'STUDENT') {
            exams = exams.filter((exam) => {
                // A student must only see exams that contain at least one root module/section
                const rootSections = (exam.modules || []).filter((m) => !m.parentModuleId);
                if (rootSections.length === 0)
                    return false;
                // Double check student school and grade access
                return (0, shared_1.examMatchesStudent)(exam, req.user);
            });
        }
        res.json(exams.map((exam) => (Object.assign(Object.assign({}, exam), { modules: (exam.modules || []).map((module) => (Object.assign(Object.assign(Object.assign({}, module), (0, examWorkflow_1.countModuleContent)(module)), { availability: (0, examWorkflow_1.getAvailability)(module), subModules: (module.subModules || []).map((sm) => (Object.assign(Object.assign(Object.assign({}, sm), (0, examWorkflow_1.countModuleContent)(sm)), { availability: (0, examWorkflow_1.getAvailability)(sm), subExams: (sm.subExams || []).map((subExam) => {
                        var _a;
                        return (Object.assign(Object.assign({}, subExam), { questionsCount: ((_a = subExam._count) === null || _a === void 0 ? void 0 : _a.questions) || 0, availability: (0, examWorkflow_1.getAvailability)(subExam) }));
                    }) }))), subExams: (module.subExams || []).map((subExam) => {
                    var _a;
                    return (Object.assign(Object.assign({}, subExam), { questionsCount: ((_a = subExam._count) === null || _a === void 0 ? void 0 : _a.questions) || 0, availability: (0, examWorkflow_1.getAvailability)(subExam) }));
                }) }))) }))));
    }
    catch (error) {
        (0, examErrorLog_1.logExamRequestError)('list', req, error);
        res.status(500).json({ error: 'Error fetching exams' });
    }
});
exports.getExamHandler3 = getExamHandler3;
const getExamHandler4 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { grade, search } = req.query;
        const questions = yield prisma_1.default.question.findMany({
            where: Object.assign(Object.assign({ exam: { isCentral: true }, deletedAt: null }, (grade ? { exam: { grade: grade } } : {})), (search ? { text: { contains: search } } : {})),
            include: {
                exam: { select: { title: true, grade: true } }
            },
            take: 50,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        // Parse options for each question
        const parsedQuestions = questions.map(q => (Object.assign(Object.assign({}, q), { options: JSON.parse(q.options || "[]") })));
        res.json(parsedQuestions);
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching question bank' });
    }
});
exports.getExamHandler4 = getExamHandler4;
const putExamHandler5 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, description, type, isCentral, schoolIds, duration, passingScore, showAnswers, questions, deletedQuestionIds, grade, grades, subjects, password, startDate, endDate, attemptsAllowed, status, courseId, folderId, courseName, section, domain, learningOutcomes, indicators, skills, gradeTarget } = req.body;
        if (questions !== undefined && !Array.isArray(questions)) {
            return res.status(400).json({ error: 'questions must be an array when provided.' });
        }
        const existingExam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: {
                schools: { select: { id: true } },
                _count: { select: { submissions: true } }
            }
        });
        if (!existingExam || existingExam.deletedAt !== null)
            return res.status(404).json({ error: 'Exam not found or has been deleted' });
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, existingExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to edit this exam.' });
        }
        const questionScopeId = typeof req.body.questionScopeId === 'string' ? req.body.questionScopeId : null;
        if (questionScopeId) {
            const scope = yield prisma_1.default.subExam.findFirst({ where: { id: questionScopeId, module: { examId: id } }, select: { id: true } });
            if (!scope || req.body.modules !== undefined || (questions || []).some((q) => q.subExamId !== questionScopeId)) {
                return res.status(400).json({ error: 'Invalid child exam save scope' });
            }
            if (Array.isArray(deletedQuestionIds) && deletedQuestionIds.length) {
                const outOfScope = yield prisma_1.default.question.count({ where: { id: { in: deletedQuestionIds }, examId: id, OR: [{ subExamId: null }, { subExamId: { not: questionScopeId } }] } });
                if (outOfScope)
                    return res.status(400).json({ error: 'Question deletion outside child exam scope' });
            }
        }
        const sanitizedQuestions = (0, examQuestionInput_1.deduplicateExamQuestionInput)((0, shared_1.sanitizeDeep)(questions || []));
        if (deletedQuestionIds !== undefined && !Array.isArray(deletedQuestionIds)) {
            return res.status(400).json({ error: 'deletedQuestionIds must be an array.' });
        }
        const requestedDeletes = (deletedQuestionIds || []).filter((value) => typeof value === 'string');
        const hierarchyDeletes = (0, examDeletionPolicy_1.resolveExplicitExamDeletions)(req.body);
        if (req.body.modules !== undefined && (hierarchyDeletes.moduleIds.length || hierarchyDeletes.subExamIds.length) &&
            req.user.role !== 'SUPER_ADMIN' && !(yield (0, systemSettings_service_1.isContentDeletionAllowed)())) {
            return res.status(403).json({ error: 'Content deletion is currently disabled by Super Admin. حذف المحتوى معطّل حالياً من الإدارة العامة.' });
        }
        if (requestedDeletes.length > 0 && req.user.role !== 'SUPER_ADMIN') {
            const allowed = yield (0, systemSettings_service_1.isContentDeletionAllowed)();
            if (!allowed) {
                const persistedDeletes = yield prisma_1.default.question.count({
                    where: { examId: id, id: { in: requestedDeletes }, deletedAt: null }
                });
                if (persistedDeletes > 0) {
                    return res.status(403).json({
                        error: 'حذف الأسئلة والمحتوى معطّل حالياً من قِبل الإدارة العامة. Content and question deletion is currently disabled by Super Admin.'
                    });
                }
            }
        }
        const updateData = {
            title: title !== undefined ? (0, shared_1.sanitizeHtml)(title) : undefined,
            description: description !== undefined ? (description ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(description)) : null) : undefined,
            type: type !== undefined ? (String(type).toLowerCase() === 'quiz' ? 'Exam' : (0, shared_1.sanitizeHtml)(type)) : undefined,
            courseId: courseId !== undefined ? (courseId ? (0, shared_1.sanitizeHtml)(courseId) : null) : undefined,
            showAnswers: showAnswers !== undefined ? showAnswers : undefined,
            resultVisibility: req.body.resultVisibility,
            password: req.body.password !== undefined ? (req.body.password || null) : undefined,
            startDate: req.body.startDate !== undefined ? (req.body.startDate ? new Date(req.body.startDate) : null) : undefined,
            endDate: req.body.endDate !== undefined ? (req.body.endDate ? new Date(req.body.endDate) : null) : undefined,
            status,
            category: req.body.category !== undefined ? (req.body.category ? (0, shared_1.sanitizeHtml)(req.body.category) : null) : undefined,
            grade: grade !== undefined ? (grade ? (0, shared_1.sanitizeHtml)(grade) : null) : undefined,
            grades: grades !== undefined ? (Array.isArray(grades) ? JSON.stringify(grades) : (grade ? JSON.stringify([grade]) : null)) : undefined,
            subjects: subjects !== undefined ? (Array.isArray(subjects) ? JSON.stringify(subjects) : (req.body.category ? JSON.stringify([req.body.category]) : null)) : undefined,
            courseName: courseName !== undefined ? (courseName ? (0, shared_1.sanitizeHtml)(courseName) : null) : undefined,
            section: section !== undefined ? (section ? (0, shared_1.sanitizeHtml)(section) : null) : undefined,
            domain: domain !== undefined ? (domain ? (0, shared_1.sanitizeHtml)(domain) : null) : undefined,
            learningOutcomes: learningOutcomes !== undefined ? (learningOutcomes ? (0, shared_1.sanitizeHtml)(learningOutcomes) : null) : undefined,
            indicators: indicators !== undefined ? (indicators ? (0, shared_1.sanitizeHtml)(indicators) : null) : undefined,
            skills: skills !== undefined ? (skills ? (0, shared_1.sanitizeHtml)(skills) : null) : undefined,
            gradeTarget: gradeTarget !== undefined ? (gradeTarget ? (0, shared_1.sanitizeHtml)(gradeTarget) : null) : undefined
        };
        if (folderId !== undefined)
            updateData.folderId = folderId === null ? null : (0, shared_1.sanitizeHtml)(folderId);
        if (duration !== undefined)
            updateData.duration = parseInt(duration);
        if (passingScore !== undefined)
            updateData.passingScore = parseInt(passingScore);
        if (attemptsAllowed !== undefined)
            updateData.attemptsAllowed = parseInt(attemptsAllowed) || 1;
        if (req.user.role === 'SUPER_ADMIN') {
            Object.assign(updateData, (0, examAccessPolicy_1.resolveExamSchoolUpdate)(existingExam, req.body));
        }
        else {
            const effectiveIsCentral = false;
            updateData.isCentral = effectiveIsCentral;
            let schoolIdToUse = existingExam.schoolId || req.user.schoolId;
            if (!schoolIdToUse && req.user.id) {
                const u = yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { schoolId: true } });
                schoolIdToUse = (u === null || u === void 0 ? void 0 : u.schoolId) || null;
            }
            updateData.schoolId = schoolIdToUse;
            if (schoolIdToUse) {
                updateData.schools = {
                    set: [{ id: schoolIdToUse }]
                };
            }
        }
        const exam = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            // --- MODULES UPSERT LOGIC ---
            let incomingModuleIds = [];
            let incomingSubExamIds = [];
            let modulesProvided = false;
            const moduleIdMap = new Map();
            const subExamIdMap = new Map();
            if (req.body.modules !== undefined) {
                modulesProvided = true;
                const sanitizedModules = Array.isArray(req.body.modules) ? req.body.modules : [];
                incomingModuleIds = sanitizedModules.flatMap((m) => [
                    m === null || m === void 0 ? void 0 : m.id,
                    ...(Array.isArray(m === null || m === void 0 ? void 0 : m.subModules) ? m.subModules.map((sm) => sm === null || sm === void 0 ? void 0 : sm.id) : [])
                ]).filter(Boolean);
                // 1. Gather all incoming SubExams across all modules and subModules
                incomingSubExamIds = sanitizedModules.flatMap((m) => [
                    ...(Array.isArray(m === null || m === void 0 ? void 0 : m.subExams) ? m.subExams.map((s) => s === null || s === void 0 ? void 0 : s.id) : []),
                    ...(Array.isArray(m === null || m === void 0 ? void 0 : m.subModules) ? m.subModules.flatMap((sm) => (Array.isArray(sm === null || sm === void 0 ? void 0 : sm.subExams) ? sm.subExams.map((s) => s === null || s === void 0 ? void 0 : s.id) : [])) : [])
                ]).filter(Boolean);
                const { moduleIds: deletedModuleIds, subExamIds: deletedSubExamIds } = (0, examDeletionPolicy_1.resolveExplicitExamDeletions)(req.body);
                // A collection snapshot can be stale during autosave. Only an explicit
                // deletion request is allowed to unlink or remove persisted content.
                if (deletedSubExamIds.length > 0) {
                    yield tx.question.updateMany({
                        where: { examId: id, subExamId: { in: deletedSubExamIds } },
                        data: { subExamId: null }
                    });
                }
                if (deletedModuleIds.length > 0) {
                    yield tx.question.updateMany({
                        where: { examId: id, moduleId: { in: deletedModuleIds } },
                        data: { moduleId: null }
                    });
                }
                if (deletedSubExamIds.length > 0) {
                    yield tx.subExam.deleteMany({
                        where: {
                            module: { examId: id },
                            id: { in: deletedSubExamIds }
                        }
                    });
                }
                if (deletedModuleIds.length > 0) {
                    yield tx.examModule.deleteMany({
                        where: {
                            examId: id,
                            id: { in: deletedModuleIds }
                        }
                    });
                }
                // Deduplicate incoming modules by id or title
                const seenModuleKeys = new Set();
                const deduplicatedModules = [];
                for (const m of sanitizedModules) {
                    if (!m)
                        continue;
                    const key = m.id ? String(m.id).trim() : (m.title ? String(m.title).trim().toLowerCase() : `__index_${deduplicatedModules.length}`);
                    if (seenModuleKeys.has(key))
                        continue;
                    seenModuleKeys.add(key);
                    const seenSubExamKeys = new Set();
                    const deduplicatedSubExams = [];
                    for (const s of (Array.isArray(m.subExams) ? m.subExams : [])) {
                        if (!s)
                            continue;
                        const subKey = s.id ? String(s.id).trim() : (s.title ? String(s.title).trim().toLowerCase() : `__sub_${deduplicatedSubExams.length}`);
                        if (seenSubExamKeys.has(subKey))
                            continue;
                        seenSubExamKeys.add(subKey);
                        deduplicatedSubExams.push(s);
                    }
                    deduplicatedModules.push(Object.assign(Object.assign({}, m), { subExams: deduplicatedSubExams }));
                }
                // Upsert deduplicated modules
                for (let i = 0; i < deduplicatedModules.length; i++) {
                    const m = deduplicatedModules[i];
                    const mData = Object.assign(Object.assign({ title: m.title ? (0, shared_1.sanitizeHtml)(m.title) : `Module ${i + 1}`, description: m.description ? (0, shared_1.sanitizeHtml)(m.description) : null, order: m.order !== undefined ? parseInt(m.order) : i, duration: m.duration ? parseInt(m.duration) : null, passingScore: m.passingScore ? parseInt(m.passingScore) : null }, (0, bilingualMetadata_1.moduleMetadata)(m, shared_1.sanitizeHtml)), { gradeTarget: m.gradeTarget ? (0, shared_1.sanitizeHtml)(m.gradeTarget) : null, publishDate: m.publishDate ? new Date(m.publishDate) : null, cutOffDate: m.cutOffDate ? new Date(m.cutOffDate) : null });
                    let moduleId = m.id;
                    const existingMod = m.id
                        ? yield tx.examModule.findFirst({ where: { examId: id, OR: [{ id: m.id }, { title: mData.title }] } })
                        : yield tx.examModule.findFirst({ where: { examId: id, title: mData.title } });
                    const candidateModuleId = (existingMod === null || existingMod === void 0 ? void 0 : existingMod.id) || (m.id ? String(m.id).trim() : null);
                    let moduleUpdated = false;
                    if (candidateModuleId) {
                        const updateRes = yield tx.examModule.updateMany({
                            where: { id: candidateModuleId, examId: id },
                            data: mData
                        });
                        if (updateRes.count > 0) {
                            moduleId = candidateModuleId;
                            moduleUpdated = true;
                        }
                    }
                    if (!moduleUpdated) {
                        const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateModuleId || '');
                        let idToUse = undefined;
                        if (isValidUuid && candidateModuleId) {
                            const alreadyExists = yield tx.examModule.findUnique({ where: { id: candidateModuleId } });
                            if (!alreadyExists) {
                                idToUse = candidateModuleId;
                            }
                        }
                        const newMod = yield tx.examModule.create({
                            data: Object.assign(Object.assign(Object.assign({}, (idToUse ? { id: idToUse } : {})), { examId: id }), mData)
                        });
                        moduleId = newMod.id;
                    }
                    if (m.id) {
                        moduleIdMap.set(String(m.id).trim(), moduleId);
                    }
                    moduleIdMap.set(moduleId, moduleId);
                    // Sub-modules if any
                    const sanitizedSubModules = Array.isArray(m.subModules) ? m.subModules : [];
                    for (let smIdx = 0; smIdx < sanitizedSubModules.length; smIdx++) {
                        const sm = sanitizedSubModules[smIdx];
                        if (!sm)
                            continue;
                        const smData = Object.assign(Object.assign({ examId: id, parentModuleId: moduleId, title: sm.title ? (0, shared_1.sanitizeHtml)(sm.title) : `Sub-Module ${smIdx + 1}`, description: sm.description ? (0, shared_1.sanitizeHtml)(sm.description) : null, order: sm.order !== undefined ? parseInt(sm.order) : smIdx, duration: sm.duration ? parseInt(sm.duration) : null, passingScore: sm.passingScore ? parseInt(sm.passingScore) : null }, (0, bilingualMetadata_1.moduleMetadata)(sm, shared_1.sanitizeHtml)), { gradeTarget: sm.gradeTarget ? (0, shared_1.sanitizeHtml)(sm.gradeTarget) : null });
                        const existingSubMod = sm.id
                            ? yield tx.examModule.findFirst({ where: { examId: id, OR: [{ id: sm.id }, { title: smData.title }] } })
                            : yield tx.examModule.findFirst({ where: { examId: id, parentModuleId: moduleId, title: smData.title } });
                        const candidateSubModId = (existingSubMod === null || existingSubMod === void 0 ? void 0 : existingSubMod.id) || (sm.id ? String(sm.id).trim() : null);
                        let subModUpdated = false;
                        let subModId = sm.id;
                        if (candidateSubModId) {
                            const upd = yield tx.examModule.updateMany({
                                where: { id: candidateSubModId, examId: id },
                                data: smData
                            });
                            if (upd.count > 0) {
                                subModId = candidateSubModId;
                                subModUpdated = true;
                            }
                        }
                        if (!subModUpdated) {
                            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateSubModId || '');
                            let smIdToUse = undefined;
                            if (isUuid && candidateSubModId) {
                                const ex = yield tx.examModule.findUnique({ where: { id: candidateSubModId } });
                                if (!ex)
                                    smIdToUse = candidateSubModId;
                            }
                            const createdSm = yield tx.examModule.create({
                                data: Object.assign(Object.assign({}, (smIdToUse ? { id: smIdToUse } : {})), smData)
                            });
                            subModId = createdSm.id;
                        }
                        if (sm.id)
                            moduleIdMap.set(String(sm.id).trim(), subModId);
                        moduleIdMap.set(subModId, subModId);
                        // Sub-exams inside this submodule
                        const sanitizedSmSubExams = Array.isArray(sm.subExams) ? sm.subExams : [];
                        for (let sj = 0; sj < sanitizedSmSubExams.length; sj++) {
                            const s = sanitizedSmSubExams[sj];
                            if (!s)
                                continue;
                            const sData = {
                                title: s.title ? (0, shared_1.sanitizeHtml)(s.title) : `Sub-Exam ${sj + 1}`,
                                password: s.password ? (0, shared_1.sanitizeHtml)(s.password) : null,
                                duration: s.duration ? parseInt(s.duration) : null,
                                passingScore: s.passingScore ? parseInt(s.passingScore) : null,
                                attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
                                order: s.order !== undefined ? parseInt(s.order) : sj,
                                publishDate: s.publishDate ? new Date(s.publishDate) : null,
                                cutOffDate: s.cutOffDate ? new Date(s.cutOffDate) : null
                            };
                            const existingSub = s.id
                                ? yield tx.subExam.findFirst({ where: { moduleId: subModId, OR: [{ id: s.id }, { title: sData.title }] } })
                                : yield tx.subExam.findFirst({ where: { moduleId: subModId, title: sData.title } });
                            const candidateSubId = (existingSub === null || existingSub === void 0 ? void 0 : existingSub.id) || (s.id ? String(s.id).trim() : null);
                            let subUpdated = false;
                            let subExamId = s.id;
                            if (candidateSubId) {
                                const updateSubRes = yield tx.subExam.updateMany({
                                    where: { id: candidateSubId, moduleId: subModId },
                                    data: sData
                                });
                                if (updateSubRes.count > 0) {
                                    subExamId = candidateSubId;
                                    subUpdated = true;
                                }
                            }
                            if (!subUpdated) {
                                const isValidSubUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateSubId || '');
                                let subIdToUse = undefined;
                                if (isValidSubUuid && candidateSubId) {
                                    const subAlreadyExists = yield tx.subExam.findUnique({ where: { id: candidateSubId } });
                                    if (!subAlreadyExists) {
                                        subIdToUse = candidateSubId;
                                    }
                                }
                                const createdSub = yield tx.subExam.create({
                                    data: Object.assign(Object.assign(Object.assign({}, (subIdToUse ? { id: subIdToUse } : {})), { moduleId: subModId }), sData)
                                });
                                subExamId = createdSub.id;
                            }
                            if (s.id)
                                subExamIdMap.set(String(s.id).trim(), subExamId);
                            subExamIdMap.set(subExamId, subExamId);
                        }
                    }
                    // Sub-exams
                    const sanitizedSubExams = Array.isArray(m.subExams) ? m.subExams : [];
                    for (let j = 0; j < sanitizedSubExams.length; j++) {
                        const s = sanitizedSubExams[j];
                        const sData = {
                            title: s.title ? (0, shared_1.sanitizeHtml)(s.title) : `Sub-Exam ${j + 1}`,
                            password: s.password ? (0, shared_1.sanitizeHtml)(s.password) : null,
                            duration: s.duration ? parseInt(s.duration) : null,
                            passingScore: s.passingScore ? parseInt(s.passingScore) : null,
                            attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
                            order: s.order !== undefined ? parseInt(s.order) : j,
                            publishDate: s.publishDate ? new Date(s.publishDate) : null,
                            cutOffDate: s.cutOffDate ? new Date(s.cutOffDate) : null
                        };
                        const existingSub = s.id
                            ? yield tx.subExam.findFirst({ where: { moduleId, OR: [{ id: s.id }, { title: sData.title }] } })
                            : yield tx.subExam.findFirst({ where: { moduleId, title: sData.title } });
                        const candidateSubId = (existingSub === null || existingSub === void 0 ? void 0 : existingSub.id) || (s.id ? String(s.id).trim() : null);
                        let subUpdated = false;
                        let subExamId = s.id;
                        if (candidateSubId) {
                            const updateSubRes = yield tx.subExam.updateMany({
                                where: { id: candidateSubId, moduleId },
                                data: sData
                            });
                            if (updateSubRes.count > 0) {
                                subExamId = candidateSubId;
                                subUpdated = true;
                            }
                        }
                        if (!subUpdated) {
                            const isValidSubUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateSubId || '');
                            let subIdToUse = undefined;
                            if (isValidSubUuid && candidateSubId) {
                                const subAlreadyExists = yield tx.subExam.findUnique({ where: { id: candidateSubId } });
                                if (!subAlreadyExists) {
                                    subIdToUse = candidateSubId;
                                }
                            }
                            const createdSub = yield tx.subExam.create({
                                data: Object.assign(Object.assign(Object.assign({}, (subIdToUse ? { id: subIdToUse } : {})), { moduleId }), sData)
                            });
                            subExamId = createdSub.id;
                        }
                        if (s.id)
                            subExamIdMap.set(String(s.id).trim(), subExamId);
                        subExamIdMap.set(subExamId, subExamId);
                    }
                }
                // Clean up any empty duplicate modules for this exam
                const allModulesInExam = yield tx.examModule.findMany({
                    where: { examId: id },
                    include: { _count: { select: { questions: { where: { deletedAt: null } }, subExams: true, subModules: true } } }
                });
                const seenTitleMap = new Map();
                for (const curMod of allModulesInExam) {
                    const normTitle = String(curMod.title || '').trim().toLowerCase();
                    if (!normTitle)
                        continue;
                    const groupKey = `${curMod.parentModuleId || 'root'}:${normTitle}`;
                    if (seenTitleMap.has(groupKey)) {
                        if (curMod._count.questions === 0 && curMod._count.subExams === 0 && curMod._count.subModules === 0) {
                            yield tx.examModule.deleteMany({ where: { id: curMod.id, examId: id } });
                        }
                    }
                    else {
                        seenTitleMap.set(groupKey, curMod.id);
                    }
                }
            }
            // -----------------------------
            // 1. Update basic info and schools
            yield tx.exam.update({
                where: { id },
                data: updateData
            });
            // 2. Handle questions safely without causing CASCADE DELETION of StudentAnswers
            if (Array.isArray(questions)) {
                // Fetch existing questions with their current explanation values for preservation
                const existingQuestionsWithExp = yield tx.question.findMany({
                    where: Object.assign({ examId: id, deletedAt: null }, (questionScopeId ? { subExamId: questionScopeId } : {})),
                });
                const existingQuestionMap = new Map(existingQuestionsWithExp.map(q => [q.id, q]));
                const pendingQuestions = [];
                const pendingUpdates = [];
                const existingIds = new Set(existingQuestionsWithExp.map(q => q.id));
                const existingExplanationMap = new Map(existingQuestionsWithExp.map(q => [q.id, q.explanation]));
                const explicitDeletedIds = new Set((Array.isArray(deletedQuestionIds) ? deletedQuestionIds : [])
                    .filter((questionId) => typeof questionId === 'string' && existingIds.has(questionId)));
                const existingCandidates = existingQuestionsWithExp.map((question) => ({
                    id: question.id,
                    order: question.order,
                    createdAt: question.createdAt,
                    fingerprint: (0, contentReconciliation_1.buildQuestionFingerprint)(question)
                }));
                const reservedIncomingIds = new Set(sanitizedQuestions
                    .map((question) => typeof (question === null || question === void 0 ? void 0 : question.id) === 'string' ? question.id : null)
                    .filter((questionId) => !!questionId && existingIds.has(questionId) && !explicitDeletedIds.has(questionId)));
                const usedExistingIds = new Set();
                const incomingQuestionIds = [];
                // Pre-query all currently valid modules and subExams for this exam to ensure 100% FK safety
                const existingExamModules = yield tx.examModule.findMany({
                    where: { examId: id },
                    select: { id: true }
                });
                const existingSubExams = yield tx.subExam.findMany({
                    where: { module: { examId: id } },
                    select: { id: true }
                });
                //  100% FOREIGN KEY SAFE: ONLY real DB IDs confirmed to exist in the database!
                // Unverified client IDs from incomingModuleIds or incomingSubExamIds MUST NEVER be added directly.
                const validModuleIdSet = new Set(existingExamModules.map(m => m.id));
                const validSubExamIdSet = new Set(existingSubExams.map(s => s.id));
                //  KEY FIX: Track which IDs the client explicitly sent in the payload
                // We only soft-delete questions the client KNEW about (had their ID) but chose to remove.
                // Questions sent without an ID are new — they never trigger deletions.
                for (let i = 0; i < sanitizedQuestions.length; i++) {
                    const q = sanitizedQuestions[i];
                    if (typeof (q === null || q === void 0 ? void 0 : q.id) === 'string' && explicitDeletedIds.has(q.id)) {
                        console.warn(`[Exam Update] Deletion wins over conflicting question payload: ${q.id}`);
                        continue;
                    }
                    const newExplanation = (0, examControllerSupport_1.formatExplanation)(q);
                    const newExplanationEn = q.explanationEn !== undefined
                        ? (q.explanationEn ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.explanationEn)) : null)
                        : undefined;
                    const cleanModuleId = q.moduleId ? (0, shared_1.sanitizeHtml)(String(q.moduleId).trim()) : null;
                    const cleanSubExamId = q.subExamId ? (0, shared_1.sanitizeHtml)(String(q.subExamId).trim()) : null;
                    //  Resolve client temporary or mapped IDs to actual DB IDs, strictly verifying FK existence
                    const mappedModuleId = cleanModuleId ? (moduleIdMap.get(cleanModuleId) || cleanModuleId) : null;
                    const resolvedModuleId = mappedModuleId && validModuleIdSet.has(mappedModuleId) ? mappedModuleId : null;
                    const mappedSubExamId = cleanSubExamId ? (subExamIdMap.get(cleanSubExamId) || cleanSubExamId) : null;
                    const resolvedSubExamId = mappedSubExamId && validSubExamIdSet.has(mappedSubExamId) ? mappedSubExamId : null;
                    const qData = Object.assign(Object.assign({ text: (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.text || '')), textEn: q.textEn !== undefined ? (q.textEn ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.textEn)) : null) : undefined, type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(q.type === 'QUESTION' && q.label ? q.label : q.type) ? (0, shared_1.sanitizeHtml)(q.type === 'QUESTION' && q.label ? q.label : q.type) : 'MCQ', options: (0, shared_1.extractAndSaveBase64Images)(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])), optionsEn: q.optionsEn !== undefined ? (q.optionsEn ? (0, shared_1.extractAndSaveBase64Images)(typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(q.optionsEn)) : null) : undefined, correctAnswer: (0, examControllerSupport_1.formatCorrectAnswer)(q), points: parseInt(q.points) || 1, xpPoints: parseInt(q.xpPoints) || 10 }, (0, bilingualMetadata_1.metadataTranslations)(q, shared_1.sanitizeHtml)), { skill: q.skill !== undefined ? (q.skill ? (0, shared_1.sanitizeHtml)(q.skill) : null) : undefined, learningOutcome: q.learningOutcome !== undefined ? (q.learningOutcome ? (0, shared_1.sanitizeHtml)(q.learningOutcome) : null) : undefined, standard: q.standard !== undefined ? (q.standard ? (0, shared_1.sanitizeHtml)(q.standard) : null) : undefined, indicator: q.indicator !== undefined ? (q.indicator ? (0, shared_1.sanitizeHtml)(q.indicator) : null) : undefined, videoUrl: q.videoUrl !== undefined ? (q.videoUrl ? (0, shared_1.sanitizeHtml)(q.videoUrl) : null) : undefined, level: q.level ? (0, shared_1.sanitizeHtml)(q.level) : 'Medium', dok: q.dok !== undefined ? (0, examControllerSupport_1.normalizeBackendDok)(q.dok) : undefined, cognitive: q.cognitive !== undefined ? (q.cognitive ? (0, shared_1.sanitizeHtml)(q.cognitive) : null) : undefined, course: q.course !== undefined ? (q.course ? (0, shared_1.sanitizeHtml)(q.course) : null) : undefined, section: q.section !== undefined ? (q.section ? (0, shared_1.sanitizeHtml)(q.section) : null) : undefined, domain: q.domain !== undefined ? (q.domain ? (0, shared_1.sanitizeHtml)(q.domain) : null) : undefined, subskill: q.subskill !== undefined ? (q.subskill ? (0, shared_1.sanitizeHtml)(q.subskill) : null) : undefined, microSkill: q.microSkill !== undefined ? (q.microSkill ? (0, shared_1.sanitizeHtml)(q.microSkill) : null) : undefined, gradeTarget: q.gradeTarget !== undefined ? (q.gradeTarget ? (0, shared_1.sanitizeHtml)(q.gradeTarget) : null) : undefined, errorPattern: q.errorPattern !== undefined ? (q.errorPattern ? (0, shared_1.sanitizeHtml)(q.errorPattern) : null) : undefined, estimatedTime: q.estimatedTime !== undefined ? (q.estimatedTime ? (0, shared_1.sanitizeHtml)(q.estimatedTime) : null) : undefined, explanation: newExplanation, explanationEn: newExplanationEn, hint: q.hint !== undefined ? (q.hint ? (0, shared_1.sanitizeHtml)(q.hint) : null) : undefined, hintEn: q.hintEn !== undefined ? (q.hintEn ? (0, shared_1.sanitizeHtml)(q.hintEn) : null) : undefined, imageUrl: q.imageUrl ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.imageUrl)) : null, 
                        //  FK-SAFE: strictly ensure moduleId and subExamId exist in DB or fallback to null (avoids P2003 / Question_moduleId_fkey)
                        moduleId: resolvedModuleId, subExamId: resolvedSubExamId, order: questionScopeId && typeof q.id === 'string' ? ((_b = (_a = existingQuestionMap.get(q.id)) === null || _a === void 0 ? void 0 : _a.order) !== null && _b !== void 0 ? _b : i) : i });
                    // Skip completely empty question rows that have no text in either Arabic or English and no media
                    const qNormText = (0, shared_1.robustNormalizeText)(qData.text);
                    const qNormTextEn = qData.textEn ? (0, shared_1.robustNormalizeText)(qData.textEn) : '';
                    if (qNormText.length < 2 && qNormTextEn.length < 2 && !qData.imageUrl && !qData.videoUrl) {
                        console.warn(`[Exam Update] Skipping empty question row with no text or media (index ${i})`);
                        continue;
                    }
                    const incomingFingerprint = (0, contentReconciliation_1.buildQuestionFingerprint)(qData);
                    let targetQuestionId = typeof q.id === 'string' && existingIds.has(q.id) ? q.id : undefined;
                    // POST/PUT autosave responses can be interrupted before the editor receives
                    // database IDs. Reconcile an identical ID-less row instead of inserting it again.
                    if (!targetQuestionId) {
                        targetQuestionId = (_c = (0, contentReconciliation_1.pickReconciliationCandidate)(existingCandidates.filter((candidate) => !explicitDeletedIds.has(candidate.id)), i, incomingFingerprint, reservedIncomingIds, usedExistingIds, existingExam._count.submissions === 0)) === null || _c === void 0 ? void 0 : _c.id;
                    }
                    if (targetQuestionId && usedExistingIds.has(targetQuestionId)) {
                        console.warn(`[Exam Update] Ignoring duplicate question ID in payload: ${targetQuestionId}`);
                        continue;
                    }
                    if (targetQuestionId) {
                        // Update existing question to preserve StudentAnswers
                        const updatePayload = Object.assign({}, qData);
                        //  ROOT CAUSE FIX: If the new explanation is null (frontend sent empty/[])
                        // AND the DB has an existing non-null explanation → preserve it.
                        // Only overwrite explanation if the incoming payload has real content.
                        if (updatePayload.explanation === null && q.clearExplanation !== true) {
                            const preservedExplanation = existingExplanationMap.get(targetQuestionId);
                            if (preservedExplanation) {
                                // Keep the existing explanation — don't wipe it
                                delete updatePayload.explanation;
                            }
                        }
                        const changes = (0, examPerformance_1.changedQuestionFields)(existingQuestionMap.get(targetQuestionId) || {}, updatePayload);
                        if (Object.keys(changes).length)
                            pendingUpdates.push({ id: targetQuestionId, data: changes });
                        usedExistingIds.add(targetQuestionId);
                        incomingQuestionIds.push(targetQuestionId);
                    }
                    else {
                        // Last-resort duplicate guard: before creating a new question, check if an
                        // existing un-used question already has the same normalized text or core signature.
                        // This handles autosave races and prefix variations (e.g. Question 1 (College Board):)
                        const incomingSig = (0, shared_1.getQuestionCoreSignature)(qData.text);
                        const incomingTextNorm = (0, shared_1.robustNormalizeText)(qData.text);
                        const incomingOptionsNorm = typeof qData.options === 'string' ? qData.options : JSON.stringify(qData.options || []);
                        const textDuplicateId = (incomingSig.length >= 5 || incomingTextNorm.length > 5)
                            ? (_d = existingQuestionsWithExp.find((eq) => !usedExistingIds.has(eq.id) &&
                                !explicitDeletedIds.has(eq.id) &&
                                ((incomingSig.length >= 5 && (0, shared_1.getQuestionCoreSignature)(eq.text) === incomingSig) ||
                                    (0, shared_1.robustNormalizeText)(eq.text) === incomingTextNorm) &&
                                (!eq.imageUrl || !qData.imageUrl || eq.imageUrl === qData.imageUrl) &&
                                (!eq.options || !incomingOptionsNorm || eq.options === incomingOptionsNorm))) === null || _d === void 0 ? void 0 : _d.id
                            : undefined;
                        if (textDuplicateId) {
                            console.warn(`[Exam Update] Prevented duplicate question creation – updating existing row instead: ${textDuplicateId}`);
                            const changes = (0, examPerformance_1.changedQuestionFields)(existingQuestionMap.get(textDuplicateId) || {}, qData);
                            if (Object.keys(changes).length)
                                pendingUpdates.push({ id: textDuplicateId, data: changes });
                            usedExistingIds.add(textDuplicateId);
                            incomingQuestionIds.push(textDuplicateId);
                        }
                        else {
                            // Create new question (no ID = brand new question)
                            const createdQuestion = Object.assign(Object.assign({}, qData), { examId: id, id: (0, node_crypto_1.randomUUID)() });
                            pendingQuestions.push(createdQuestion);
                            usedExistingIds.add(createdQuestion.id);
                            incomingQuestionIds.push(createdQuestion.id);
                        }
                    }
                }
                yield (0, examQuestionWrites_1.persistQuestionUpdates)(tx, id, pendingUpdates);
                for (let offset = 0; offset < pendingQuestions.length; offset += 250) {
                    yield tx.question.createMany({ data: pendingQuestions.slice(offset, offset + 250) });
                }
                // SAFE Soft-delete: only remove questions explicitly deleted by the editor UI.
                // The guard above enforces deletion policy and managed exam access.
                if (explicitDeletedIds.size) {
                    yield tx.question.updateMany({
                        where: { id: { in: Array.from(explicitDeletedIds) }, examId: id },
                        data: { deletedAt: new Date() }
                    });
                }
                // A partial autosave must not delete unseen rows. Keep those rows and append
                // them deterministically after the sequence sent by the editor, then persist
                // unique contiguous order values so every reader sees the same order.
                const activeQuestions = yield tx.question.findMany({
                    where: { examId: id, deletedAt: null },
                    select: { id: true, order: true, createdAt: true, subExamId: true }
                });
                const retainedIncomingQuestionIds = incomingQuestionIds.filter((questionId) => !explicitDeletedIds.has(questionId));
                const incomingIdSet = new Set(retainedIncomingQuestionIds);
                let orderedQuestionIds = [
                    ...retainedIncomingQuestionIds,
                    ...(0, contentReconciliation_1.sortPersistedOrder)(activeQuestions)
                        .filter((question) => !incomingIdSet.has(question.id))
                        .map((question) => question.id)
                ];
                if (questionScopeId) {
                    // Replace only the child slots; sibling relative order must survive partial saves.
                    const childSet = new Set(activeQuestions.filter(q => q.subExamId === questionScopeId).map(q => q.id));
                    const childIds = orderedQuestionIds.filter(questionId => childSet.has(questionId));
                    let childIndex = 0;
                    orderedQuestionIds = (0, contentReconciliation_1.sortPersistedOrder)(activeQuestions).map(q => q.subExamId === questionScopeId ? childIds[childIndex++] : q.id);
                }
                const orderChanges = (0, examPerformance_1.changedQuestionOrders)(activeQuestions, orderedQuestionIds);
                if (orderChanges.length) {
                    // One parameterized statement, scoped to this exam; never interpolate identifiers or values.
                    yield tx.$executeRaw `
            UPDATE "Question" AS q SET "order" = v."order", "updatedAt" = NOW()
            FROM jsonb_to_recordset(${JSON.stringify(orderChanges)}::jsonb) AS v(id text, "order" integer)
            WHERE q.id = v.id AND q."examId" = ${id} AND q."deletedAt" IS NULL
          `;
                }
            }
            // Return the updated questions with their IDs so the frontend can sync
            return tx.exam.findUnique({
                where: { id },
                include: {
                    questions: {
                        where: Object.assign({ deletedAt: null }, (questionScopeId ? { subExamId: questionScopeId } : {})),
                        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                    },
                    modules: {
                        where: { parentModuleId: null },
                        orderBy: { order: 'asc' },
                        include: {
                            subExams: { orderBy: { order: 'asc' } },
                            subModules: {
                                orderBy: { order: 'asc' },
                                include: { subExams: { orderBy: { order: 'asc' } } }
                            }
                        }
                    }
                }
            });
        }), { maxWait: 15000, timeout: 120000 });
        if (!exam) {
            return res.status(404).json({ error: 'Exam not found or has been deleted' });
        }
        const { questions: savedQuestions, modules: savedModules } = exam, examSummary = __rest(exam, ["questions", "modules"]);
        res.json({ message: 'Exam updated successfully', exam: req.query.compact === 'true' ? examSummary : exam, modules: savedModules, questions: savedQuestions });
    }
    catch (error) {
        console.error(' Exam update error:', error);
        require('fs').writeFileSync('error_log.txt', String(error) + '\n' + error.stack);
        res.status(500).json({ error: 'Error updating exam', details: error.message });
    }
});
exports.putExamHandler5 = putExamHandler5;
const deleteExamHandler6 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: { schools: { select: { id: true } } }
        });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        // Global deletion policy check
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'SUPER_ADMIN') {
            const allowed = yield (0, systemSettings_service_1.isContentDeletionAllowed)();
            if (!allowed) {
                return res.status(403).json({
                    error: 'حذف المحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.'
                });
            }
        }
        // Authorization check
        if (!(yield (0, examControllerSupport_1.canManageExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to delete this exam.' });
        }
        yield prisma_1.default.exam.update({
            where: { id },
            data: { deletedAt: new Date() }
        });
        res.json({ message: 'Exam deleted successfully' });
    }
    catch (error) {
        console.error('[Exam Delete Error]', error);
        res.status(500).json({ error: 'Error deleting exam' });
    }
});
exports.deleteExamHandler6 = deleteExamHandler6;
const postExamHandler7 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const exam = yield prisma_1.default.exam.findUnique({ where: { id } });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (req.user.role === 'SCHOOL_ADMIN' && exam.schoolId !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied: You can only restore exams belonging to your school.' });
        }
        yield prisma_1.default.exam.update({
            where: { id },
            data: { deletedAt: null }
        });
        res.json({ message: 'Exam restored successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Error restoring exam' });
    }
});
exports.postExamHandler7 = postExamHandler7;
const postExamHandler8 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const question = yield prisma_1.default.question.findUnique({
            where: { id },
            include: { exam: { select: { schoolId: true } } }
        });
        if (!question)
            return res.status(404).json({ error: 'Question not found' });
        if (req.user.role === 'SCHOOL_ADMIN' && ((_a = question.exam) === null || _a === void 0 ? void 0 : _a.schoolId) !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied: You can only restore questions belonging to your school.' });
        }
        yield prisma_1.default.question.update({
            where: { id },
            data: { deletedAt: null }
        });
        res.json({ message: 'Question restored successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Error restoring question' });
    }
});
exports.postExamHandler8 = postExamHandler8;
