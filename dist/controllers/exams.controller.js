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
exports.postExamHandler26 = exports.postExamHandler25 = exports.deleteExamHandler24 = exports.putExamHandler23 = exports.postExamHandler22 = exports.getExamHandler21 = exports.postExamHandler32 = exports.getExamHandler31 = exports.deleteExamHandler30 = exports.putExamHandler29 = exports.postExamHandler33 = exports.postExamHandler28 = exports.deleteExamHandler20 = exports.putExamHandler19 = exports.postExamHandler18 = exports.postExamHandler17 = exports.postExamHandler16 = exports.getExamHandler15 = exports.getExamHandler14 = exports.postExamHandler13 = exports.getExamHandler12 = exports.postExamHandler11 = exports.getExamHandler10 = exports.getExamHandler9 = exports.postExamHandler8 = exports.postExamHandler7 = exports.deleteExamHandler6 = exports.putExamHandler5 = exports.getExamHandler4 = exports.getExamHandler3 = exports.postExamHandler2 = exports.getExamHandler1 = exports.canManageExam = void 0;
exports.formatCorrectAnswer = formatCorrectAnswer;
exports.formatExplanation = formatExplanation;
const prisma_1 = __importDefault(require("../lib/prisma"));
const contentReconciliation_1 = require("../lib/contentReconciliation");
const examWorkflow_1 = require("../utils/examWorkflow");
const examErrorLog_1 = require("../utils/examErrorLog");
const examDeletionPolicy_1 = require("../utils/examDeletionPolicy");
const examPassingScore_1 = require("../utils/examPassingScore");
const examAccessPolicy_1 = require("../utils/examAccessPolicy");
const shared_1 = require("../shared");
const canManageExam = (user, exam) => __awaiter(void 0, void 0, void 0, function* () {
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
        // Prepare target schools
        const effectiveIsCentral = !!isCentral;
        const finalSchoolIds = req.user.role === 'SCHOOL_ADMIN'
            ? (effectiveIsCentral ? [] : [req.user.schoolId])
            : (effectiveIsCentral ? [] : (schoolIds || (schoolId ? [schoolId] : [req.user.schoolId])).filter(Boolean));
        const ownerSchoolId = req.user.role === 'SCHOOL_ADMIN'
            ? (effectiveIsCentral ? null : req.user.schoolId)
            : (effectiveIsCentral ? null : (schoolId || req.user.schoolId));
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
        const sanitizedQuestions = (0, shared_1.sanitizeDeep)(questions || []);
        const sanitizedModulesInput = Array.isArray(req.body.modules) ? req.body.modules : [];
        const exam = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
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
            // Sequential Module Creation
            const moduleIdMap = {};
            const subExamIdMap = {};
            for (let i = 0; i < sanitizedModulesInput.length; i++) {
                const m = sanitizedModulesInput[i];
                const frontendModuleId = m.id;
                const createdMod = yield tx.examModule.create({
                    data: {
                        examId: newExam.id,
                        title: m.title ? (0, shared_1.sanitizeHtml)(m.title) : `Module ${i + 1}`,
                        description: m.description ? (0, shared_1.sanitizeHtml)(m.description) : null,
                        order: m.order !== undefined ? parseInt(m.order) : i,
                        duration: m.duration ? parseInt(m.duration) : null,
                        passingScore: m.passingScore ? parseInt(m.passingScore) : null,
                        gradeTarget: m.gradeTarget ? (0, shared_1.sanitizeHtml)(m.gradeTarget) : null,
                        publishDate: m.publishDate ? new Date(m.publishDate) : null,
                        cutOffDate: m.cutOffDate ? new Date(m.cutOffDate) : null,
                    }
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
            }
            // Sequential Question Creation
            for (let index = 0; index < sanitizedQuestions.length; index++) {
                const q = sanitizedQuestions[index];
                const resolvedModuleId = q.moduleId
                    ? (moduleIdMap[(0, shared_1.sanitizeHtml)(q.moduleId)] || null)
                    : null;
                yield tx.question.create({
                    data: {
                        examId: newExam.id,
                        text: (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.text || '')),
                        type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(q.type) ? (0, shared_1.sanitizeHtml)(q.type) : 'MCQ',
                        options: (0, shared_1.extractAndSaveBase64Images)(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])),
                        correctAnswer: formatCorrectAnswer(q),
                        points: parseInt(q.points) || 1,
                        xpPoints: parseInt(q.xpPoints) || 10,
                        skill: q.skill ? (0, shared_1.sanitizeHtml)(q.skill) : null,
                        learningOutcome: q.learningOutcome ? (0, shared_1.sanitizeHtml)(q.learningOutcome) : null,
                        standard: q.standard ? (0, shared_1.sanitizeHtml)(q.standard) : null,
                        indicator: q.indicator ? (0, shared_1.sanitizeHtml)(q.indicator) : null,
                        videoUrl: q.videoUrl ? (0, shared_1.sanitizeHtml)(q.videoUrl) : null,
                        level: q.level ? (0, shared_1.sanitizeHtml)(q.level) : 'Medium',
                        dok: q.dok ? (0, shared_1.sanitizeHtml)(q.dok) : null,
                        cognitive: q.cognitive ? (0, shared_1.sanitizeHtml)(q.cognitive) : null,
                        course: q.course ? (0, shared_1.sanitizeHtml)(q.course) : null,
                        section: q.section ? (0, shared_1.sanitizeHtml)(q.section) : null,
                        domain: q.domain ? (0, shared_1.sanitizeHtml)(q.domain) : null,
                        subskill: q.subskill ? (0, shared_1.sanitizeHtml)(q.subskill) : null,
                        microSkill: q.microSkill ? (0, shared_1.sanitizeHtml)(q.microSkill) : null,
                        gradeTarget: q.gradeTarget ? (0, shared_1.sanitizeHtml)(q.gradeTarget) : null,
                        errorPattern: q.errorPattern ? (0, shared_1.sanitizeHtml)(q.errorPattern) : null,
                        estimatedTime: q.estimatedTime ? (0, shared_1.sanitizeHtml)(q.estimatedTime) : null,
                        explanation: formatExplanation(q),
                        imageUrl: q.imageUrl ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.imageUrl)) : null,
                        moduleId: resolvedModuleId,
                        subExamId: q.subExamId
                            ? (subExamIdMap[(0, shared_1.sanitizeHtml)(q.subExamId)] || null)
                            : null,
                        order: index
                    }
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
                        orderBy: { order: 'asc' },
                        include: { subExams: { orderBy: { order: 'asc' } } }
                    }
                }
            });
            return (0, shared_1.sanitizeExam)(fullExam);
        }), { maxWait: 15000, timeout: 120000 });
        res.json({ message: 'Exam created successfully', exam });
    }
    catch (error) {
        console.error('❌ Exam creation error:', error);
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
        if (isCentral === 'true') {
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
            if (grade)
                where.grade = grade;
        }
        else if (req.user.role === 'SCHOOL_ADMIN') {
            where.OR = [
                { isCentral: true },
                { schoolId: req.user.schoolId },
                { schools: { some: { id: req.user.schoolId } } }
            ];
            if (grade)
                where.grade = grade;
        }
        else if (req.user.role === 'TEACHER') {
            where.OR = [
                { creatorId: req.user.id },
                { course: { teachers: { some: { teacherId: req.user.id } } } }
            ];
            if (grade)
                where.grade = grade;
        }
        else if (req.user.role === 'STUDENT') {
            // Fetch latest user info to get current grade if not in token
            let currentGrade = req.user.grade;
            const schoolId = req.user.schoolId;
            if (currentGrade === undefined) {
                const student = yield prisma_1.default.user.findUnique({ where: { id: req.user.id } });
                currentGrade = (student === null || student === void 0 ? void 0 : student.grade) || null;
            }
            // Base filters
            const orFilters = [{ isCentral: true }];
            // Only add school filters if student belongs to a school
            if (schoolId) {
                orFilters.push({ schoolId: schoolId });
                orFilters.push({ schools: { some: { id: schoolId } } });
            }
            const studentGrades = (0, shared_1.getStudentGradeAndStage)(currentGrade);
            const gradeOrConditions = [{ grade: null }];
            for (const g of studentGrades) {
                gradeOrConditions.push({ grade: g });
                gradeOrConditions.push({ grades: { contains: `"${g}"` } });
            }
            where.AND = [
                { OR: orFilters },
                { OR: gradeOrConditions }
            ];
            where.status = 'PUBLISHED';
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
            include: {
                school: { select: { name: true } },
                schools: { select: { name: true, id: true } },
                creator: { select: { name: true } },
                _count: { select: { questions: { where: { deletedAt: null } } } },
                modules: { include: { subExams: { include: { _count: { select: { questions: { where: { deletedAt: null } } } } } }, _count: { select: { questions: { where: { deletedAt: null } } } } } }
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        res.json(exams.map((exam) => (Object.assign(Object.assign({}, exam), { modules: (exam.modules || []).map((module) => (Object.assign(Object.assign(Object.assign({}, module), (0, examWorkflow_1.countModuleContent)(module)), { availability: (0, examWorkflow_1.getAvailability)(module), subExams: (module.subExams || []).map((subExam) => {
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
        if (!existingExam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield (0, exports.canManageExam)(req.user, existingExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to edit this exam.' });
        }
        const sanitizedQuestions = (0, shared_1.sanitizeDeep)(questions || []);
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
            const effectiveIsCentral = isCentral !== undefined ? !!isCentral : existingExam.isCentral;
            updateData.isCentral = effectiveIsCentral;
            updateData.schoolId = effectiveIsCentral ? null : (req.body.schoolId || existingExam.schoolId);
            if (schoolIds !== undefined) {
                updateData.schools = {
                    set: [],
                    connect: (schoolIds || []).filter((sid) => sid && sid !== 'null').map((sid) => ({ id: sid }))
                };
            }
        }
        else {
            const effectiveIsCentral = isCentral !== undefined ? !!isCentral : existingExam.isCentral;
            updateData.isCentral = effectiveIsCentral;
            updateData.schoolId = effectiveIsCentral ? null : (existingExam.schoolId || req.user.schoolId);
        }
        const exam = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            // --- MODULES UPSERT LOGIC ---
            let incomingModuleIds = [];
            let incomingSubExamIds = [];
            let modulesProvided = false;
            if (req.body.modules !== undefined) {
                modulesProvided = true;
                const sanitizedModules = Array.isArray(req.body.modules) ? req.body.modules : [];
                incomingModuleIds = sanitizedModules.map((m) => m.id).filter(Boolean);
                // 1. Gather all incoming SubExams across all modules
                incomingSubExamIds = sanitizedModules.flatMap((m) => (m.subExams || []).map((s) => s.id)).filter(Boolean);
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
                // Upsert incoming modules
                for (let i = 0; i < sanitizedModules.length; i++) {
                    const m = sanitizedModules[i];
                    const mData = {
                        title: m.title ? (0, shared_1.sanitizeHtml)(m.title) : `Module ${i + 1}`,
                        description: m.description ? (0, shared_1.sanitizeHtml)(m.description) : null,
                        order: m.order !== undefined ? parseInt(m.order) : i,
                        duration: m.duration ? parseInt(m.duration) : null,
                        passingScore: m.passingScore ? parseInt(m.passingScore) : null,
                        gradeTarget: m.gradeTarget ? (0, shared_1.sanitizeHtml)(m.gradeTarget) : null,
                        publishDate: m.publishDate ? new Date(m.publishDate) : null,
                        cutOffDate: m.cutOffDate ? new Date(m.cutOffDate) : null
                    };
                    let moduleId = m.id;
                    if (m.id) {
                        yield tx.examModule.upsert({
                            where: { id: m.id },
                            update: mData,
                            create: Object.assign({ id: m.id, examId: id }, mData)
                        });
                    }
                    else {
                        const newMod = yield tx.examModule.create({
                            data: Object.assign({ examId: id }, mData)
                        });
                        moduleId = newMod.id;
                    }
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
                        if (s.id) {
                            yield tx.subExam.upsert({
                                where: { id: s.id },
                                update: sData,
                                create: Object.assign({ id: s.id, moduleId: moduleId }, sData)
                            });
                        }
                        else {
                            yield tx.subExam.create({
                                data: Object.assign({ moduleId: moduleId }, sData)
                            });
                        }
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
                    where: { examId: id, deletedAt: null },
                    select: {
                        id: true,
                        text: true,
                        type: true,
                        options: true,
                        correctAnswer: true,
                        explanation: true,
                        order: true,
                        createdAt: true
                    }
                });
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
                const validModuleIdSet = new Set([
                    ...existingExamModules.map(m => m.id),
                    ...(modulesProvided ? incomingModuleIds : [])
                ]);
                const validSubExamIdSet = new Set([
                    ...existingSubExams.map(s => s.id),
                    ...(modulesProvided ? incomingSubExamIds : [])
                ]);
                // ✅ KEY FIX: Track which IDs the client explicitly sent in the payload
                // We only soft-delete questions the client KNEW about (had their ID) but chose to remove.
                // Questions sent without an ID are new — they never trigger deletions.
                for (let i = 0; i < sanitizedQuestions.length; i++) {
                    const q = sanitizedQuestions[i];
                    if (typeof (q === null || q === void 0 ? void 0 : q.id) === 'string' && explicitDeletedIds.has(q.id)) {
                        console.warn(`[Exam Update] Deletion wins over conflicting question payload: ${q.id}`);
                        continue;
                    }
                    const newExplanation = formatExplanation(q);
                    const cleanModuleId = q.moduleId ? (0, shared_1.sanitizeHtml)(q.moduleId) : null;
                    const cleanSubExamId = q.subExamId ? (0, shared_1.sanitizeHtml)(q.subExamId) : null;
                    const qData = {
                        text: (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.text || '')),
                        type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(q.type === 'QUESTION' && q.label ? q.label : q.type) ? (0, shared_1.sanitizeHtml)(q.type === 'QUESTION' && q.label ? q.label : q.type) : 'MCQ',
                        options: (0, shared_1.extractAndSaveBase64Images)(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])),
                        correctAnswer: formatCorrectAnswer(q),
                        points: parseInt(q.points) || 1,
                        xpPoints: parseInt(q.xpPoints) || 10,
                        skill: q.skill !== undefined ? (q.skill ? (0, shared_1.sanitizeHtml)(q.skill) : null) : undefined,
                        learningOutcome: q.learningOutcome !== undefined ? (q.learningOutcome ? (0, shared_1.sanitizeHtml)(q.learningOutcome) : null) : undefined,
                        standard: q.standard !== undefined ? (q.standard ? (0, shared_1.sanitizeHtml)(q.standard) : null) : undefined,
                        indicator: q.indicator !== undefined ? (q.indicator ? (0, shared_1.sanitizeHtml)(q.indicator) : null) : undefined,
                        videoUrl: q.videoUrl !== undefined ? (q.videoUrl ? (0, shared_1.sanitizeHtml)(q.videoUrl) : null) : undefined,
                        level: q.level ? (0, shared_1.sanitizeHtml)(q.level) : 'Medium',
                        dok: q.dok !== undefined ? (q.dok ? (0, shared_1.sanitizeHtml)(q.dok) : null) : undefined,
                        cognitive: q.cognitive !== undefined ? (q.cognitive ? (0, shared_1.sanitizeHtml)(q.cognitive) : null) : undefined,
                        course: q.course !== undefined ? (q.course ? (0, shared_1.sanitizeHtml)(q.course) : null) : undefined,
                        section: q.section !== undefined ? (q.section ? (0, shared_1.sanitizeHtml)(q.section) : null) : undefined,
                        domain: q.domain !== undefined ? (q.domain ? (0, shared_1.sanitizeHtml)(q.domain) : null) : undefined,
                        subskill: q.subskill !== undefined ? (q.subskill ? (0, shared_1.sanitizeHtml)(q.subskill) : null) : undefined,
                        microSkill: q.microSkill !== undefined ? (q.microSkill ? (0, shared_1.sanitizeHtml)(q.microSkill) : null) : undefined,
                        gradeTarget: q.gradeTarget !== undefined ? (q.gradeTarget ? (0, shared_1.sanitizeHtml)(q.gradeTarget) : null) : undefined,
                        errorPattern: q.errorPattern !== undefined ? (q.errorPattern ? (0, shared_1.sanitizeHtml)(q.errorPattern) : null) : undefined,
                        estimatedTime: q.estimatedTime !== undefined ? (q.estimatedTime ? (0, shared_1.sanitizeHtml)(q.estimatedTime) : null) : undefined,
                        explanation: newExplanation,
                        imageUrl: q.imageUrl ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(q.imageUrl)) : null,
                        // ✅ FK-SAFE: strictly ensure moduleId and subExamId exist in validModuleIdSet / validSubExamIdSet.
                        // If stale ID, deleted module, or autosave race without modules payload, set to null to avoid P2003.
                        moduleId: cleanModuleId && validModuleIdSet.has(cleanModuleId) ? cleanModuleId : null,
                        subExamId: cleanSubExamId && validSubExamIdSet.has(cleanSubExamId) ? cleanSubExamId : null,
                        order: i
                    };
                    const incomingFingerprint = (0, contentReconciliation_1.buildQuestionFingerprint)(qData);
                    let targetQuestionId = typeof q.id === 'string' && existingIds.has(q.id) ? q.id : undefined;
                    // POST/PUT autosave responses can be interrupted before the editor receives
                    // database IDs. Reconcile an identical ID-less row instead of inserting it again.
                    if (!targetQuestionId) {
                        targetQuestionId = (_a = (0, contentReconciliation_1.pickReconciliationCandidate)(existingCandidates.filter((candidate) => !explicitDeletedIds.has(candidate.id)), i, incomingFingerprint, reservedIncomingIds, usedExistingIds, existingExam._count.submissions === 0)) === null || _a === void 0 ? void 0 : _a.id;
                    }
                    if (targetQuestionId && usedExistingIds.has(targetQuestionId)) {
                        console.warn(`[Exam Update] Ignoring duplicate question ID in payload: ${targetQuestionId}`);
                        continue;
                    }
                    if (targetQuestionId) {
                        // Update existing question to preserve StudentAnswers
                        const updatePayload = Object.assign({}, qData);
                        // ✅ ROOT CAUSE FIX: If the new explanation is null (frontend sent empty/[])
                        // AND the DB has an existing non-null explanation → preserve it.
                        // Only overwrite explanation if the incoming payload has real content.
                        if (updatePayload.explanation === null) {
                            const preservedExplanation = existingExplanationMap.get(targetQuestionId);
                            if (preservedExplanation) {
                                // Keep the existing explanation — don't wipe it
                                delete updatePayload.explanation;
                            }
                        }
                        yield tx.question.update({
                            where: { id: targetQuestionId },
                            data: updatePayload
                        });
                        usedExistingIds.add(targetQuestionId);
                        incomingQuestionIds.push(targetQuestionId);
                    }
                    else {
                        // Last-resort duplicate guard: before creating a new question, check if an
                        // existing un-used question already has the same normalized text. This handles
                        // the race where two concurrent autosaves each sent the same ID-less question
                        // before the DB id was reconciled back to the frontend.
                        const incomingTextNorm = String(qData.text || '').replace(/<[^>]+>/g, '').trim().toLowerCase();
                        const textDuplicateId = incomingTextNorm
                            ? (_b = existingQuestionsWithExp.find((eq) => !usedExistingIds.has(eq.id) &&
                                !explicitDeletedIds.has(eq.id) &&
                                String(eq.text || '').replace(/<[^>]+>/g, '').trim().toLowerCase() === incomingTextNorm)) === null || _b === void 0 ? void 0 : _b.id
                            : undefined;
                        if (textDuplicateId) {
                            console.warn(`[Exam Update] Prevented duplicate question creation – updating existing row instead: ${textDuplicateId}`);
                            yield tx.question.update({
                                where: { id: textDuplicateId },
                                data: qData,
                            });
                            usedExistingIds.add(textDuplicateId);
                            incomingQuestionIds.push(textDuplicateId);
                        }
                        else {
                            // Create new question (no ID = brand new question)
                            const createdQuestion = yield tx.question.create({
                                data: Object.assign(Object.assign({}, qData), { examId: id })
                            });
                            usedExistingIds.add(createdQuestion.id);
                            incomingQuestionIds.push(createdQuestion.id);
                        }
                    }
                }
                // SAFE Soft-delete: only remove questions explicitly deleted by the editor UI.
                // Never infer deletes from a missing question in the payload; that can happen when
                // frontend IDs are lost, and would hide existing StudentAnswers in reports.
                for (const existingId of Array.from(explicitDeletedIds)) {
                    yield tx.question.update({
                        where: { id: existingId },
                        data: { deletedAt: new Date() }
                    });
                }
                // A partial autosave must not delete unseen rows. Keep those rows and append
                // them deterministically after the sequence sent by the editor, then persist
                // unique contiguous order values so every reader sees the same order.
                const activeQuestions = yield tx.question.findMany({
                    where: { examId: id, deletedAt: null },
                    select: { id: true, order: true, createdAt: true }
                });
                const retainedIncomingQuestionIds = incomingQuestionIds.filter((questionId) => !explicitDeletedIds.has(questionId));
                const incomingIdSet = new Set(retainedIncomingQuestionIds);
                const orderedQuestionIds = [
                    ...retainedIncomingQuestionIds,
                    ...(0, contentReconciliation_1.sortPersistedOrder)(activeQuestions)
                        .filter((question) => !incomingIdSet.has(question.id))
                        .map((question) => question.id)
                ];
                for (let order = 0; order < orderedQuestionIds.length; order++) {
                    yield tx.question.update({
                        where: { id: orderedQuestionIds[order] },
                        data: { order }
                    });
                }
            }
            // Return the updated questions with their IDs so the frontend can sync
            return tx.exam.findUnique({
                where: { id },
                include: {
                    questions: {
                        where: { deletedAt: null },
                        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                    },
                    modules: {
                        orderBy: { order: 'asc' },
                        include: { subExams: { orderBy: { order: 'asc' } } }
                    }
                }
            });
        }), { maxWait: 15000, timeout: 120000 });
        res.json({ message: 'Exam updated successfully', exam, modules: exam === null || exam === void 0 ? void 0 : exam.modules, questions: exam === null || exam === void 0 ? void 0 : exam.questions });
    }
    catch (error) {
        console.error('❌ Exam update error:', error);
        require('fs').writeFileSync('error_log.txt', String(error) + '\n' + error.stack);
        res.status(500).json({ error: 'Error updating exam', details: error.message });
    }
});
exports.putExamHandler5 = putExamHandler5;
const deleteExamHandler6 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: { schools: { select: { id: true } } }
        });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        // Authorization check
        if (req.user.role === 'SCHOOL_ADMIN' && exam.schoolId !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied: You can only delete exams belonging to your school.' });
        }
        yield prisma_1.default.exam.update({
            where: { id },
            data: { deletedAt: new Date() }
        });
        res.json({ message: 'Exam deleted successfully' });
    }
    catch (error) {
        console.error('❌ Delete error:', error);
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
const getExamHandler9 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: {
                schools: true,
                modules: {
                    include: {
                        subExams: true
                    },
                    orderBy: { order: 'asc' }
                },
                questions: {
                    select: { id: true, text: true, moduleId: true, subExamId: true, type: true, points: true }
                }
            }
        });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        // Check permission
        if (!(yield (0, exports.canManageExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const where = { examId: id };
        if (req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'TEACHER') {
            where.user = { schoolId: req.user.schoolId };
        }
        const submissions = yield prisma_1.default.examSubmission.findMany({
            where,
            include: {
                user: {
                    select: { id: true, name: true, schoolId: true, school: { select: { name: true } } }
                },
                answers: {
                    select: { questionId: true, isCorrect: true }
                }
            }
        });
        // 1. Overall Stats
        const totalSubmissions = submissions.length;
        const passCount = submissions.filter(s => (s.percentage || 0) >= (exam.passingScore || 50)).length;
        const passRate = totalSubmissions > 0 ? (passCount / totalSubmissions) * 100 : 0;
        const avgScore = totalSubmissions > 0 ? submissions.reduce((acc, s) => acc + (s.percentage || 0), 0) / totalSubmissions : 0;
        const totalExamPoints = exam.questions.reduce((acc, q) => acc + (q.points || 1), 0);
        // 2. Module Stats
        const moduleStats = exam.modules.map(mod => {
            const modQuestions = exam.questions.filter(q => q.moduleId === mod.id).map(q => q.id);
            let correctAnswers = 0;
            let totalAnswers = 0;
            submissions.forEach(sub => {
                sub.answers.forEach(ans => {
                    if (modQuestions.includes(ans.questionId)) {
                        totalAnswers++;
                        if (ans.isCorrect)
                            correctAnswers++;
                    }
                });
            });
            return {
                id: mod.id,
                title: mod.title,
                correctRate: totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0,
                totalAnswers
            };
        });
        // 3. SubExam Stats
        const subExamStats = exam.modules.flatMap(m => m.subExams || []).map(se => {
            const seQuestions = exam.questions.filter(q => q.subExamId === se.id).map(q => q.id);
            let correctAnswers = 0;
            let totalAnswers = 0;
            submissions.forEach(sub => {
                sub.answers.forEach(ans => {
                    if (seQuestions.includes(ans.questionId)) {
                        totalAnswers++;
                        if (ans.isCorrect)
                            correctAnswers++;
                    }
                });
            });
            return {
                id: se.id,
                title: se.title,
                moduleId: se.moduleId,
                correctRate: totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0,
                totalAnswers
            };
        });
        // 4. Question Stats
        const questionStats = exam.questions.map(q => {
            let correctAnswers = 0;
            let totalAnswers = 0;
            submissions.forEach(sub => {
                const ans = sub.answers.find(a => a.questionId === q.id);
                if (ans) {
                    totalAnswers++;
                    if (ans.isCorrect)
                        correctAnswers++;
                }
            });
            return {
                id: q.id,
                text: q.text,
                type: q.type,
                moduleId: q.moduleId,
                subExamId: q.subExamId,
                correctRate: totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0
            };
        }).sort((a, b) => b.correctRate - a.correctRate); // Easiest to hardest
        // 5. School Stats (For Super Admin)
        const schoolStats = [];
        if (req.user.role === 'SUPER_ADMIN') {
            const schoolsMap = {};
            submissions.forEach(sub => {
                var _a;
                const sId = sub.user.schoolId || 'unassigned';
                const sName = ((_a = sub.user.school) === null || _a === void 0 ? void 0 : _a.name) || 'Unassigned';
                if (!schoolsMap[sId]) {
                    schoolsMap[sId] = { id: sId, name: sName, count: 0, totalScore: 0 };
                }
                schoolsMap[sId].count++;
                schoolsMap[sId].totalScore += (sub.percentage || 0);
            });
            for (const key in schoolsMap) {
                schoolStats.push({
                    id: schoolsMap[key].id,
                    name: schoolsMap[key].name,
                    count: schoolsMap[key].count,
                    avgScore: schoolsMap[key].totalScore / schoolsMap[key].count
                });
            }
        }
        res.json({
            exam: {
                id: exam.id,
                title: exam.title,
                totalPoints: totalExamPoints,
                questionsCount: exam.questions.length
            },
            overall: {
                totalSubmissions,
                passRate,
                avgScore
            },
            modules: moduleStats,
            subExams: subExamStats,
            questions: questionStats,
            schools: schoolStats,
            students: submissions.map(s => {
                var _a;
                return ({
                    id: s.id,
                    userId: s.user.id,
                    name: s.user.name,
                    schoolName: (_a = s.user.school) === null || _a === void 0 ? void 0 : _a.name,
                    score: s.totalScore,
                    percentage: s.percentage,
                    createdAt: s.createdAt
                });
            })
        });
    }
    catch (error) {
        console.error('Error generating analytics:', error);
        res.status(500).json({ error: 'Failed to generate analytics' });
    }
});
exports.getExamHandler9 = getExamHandler9;
const getExamHandler10 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : null;
        const queryStartTime = Date.now();
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id, deletedAt: null },
            include: {
                schools: { select: { id: true, name: true } },
                modules: { orderBy: { order: 'asc' }, include: { subExams: { orderBy: { order: 'asc' }, include: { _count: { select: { questions: { where: { deletedAt: null } } } } } } } },
                questions: {
                    where: subExamId ? { subExamId, deletedAt: null } : { deletedAt: null },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                }
            }
        });
        const queryDuration = Date.now() - queryStartTime;
        if (queryDuration > 1000) {
            console.log(`[Exam GET] Exam "${(exam === null || exam === void 0 ? void 0 : exam.title) || id}" query took ${queryDuration}ms (${((_a = exam === null || exam === void 0 ? void 0 : exam.questions) === null || _a === void 0 ? void 0 : _a.length) || 0} questions)`);
        }
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        const role = req.user.role;
        const userId = req.user.id;
        const userSchoolId = req.user.schoolId;
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
            const canAccessExam = yield (0, exports.canManageExam)(req.user, exam);
            if (!canAccessExam) {
                return res.status(403).json({ error: 'Access denied (Role: ' + role + ', isCentral: ' + exam.isCentral + ')' });
            }
        }
        const selectedSubExam = subExamId
            ? exam.modules.flatMap((module) => module.subExams || []).find((subExam) => subExam.id === subExamId)
            : null;
        if (subExamId && !selectedSubExam)
            return res.status(404).json({ error: 'Exam section not found' });
        let parsedQuestions = exam.questions.map(q => {
            let options = [];
            try {
                options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
            }
            catch (e) {
                options = [];
            }
            return Object.assign(Object.assign({}, q), { options });
        });
        // If student, hide correct answers
        const activePassword = (0, examWorkflow_1.resolveExamAccessPassword)(exam, selectedSubExam);
        if (req.user.role === 'STUDENT') {
            const sanitizedQuestions = parsedQuestions.map(q => {
                const { correctAnswer, explanation } = q, rest = __rest(q, ["correctAnswer", "explanation"]);
                return rest;
            });
            return res.json(Object.assign(Object.assign({}, (0, shared_1.sanitizeExam)(exam)), { selectedSubExam, password: activePassword ? true : null, questions: sanitizedQuestions }));
        }
        res.json(Object.assign(Object.assign({}, (0, shared_1.sanitizeExam)(exam)), { selectedSubExam, password: activePassword, questions: parsedQuestions }));
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
                modules: { include: { subExams: true } },
                _count: {
                    select: { submissions: { where: { userId } } }
                }
            }
        });
        if (!exam)
            return res.status(404).json({ error: 'الامتحان غير موجود' });
        const selectedSubExam = subExamId
            ? exam.modules.flatMap((module) => module.subExams || []).find((subExam) => subExam.id === subExamId)
            : null;
        if (subExamId && !selectedSubExam)
            return res.status(404).json({ error: 'الاختبار غير موجود داخل هذا الموديول.' });
        const accessUser = req.user.role === 'STUDENT'
            ? (0, examWorkflow_1.mergeStudentProfile)(req.user, yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { grade: true, schoolId: true } }))
            : req.user;
        if (req.user.role === 'STUDENT' && !(0, shared_1.examMatchesStudent)(exam, accessUser)) {
            return res.status(403).json({ error: 'هذا الامتحان غير مخصص لك.', type: 'ACCESS_DENIED' });
        }
        // 1. Check Dates (skip for admins and teachers testing)
        const isAdminOrTeacher = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR'].includes(req.user.role);
        const now = new Date();
        if (!isAdminOrTeacher && exam.startDate && now < new Date(exam.startDate)) {
            return res.status(403).json({ error: 'الامتحان لم يبدأ بعد.', type: 'EARLY_ACCESS' });
        }
        if (!isAdminOrTeacher && exam.endDate && now > new Date(exam.endDate)) {
            return res.status(403).json({ error: 'انتهى موعد الامتحان.', type: 'EXPIRED' });
        }
        if (!isAdminOrTeacher && selectedSubExam && (0, examWorkflow_1.getAvailability)(selectedSubExam, now) !== 'AVAILABLE') {
            return res.status(403).json({ error: (0, examWorkflow_1.getAvailability)(selectedSubExam, now) === 'UPCOMING' ? 'لم يبدأ هذا الاختبار بعد.' : 'انتهى موعد هذا الاختبار.', type: (0, examWorkflow_1.getAvailability)(selectedSubExam, now) });
        }
        // 2. Check Attempts (999 means unlimited)
        const submissionCount = yield prisma_1.default.examSubmission.count({ where: Object.assign({ examId, userId }, (subExamId ? { subExamId } : {})) });
        const attemptsAllowed = (_b = selectedSubExam === null || selectedSubExam === void 0 ? void 0 : selectedSubExam.attemptsAllowed) !== null && _b !== void 0 ? _b : exam.attemptsAllowed;
        if (!isAdminOrTeacher && attemptsAllowed !== 999 && submissionCount >= attemptsAllowed) {
            return res.status(403).json({ error: 'لقد استنفدت عدد المحاولات المسموح بها لهذا الامتحان.', type: 'ATTEMPTS_EXCEEDED' });
        }
        // 3. Check Password
        const requiredPassword = (0, examWorkflow_1.resolveExamAccessPassword)(exam, selectedSubExam);
        if (!isAdminOrTeacher && requiredPassword && requiredPassword !== password) {
            return res.status(403).json({ error: 'كلمة السر غير صحيحة.', type: 'INVALID_PASSWORD' });
        }
        res.json({ success: true, message: 'تم التحقق من الوصول بنجاح.' });
    }
    catch (error) {
        res.status(500).json({ error: 'خطأ في التحقق من الوصول.' });
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
            select: { attemptsAllowed: true, modules: { select: { subExams: { where: subExamId ? { id: subExamId } : undefined, select: { attemptsAllowed: true } } } } }
        });
        const submissionCount = yield prisma_1.default.examSubmission.count({
            where: Object.assign({ examId, userId }, (subExamId ? { subExamId } : {}))
        });
        const lastSubmission = yield prisma_1.default.examSubmission.findFirst({
            where: Object.assign({ examId, userId }, (subExamId ? { subExamId } : {})),
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        const selectedAttemptsAllowed = (_a = exam === null || exam === void 0 ? void 0 : exam.modules.flatMap((module) => module.subExams || [])[0]) === null || _a === void 0 ? void 0 : _a.attemptsAllowed;
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
        return res.status(429).json({ error: 'جاري تسليم الامتحان... الرجاء الانتظار.' });
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
                id: true, attemptsAllowed: true, isCentral: true, schoolId: true,
                startDate: true, endDate: true, resultVisibility: true, password: true,
                grade: true, grades: true,
                schools: { select: { id: true } },
                modules: { include: { subExams: true } },
                questions: {
                    where: { deletedAt: null },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                    select: { id: true, points: true, correctAnswer: true, type: true, order: true, xpPoints: true, options: true, subExamId: true }
                }
            }
        });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        const selectedSubExam = subExamId
            ? exam.modules.flatMap((module) => module.subExams || []).find((subExam) => subExam.id === subExamId)
            : null;
        if (subExamId && !selectedSubExam)
            return res.status(404).json({ error: 'Exam section not found' });
        const accessUser = req.user.role === 'STUDENT'
            ? (0, examWorkflow_1.mergeStudentProfile)(req.user, yield prisma_1.default.user.findUnique({ where: { id: req.user.id }, select: { grade: true, schoolId: true } }))
            : req.user;
        if (req.user.role === 'STUDENT' && !(0, shared_1.examMatchesStudent)(exam, accessUser)) {
            return res.status(403).json({ error: 'هذا الامتحان غير مخصص لك.' });
        }
        const isAdminOrTeacher = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(req.user.role);
        const attemptsAllowed = (_a = selectedSubExam === null || selectedSubExam === void 0 ? void 0 : selectedSubExam.attemptsAllowed) !== null && _a !== void 0 ? _a : exam.attemptsAllowed;
        if (!isAdminOrTeacher && attemptsAllowed !== 999 && submissionCount >= attemptsAllowed) {
            return res.status(400).json({ error: 'لقد استنفدت عدد المحاولات المسموح بها لهذا الامتحان.' });
        }
        // Check dates again on submission (skip for admins and teachers testing)
        const now = new Date();
        if (!isAdminOrTeacher && exam.startDate && now < new Date(exam.startDate)) {
            return res.status(403).json({ error: 'الامتحان لم يبدأ بعد.' });
        }
        if (!isAdminOrTeacher && exam.endDate && now > new Date(exam.endDate)) {
            return res.status(403).json({ error: 'انتهى موعد الامتحان.' });
        }
        if (!isAdminOrTeacher && selectedSubExam && (0, examWorkflow_1.getAvailability)(selectedSubExam, now) !== 'AVAILABLE') {
            return res.status(403).json({ error: (0, examWorkflow_1.getAvailability)(selectedSubExam, now) === 'UPCOMING' ? 'لم يبدأ هذا الاختبار بعد.' : 'انتهى موعد هذا الاختبار.' });
        }
        const requiredPassword = (0, examWorkflow_1.resolveExamAccessPassword)(exam, selectedSubExam);
        if (requiredPassword && requiredPassword !== password) {
            return res.status(403).json({ error: 'كلمة السر غير صحيحة.' });
        }
        exam.questions = subExamId ? exam.questions.filter((question) => question.subExamId === subExamId) : exam.questions;
        if (exam.questions.length === 0) {
            return res.status(400).json({ error: 'لا يمكن تسليم امتحان بدون أسئلة.' });
        }
        let totalScore = 0;
        let maxPossibleScore = 0;
        const studentAnswersData = [];
        exam.questions.forEach(q => {
            maxPossibleScore += q.points;
            const studentAnswer = answers.find((a) => a.questionId === q.id);
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
            return res.status(400).json({ error: 'لا يمكن تصحيح امتحان بدون درجات.' });
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
        sortedQuestions.forEach(q => {
            const sa = studentAnswersData.find((a) => a.questionId === q.id);
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
        const submission = yield prisma_1.default.examSubmission.create({
            data: {
                examId,
                subExamId,
                userId,
                totalScore,
                percentage,
                totalTime: totalTime || 0,
                answers: {
                    create: studentAnswersData.map(a => ({
                        userId,
                        questionId: a.questionId,
                        selectedAnswer: a.selectedAnswer,
                        isCorrect: a.isCorrect
                    }))
                }
            },
            include: {
                answers: {
                    include: {
                        question: true
                    }
                }
            }
        });
        // Save XPHistory log entries in bulk
        const xpHistoryData = exam.questions.map(q => {
            const sa = studentAnswersData.find((a) => a.questionId === q.id);
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
        shared_1.statsCache.delete(`student_stats_${userId}`);
        res.json({
            message: 'Exam submitted successfully',
            submissionId: submission.id,
            score: totalScore,
            percentage: percentage,
            earnedXP: regularXP,
            bonusXP,
            currentStreak: isFirstExamAttempt ? maxStreak : 0,
            resultVisibility: exam.resultVisibility,
            details: (exam.resultVisibility === 'SHOW_ANSWERS' || exam.resultVisibility === 'SHOW_ALL') ? submission.answers : null
        });
    }
    catch (error) {
        console.error('❌ Submission error:', error);
        res.status(500).json({ error: 'Error submitting exam', details: error.message });
    }
    finally {
        (0, shared_1.releaseLock)(lockKey);
    }
});
exports.postExamHandler13 = postExamHandler13;
const getExamHandler14 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const submission = yield prisma_1.default.examSubmission.findUnique({
            where: { id },
            include: {
                exam: {
                    include: {
                        questions: {
                            where: { deletedAt: null },
                            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                        }
                    }
                },
                user: { select: { name: true, role: true, schoolId: true } },
                answers: {
                    where: { question: { deletedAt: null } },
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
        // Authorization check
        const role = req.user.role;
        if (!['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR', 'STUDENT'].includes(role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (role === 'STUDENT' && submission.userId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (role === 'SCHOOL_ADMIN' && submission.user.schoolId !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if ((role === 'TEACHER' || role === 'SUPERVISOR') && submission.user.schoolId !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const buildSubmissionXpStats = (targetSubmission, targetAnswers) => __awaiter(void 0, void 0, void 0, function* () {
            const answerQuestionIds = targetAnswers.map((answer) => answer.questionId);
            const relevantQuestions = targetSubmission.exam.questions.filter((question) => {
                if (targetSubmission.subExamId) {
                    return question.subExamId === targetSubmission.subExamId && answerQuestionIds.includes(question.id);
                }
                return answerQuestionIds.includes(question.id);
            });
            const previousAttemptsCount = yield prisma_1.default.examSubmission.count({
                where: {
                    userId: targetSubmission.userId,
                    examId: targetSubmission.examId,
                    subExamId: targetSubmission.subExamId || null,
                    createdAt: { lt: targetSubmission.createdAt }
                }
            });
            const isFirstAttemptForThisSubmission = previousAttemptsCount === 0;
            const orderedAnswers = [...targetAnswers].sort((a, b) => {
                var _a, _b, _c, _d;
                const aOrder = (_b = (_a = relevantQuestions.find((question) => question.id === a.questionId)) === null || _a === void 0 ? void 0 : _a.order) !== null && _b !== void 0 ? _b : 0;
                const bOrder = (_d = (_c = relevantQuestions.find((question) => question.id === b.questionId)) === null || _c === void 0 ? void 0 : _c.order) !== null && _d !== void 0 ? _d : 0;
                return aOrder - bOrder;
            });
            let regularXP = 0;
            let dynamicTotalScore = 0;
            let streakCounter = 0;
            let hasStreak5 = false;
            let hasStreak10 = false;
            orderedAnswers.forEach((answer) => {
                const answerQuestion = relevantQuestions.find((question) => question.id === answer.questionId);
                if (!answerQuestion)
                    return;
                if (answer.isCorrect) {
                    streakCounter++;
                    dynamicTotalScore += Number(answerQuestion.points) || 0;
                    if (streakCounter === 5)
                        hasStreak5 = true;
                    if (streakCounter === 10)
                        hasStreak10 = true;
                    if (isFirstAttemptForThisSubmission) {
                        regularXP += answerQuestion.xpPoints !== undefined ? Number(answerQuestion.xpPoints) : 10;
                    }
                }
                else {
                    streakCounter = 0;
                }
            });
            const bonusXP = isFirstAttemptForThisSubmission ? ((hasStreak5 ? 10 : 0) + (hasStreak10 ? 30 : 0)) : 0;
            return {
                earnedXP: regularXP + bonusXP,
                dynamicTotalScore,
                totalPoints: relevantQuestions.reduce((acc, question) => acc + (Number(question.points) || 0), 0),
                correctAnswers: orderedAnswers.filter((answer) => answer.isCorrect).length,
                totalQuestions: relevantQuestions.length,
            };
        });
        // Apply Result Policy for Students
        if (req.user.role === 'STUDENT') {
            const policy = submission.exam.resultVisibility;
            if (policy === 'HIDE_ALL') {
                return res.json({
                    id: submission.id,
                    createdAt: submission.createdAt,
                    exam: { title: submission.exam.title, skill: submission.exam.skill, level: submission.exam.level },
                    message: 'سيتم إظهار النتائج لاحقاً',
                    policy: 'HIDE_ALL'
                });
            }
            const sanitizedAnswers = submission.answers.map(ans => {
                let options = [];
                try {
                    options = typeof ans.question.options === 'string' ? JSON.parse(ans.question.options) : ans.question.options;
                }
                catch (e) {
                    options = [];
                }
                const baseAnswer = {
                    id: ans.id,
                    selectedAnswer: ans.selectedAnswer,
                    isCorrect: ans.isCorrect,
                    question: {
                        text: ans.question.text,
                        options,
                        points: ans.question.points,
                        explanation: (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') ? ans.question.explanation : null
                    }
                };
                if (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') {
                    return Object.assign(Object.assign({}, baseAnswer), { question: Object.assign(Object.assign({}, baseAnswer.question), { correctAnswer: ans.question.correctAnswer }) });
                }
                if (policy === 'SHOW_MARK_ONLY') {
                    return baseAnswer;
                }
                return { id: ans.id }; // For SHOW_SCORE, we don't return answers
            });
            const submissionXpStats = yield buildSubmissionXpStats(submission, submission.answers);
            const safeExam = Object.assign({}, submission.exam);
            safeExam.totalPoints = submissionXpStats.totalPoints;
            if (subExamDetails) {
                safeExam.passingScore = (0, examPassingScore_1.resolvePassingScore)(safeExam.passingScore, subExamDetails.passingScore);
                safeExam.duration = subExamDetails.duration;
            }
            delete safeExam.questions;
            const dynamicPercentage = submissionXpStats.totalPoints > 0 ? (submissionXpStats.dynamicTotalScore / submissionXpStats.totalPoints) * 100 : 0;
            return res.json(Object.assign(Object.assign({}, submission), { totalScore: submissionXpStats.dynamicTotalScore, percentage: dynamicPercentage, exam: safeExam, answers: policy === 'SHOW_SCORE' ? [] : sanitizedAnswers, earnedXP: submissionXpStats.earnedXP, correctAnswers: submissionXpStats.correctAnswers, totalQuestions: submissionXpStats.totalQuestions }));
        }
        // Admins see everything
        const parsedAnswers = submission.answers.map(ans => {
            let options = [];
            try {
                options = typeof ans.question.options === 'string' ? JSON.parse(ans.question.options) : ans.question.options;
            }
            catch (e) {
                options = [];
            }
            return Object.assign(Object.assign({}, ans), { question: Object.assign(Object.assign({}, ans.question), { options }) });
        });
        const submissionXpStats = yield buildSubmissionXpStats(submission, submission.answers);
        if (subExamDetails) {
            submission.exam.passingScore = (0, examPassingScore_1.resolvePassingScore)(submission.exam.passingScore, subExamDetails.passingScore);
            submission.exam.duration = subExamDetails.duration;
        }
        submission.exam.totalPoints = submissionXpStats.totalPoints;
        const dynamicPercentage = submissionXpStats.totalPoints > 0 ? (submissionXpStats.dynamicTotalScore / submissionXpStats.totalPoints) * 100 : 0;
        res.json(Object.assign(Object.assign({}, submission), { totalScore: submissionXpStats.dynamicTotalScore, percentage: dynamicPercentage, answers: parsedAnswers, earnedXP: submissionXpStats.earnedXP, correctAnswers: submissionXpStats.correctAnswers, totalQuestions: submissionXpStats.totalQuestions }));
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
        if (!(yield (0, exports.canManageExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const where = { examId: id };
        if (req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'TEACHER') {
            where.user = { schoolId: req.user.schoolId };
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
        console.error('❌ Restore exam error:', error);
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
        console.error('❌ Restore question error:', error);
        res.status(500).json({ error: 'Error restoring question' });
    }
});
exports.postExamHandler17 = postExamHandler17;
const postExamHandler18 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, description, order, duration, passingScore } = req.body;
        if (!title)
            return res.status(400).json({ error: 'Title is required' });
        const exam = yield prisma_1.default.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield (0, exports.canManageExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
        }
        const module = yield prisma_1.default.examModule.create({
            data: {
                examId: id,
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
        const { title, description, order, duration, passingScore, gradeTarget } = req.body;
        const exam = yield prisma_1.default.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield (0, exports.canManageExam)(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
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
    try {
        const { id, moduleId } = req.params;
        const exam = yield prisma_1.default.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield (0, exports.canManageExam)(req.user, exam))) {
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
            select: { id: true },
        });
        if (sourceQuestions.length > 0) {
            yield prisma_1.default.question.updateMany({
                where: { id: { in: sourceQuestions.map((question) => question.id) } },
                data: { moduleId, subExamId },
            });
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
const deleteExamHandler30 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId, subExamId } = req.params;
        const parent = yield prisma_1.default.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
        if (!parent)
            return res.status(404).json({ error: 'Exam module not found' });
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.question.updateMany({
                where: { examId: id, subExamId },
                data: { subExamId: null },
            });
            yield tx.subExam.delete({
                where: { id: subExamId },
            });
        }));
        res.json({ message: 'Exam deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting child exam:', error);
        res.status(500).json({ error: 'Failed to delete exam inside module' });
    }
});
exports.deleteExamHandler30 = deleteExamHandler30;
const getExamHandler31 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, moduleId, subExamId } = req.params;
        const parent = yield prisma_1.default.examModule.findFirst({
            where: { id: moduleId, examId: id },
            select: { id: true, title: true, examId: true }
        });
        if (!parent)
            return res.status(404).json({ error: 'Exam module not found' });
        const subExam = yield prisma_1.default.subExam.findFirst({
            where: { id: subExamId, moduleId },
            include: {
                questions: {
                    where: { deletedAt: null },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                }
            }
        });
        if (!subExam)
            return res.status(404).json({ error: 'Exam not found inside module' });
        const payload = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            module: {
                id: parent.id,
                title: parent.title,
            },
            exam: {
                title: subExam.title,
                password: subExam.password,
                duration: subExam.duration,
                passingScore: subExam.passingScore,
                attemptsAllowed: subExam.attemptsAllowed,
                publishDate: subExam.publishDate ? subExam.publishDate.toISOString() : null,
                cutOffDate: subExam.cutOffDate ? subExam.cutOffDate.toISOString() : null,
            },
            questions: subExam.questions.map((question) => ({
                text: question.text,
                type: question.type,
                options: question.options,
                correctAnswer: question.correctAnswer,
                points: question.points,
                xpPoints: question.xpPoints,
                skill: question.skill,
                learningOutcome: question.learningOutcome,
                indicator: question.indicator,
                videoUrl: question.videoUrl,
                level: question.level,
                dok: question.dok,
                cognitive: question.cognitive,
                course: question.course,
                section: question.section,
                domain: question.domain,
                standard: question.standard,
                subskill: question.subskill,
                microSkill: question.microSkill,
                gradeTarget: question.gradeTarget,
                errorPattern: question.errorPattern,
                estimatedTime: question.estimatedTime,
                explanation: question.explanation,
                imageUrl: question.imageUrl,
                order: question.order,
            })),
        };
        const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
        const fileName = `${String(subExam.title || 'exam').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'exam'}_backup.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    }
    catch (error) {
        console.error('Error exporting module exam JSON:', error);
        res.status(500).json({ error: 'Failed to export exam JSON' });
    }
});
exports.getExamHandler31 = getExamHandler31;
const postExamHandler32 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id, moduleId } = req.params;
        const rawPayload = (_a = req.body) === null || _a === void 0 ? void 0 : _a.exportData;
        const parsedPayload = typeof rawPayload === 'string'
            ? JSON.parse(rawPayload)
            : rawPayload;
        if (!((_b = parsedPayload === null || parsedPayload === void 0 ? void 0 : parsedPayload.exam) === null || _b === void 0 ? void 0 : _b.title)) {
            return res.status(400).json({ error: 'Invalid exam JSON payload' });
        }
        const parent = yield prisma_1.default.examModule.findFirst({
            where: { id: moduleId, examId: id },
            select: { id: true }
        });
        if (!parent)
            return res.status(404).json({ error: 'Exam module not found' });
        const questions = Array.isArray(parsedPayload.questions) ? parsedPayload.questions : [];
        const createdSubExam = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const created = yield tx.subExam.create({
                data: {
                    moduleId,
                    title: (0, shared_1.sanitizeHtml)(String(parsedPayload.exam.title).trim()),
                    password: parsedPayload.exam.password ? (0, shared_1.sanitizeHtml)(String(parsedPayload.exam.password).trim()) : null,
                    duration: parsedPayload.exam.duration ? parseInt(parsedPayload.exam.duration) : null,
                    passingScore: parsedPayload.exam.passingScore ? parseInt(parsedPayload.exam.passingScore) : null,
                    attemptsAllowed: parsedPayload.exam.attemptsAllowed ? parseInt(parsedPayload.exam.attemptsAllowed) || 1 : 1,
                    order: yield tx.subExam.count({ where: { moduleId } }),
                    publishDate: parsedPayload.exam.publishDate ? new Date(parsedPayload.exam.publishDate) : null,
                    cutOffDate: parsedPayload.exam.cutOffDate ? new Date(parsedPayload.exam.cutOffDate) : null,
                }
            });
            for (let index = 0; index < questions.length; index++) {
                const question = (0, shared_1.sanitizeDeep)(questions[index] || {});
                yield tx.question.create({
                    data: {
                        examId: id,
                        moduleId,
                        subExamId: created.id,
                        text: (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(question.text || '')),
                        type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(question.type) ? (0, shared_1.sanitizeHtml)(question.type) : 'MCQ',
                        options: (0, shared_1.extractAndSaveBase64Images)(typeof question.options === 'string' ? question.options : JSON.stringify(question.options || [])),
                        correctAnswer: formatCorrectAnswer(question),
                        points: parseInt(question.points) || 1,
                        xpPoints: parseInt(question.xpPoints) || 10,
                        skill: question.skill ? (0, shared_1.sanitizeHtml)(question.skill) : null,
                        learningOutcome: question.learningOutcome ? (0, shared_1.sanitizeHtml)(question.learningOutcome) : null,
                        indicator: question.indicator ? (0, shared_1.sanitizeHtml)(question.indicator) : null,
                        videoUrl: question.videoUrl ? (0, shared_1.sanitizeHtml)(question.videoUrl) : null,
                        level: question.level ? (0, shared_1.sanitizeHtml)(question.level) : 'Medium',
                        dok: question.dok ? (0, shared_1.sanitizeHtml)(question.dok) : null,
                        cognitive: question.cognitive ? (0, shared_1.sanitizeHtml)(question.cognitive) : null,
                        course: question.course ? (0, shared_1.sanitizeHtml)(question.course) : null,
                        section: question.section ? (0, shared_1.sanitizeHtml)(question.section) : null,
                        domain: question.domain ? (0, shared_1.sanitizeHtml)(question.domain) : null,
                        standard: question.standard ? (0, shared_1.sanitizeHtml)(question.standard) : null,
                        subskill: question.subskill ? (0, shared_1.sanitizeHtml)(question.subskill) : null,
                        microSkill: question.microSkill ? (0, shared_1.sanitizeHtml)(question.microSkill) : null,
                        gradeTarget: question.gradeTarget ? (0, shared_1.sanitizeHtml)(question.gradeTarget) : null,
                        errorPattern: question.errorPattern ? (0, shared_1.sanitizeHtml)(question.errorPattern) : null,
                        estimatedTime: question.estimatedTime ? (0, shared_1.sanitizeHtml)(question.estimatedTime) : null,
                        explanation: formatExplanation(question),
                        imageUrl: question.imageUrl ? (0, shared_1.extractAndSaveBase64Images)((0, shared_1.sanitizeHtml)(question.imageUrl)) : null,
                        order: question.order !== undefined ? parseInt(question.order) : index,
                    }
                });
            }
            return tx.subExam.findUnique({
                where: { id: created.id },
                include: {
                    _count: { select: { questions: { where: { deletedAt: null } } } },
                    questions: {
                        where: { deletedAt: null },
                        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
                    }
                }
            });
        }));
        res.status(201).json(createdSubExam);
    }
    catch (error) {
        console.error('Error importing module exam JSON:', error);
        res.status(500).json({ error: 'Failed to import exam JSON' });
    }
});
exports.postExamHandler32 = postExamHandler32;
const getExamHandler21 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { isCentral, status, grade, search, courseId, folderId } = req.query;
        const where = { deletedAt: null };
        if (folderId) {
            where.folderId = folderId;
        }
        if (req.user.role === 'SUPER_ADMIN') {
            if (isCentral === 'true')
                where.isCentral = true;
            if (isCentral === 'false') {
                where.isCentral = false;
                if (req.query.schoolId)
                    where.schoolId = req.query.schoolId;
            }
        }
        else if (req.user.role === 'SCHOOL_ADMIN') {
            where.OR = [
                { isCentral: true },
                { schoolId: req.user.schoolId }
            ];
        }
        else if (req.user.role === 'TEACHER') {
            where.OR = [
                { creatorId: req.user.id }
            ];
        }
        else if (req.user.role === 'STUDENT') {
            where.OR = [
                { isCentral: true },
                { schoolId: req.user.schoolId }
            ];
            if (grade) {
                where.grade = grade;
            }
        }
        const folders = yield prisma_1.default.examFolder.findMany({
            where,
            include: {
                exams: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(folders);
    }
    catch (error) {
        console.error('Error fetching exam folders:', error);
        res.status(500).json({ error: 'Failed to fetch exam folders' });
    }
});
exports.getExamHandler21 = getExamHandler21;
const postExamHandler22 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, description, grade, subject, isCentral, schoolId } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }
        const folder = yield prisma_1.default.examFolder.create({
            data: {
                title,
                description,
                grade,
                subject,
                isCentral: req.user.role === 'SUPER_ADMIN' ? !!isCentral : false,
                creatorId: req.user.id,
                schoolId: req.user.role === 'SCHOOL_ADMIN' ? req.user.schoolId : (isCentral ? null : schoolId)
            }
        });
        res.json(folder);
    }
    catch (error) {
        console.error('Error creating exam folder:', error);
        res.status(500).json({ error: 'Failed to create exam folder' });
    }
});
exports.postExamHandler22 = postExamHandler22;
const putExamHandler23 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, description, grade, subject } = req.body;
        const existingFolder = yield prisma_1.default.examFolder.findUnique({ where: { id }, select: { id: true, schoolId: true, isCentral: true, creatorId: true } });
        if (!existingFolder)
            return res.status(404).json({ error: 'Exam folder not found' });
        if (req.user.role !== 'SUPER_ADMIN') {
            const isOwner = existingFolder.schoolId === req.user.schoolId ||
                existingFolder.isCentral ||
                existingFolder.creatorId === req.user.id;
            if (!isOwner)
                return res.status(403).json({ error: 'Access denied: You do not have permission to edit this folder.' });
        }
        const folder = yield prisma_1.default.examFolder.update({
            where: { id },
            data: { title, description, grade, subject }
        });
        res.json(folder);
    }
    catch (error) {
        console.error('Error updating exam folder:', error);
        res.status(500).json({ error: 'Failed to update exam folder' });
    }
});
exports.putExamHandler23 = putExamHandler23;
const deleteExamHandler24 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existingFolder = yield prisma_1.default.examFolder.findUnique({ where: { id }, select: { id: true, schoolId: true, isCentral: true, creatorId: true } });
        if (!existingFolder)
            return res.status(404).json({ error: 'Exam folder not found' });
        if (req.user.role !== 'SUPER_ADMIN') {
            const isOwner = existingFolder.schoolId === req.user.schoolId ||
                existingFolder.isCentral ||
                existingFolder.creatorId === req.user.id;
            if (!isOwner)
                return res.status(403).json({ error: 'Access denied: You do not have permission to delete this folder.' });
        }
        yield prisma_1.default.examFolder.update({
            where: { id },
            data: { deletedAt: new Date() }
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error deleting exam folder:', error);
        res.status(500).json({ error: 'Failed to delete exam folder' });
    }
});
exports.deleteExamHandler24 = deleteExamHandler24;
const postExamHandler25 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { targetExamId, targetModuleId, targetSubExamId } = req.body;
        if (!targetExamId) {
            return res.status(400).json({ error: 'targetExamId is required' });
        }
        // 1. Get source exam
        const sourceExam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: { schools: { select: { id: true } } }
        });
        if (!sourceExam) {
            return res.status(404).json({ error: 'Source exam not found' });
        }
        if (!(yield (0, exports.canManageExam)(req.user, sourceExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move questions from this exam.' });
        }
        // 2. Get target exam
        const targetExam = yield prisma_1.default.exam.findUnique({
            where: { id: targetExamId },
            include: { modules: { orderBy: { order: 'desc' }, take: 1 }, schools: { select: { id: true } } }
        });
        if (!targetExam) {
            return res.status(404).json({ error: 'Target exam not found' });
        }
        if (!(yield (0, exports.canManageExam)(req.user, targetExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
        }
        const newOrder = targetExam.modules.length > 0 ? (targetExam.modules[0].order || 0) + 1 : 0;
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            let finalModuleId = targetModuleId;
            // If no specific module is provided, create a new one
            if (!finalModuleId) {
                // 3. Create a new module in target exam using source exam title
                const newModule = yield tx.examModule.create({
                    data: {
                        examId: targetExam.id,
                        title: sourceExam.title,
                        order: newOrder,
                        description: sourceExam.description
                    }
                });
                finalModuleId = newModule.id;
            }
            // 4. Move all STANDALONE questions to the module/subexam in the target exam
            yield tx.question.updateMany({
                where: {
                    examId: id,
                    moduleId: null
                },
                data: Object.assign({ examId: targetExam.id, moduleId: finalModuleId }, (targetSubExamId !== undefined ? { subExamId: targetSubExamId } : {}))
            });
        }));
        res.json({ message: 'Standalone questions moved successfully' });
    }
    catch (error) {
        console.error('Error moving standalone questions:', error);
        res.status(500).json({ error: 'Failed to move standalone questions' });
    }
});
exports.postExamHandler25 = postExamHandler25;
const postExamHandler26 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { targetExamId, targetModuleId, targetSubExamId } = req.body;
        if (!targetExamId) {
            return res.status(400).json({ error: 'targetExamId is required' });
        }
        // 1. Get source exam
        const sourceExam = yield prisma_1.default.exam.findUnique({
            where: { id },
            include: { questions: { where: { deletedAt: null } }, schools: { select: { id: true } } }
        });
        if (!sourceExam) {
            return res.status(404).json({ error: 'Source exam not found' });
        }
        // Ownership check on SOURCE exam — prevent stealing/deleting another school's exam
        if (!(yield (0, exports.canManageExam)(req.user, sourceExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move this exam.' });
        }
        // 2. Get target exam
        const targetExam = yield prisma_1.default.exam.findUnique({
            where: { id: targetExamId },
            include: { modules: { orderBy: { order: 'desc' }, take: 1 }, schools: { select: { id: true } } }
        });
        if (!targetExam) {
            return res.status(404).json({ error: 'Target exam not found' });
        }
        if (!(yield (0, exports.canManageExam)(req.user, targetExam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
        }
        const newOrder = targetExam.modules.length > 0 ? (targetExam.modules[0].order || 0) + 1 : 0;
        yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            let finalModuleId = targetModuleId;
            // If no specific module is provided, create a new one
            if (!finalModuleId) {
                // 3. Create a new module in target exam
                const newModule = yield tx.examModule.create({
                    data: {
                        examId: targetExam.id,
                        title: sourceExam.title,
                        order: newOrder,
                        description: sourceExam.description
                    }
                });
                finalModuleId = newModule.id;
            }
            // 4. Move all questions to the module/subexam in the target exam
            yield tx.question.updateMany({
                where: { examId: id },
                data: Object.assign({ examId: targetExam.id, moduleId: finalModuleId }, (targetSubExamId !== undefined ? { subExamId: targetSubExamId } : {}))
            });
            // 5. Soft Delete the old exam
            yield tx.exam.update({
                where: { id },
                data: { deletedAt: new Date() }
            });
        }));
        res.json({ success: true, message: 'Exam content successfully moved to module.' });
    }
    catch (error) {
        console.error('Error moving exam to module:', error);
        res.status(500).json({ error: 'Failed to move exam to module' });
    }
});
exports.postExamHandler26 = postExamHandler26;
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
        const validSections = q.sections.filter((s) => s && (String(s.content || s.text || '').trim() !== ''));
        if (validSections.length > 0) {
            const sanitizedValid = validSections.map((s) => (Object.assign(Object.assign({}, s), { content: s.content ? (0, shared_1.sanitizeHtml)(s.content) : s.content, text: s.text ? (0, shared_1.sanitizeHtml)(s.text) : s.text })));
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
        // 🔒 SECURITY FIX: Always sanitize HTML regardless of input type.
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
                const valid = parsed.filter((s) => s && String(s.content || s.text || '').trim() !== '');
                if (valid.length === 0)
                    return null;
                // sanitize each text/content field within array items
                const sanitizedValid = valid.map((s) => (Object.assign(Object.assign({}, s), { content: s.content ? (0, shared_1.sanitizeHtml)(s.content) : s.content, text: s.text ? (0, shared_1.sanitizeHtml)(s.text) : s.text })));
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
