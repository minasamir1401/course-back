"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const systemSettings_service_1 = require("../services/systemSettings.service");
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const skillExcel_1 = require("../utils/skillExcel");
const skillAccess_1 = require("../utils/skillAccess");
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const router = (0, express_1.Router)();
// One central setting governs every deletion path, including nested skill content.
const enforceDeletionPolicy = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (req.user.role !== 'SUPER_ADMIN' && !(yield (0, systemSettings_service_1.isContentDeletionAllowed)()))
            return res.status(403).json({ error: 'Content deletion is protected by Super Admin. Enable Content & Question Deletion Policy first.' });
        next();
    }
    catch (_a) {
        res.status(503).json({ error: 'Could not verify deletion policy. Please retry.' });
    }
});
// --- Extracted from lines 4383-5216 ---
router.get('/api/skills-hub/clusters', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { grade, subject } = req.query;
        const user = req.user;
        const filters = [];
        if (subject)
            filters.push({ subject: String(subject) });
        const targetGrade = user.role === 'STUDENT' ? user.grade : grade;
        if (targetGrade)
            filters.push((0, skillAccess_1.skillGradeWhere)((0, shared_1.getStudentGradeAndStage)(String(targetGrade))));
        if (user.role === 'SUPER_ADMIN') {
            if (req.query.schoolId)
                filters.push({ OR: [{ schoolId: String(req.query.schoolId) }, { schoolIds: { contains: JSON.stringify(String(req.query.schoolId)) } }] });
        }
        else {
            filters.push((0, skillAccess_1.skillSchoolWhere)(user.schoolId));
            if (user.role === 'STUDENT' && !user.grade)
                return res.json([]);
        }
        const where = { AND: filters };
        const clusters = yield prisma_1.default.skillCluster.findMany({
            where,
            include: {
                _count: {
                    select: { skills: true }
                },
                school: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(clusters.map(skillAccess_1.skillClusterPayload));
    }
    catch (error) {
        console.error('Error fetching skill clusters:', error);
        res.status(500).json({ error: 'Error fetching skill clusters', details: error.message });
    }
}));
// Create a Skill Cluster
router.post('/api/skills-hub/clusters', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { name, description, subject, isCentral } = req.body;
        const rawGrade = req.body.grades || req.body.grade;
        const grade = Array.isArray(rawGrade) ? JSON.stringify(rawGrade) : String(rawGrade || '');
        const rawSchool = (_a = req.body.schoolIds) !== null && _a !== void 0 ? _a : req.body.schoolId;
        const schoolIds = req.user.role === 'SUPER_ADMIN' ? (isCentral ? [] : (0, skillAccess_1.skillSelections)(rawSchool)) : (0, skillAccess_1.skillSelections)(req.user.schoolId);
        const schoolId = schoolIds[0] || null;
        if (!isCentral && schoolIds.length === 0)
            return res.status(400).json({ error: 'Select at least one school for a non-central cluster.' });
        if (schoolIds.length && (yield prisma_1.default.school.count({ where: { id: { in: schoolIds } } })) !== schoolIds.length)
            return res.status(400).json({ error: 'Invalid school assignment' });
        if (!name || !subject || (0, skillAccess_1.skillSelections)(grade).length === 0) {
            return res.status(400).json({ error: 'Missing required fields: name, subject, grade' });
        }
        if (req.user.role !== 'SUPER_ADMIN' && isCentral) {
            return res.status(403).json({ error: 'Only Super Admin can create central skill clusters.' });
        }
        const isGrade123 = (g) => {
            if (!g)
                return false;
            const str = typeof g === 'string' ? g : JSON.stringify(g);
            return [
                "الصف الأول الابتدائي",
                "الصف الثاني الابتدائي",
                "الصف الثالث الابتدائي"
            ].some(gr => str.includes(gr));
        };
        if (subject === 'العلوم' && isGrade123(grade)) {
            return res.status(400).json({ error: 'Science (العلوم) is not allowed for Grade 1, 2, and 3 Primary.' });
        }
        const cluster = yield prisma_1.default.skillCluster.create({
            data: {
                name,
                description,
                subject,
                grade,
                isCentral: req.user.role === 'SUPER_ADMIN' ? !!isCentral : false,
                creatorId: req.user.id,
                schoolId,
                schoolIds: JSON.stringify(schoolIds)
            }
        });
        res.json({ message: 'Skill Cluster created successfully', cluster: (0, skillAccess_1.skillClusterPayload)(cluster) });
    }
    catch (error) {
        console.error('Error creating skill cluster:', error);
        res.status(500).json({ error: 'Error creating skill cluster', details: error.message });
    }
}));
// Update a Skill Cluster
router.put('/api/skills-hub/clusters/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id } = req.params;
        const { name, description, subject, isCentral } = req.body;
        const rawGrade = req.body.grades !== undefined ? req.body.grades : req.body.grade;
        const grade = rawGrade !== undefined ? (Array.isArray(rawGrade) ? JSON.stringify(rawGrade) : String(rawGrade || '')) : undefined;
        const existingCluster = yield prisma_1.default.skillCluster.findUnique({ where: { id } });
        if (!existingCluster) {
            return res.status(404).json({ error: 'Skill Cluster not found' });
        }
        if (!(0, skillAccess_1.canManageSkillCluster)(req.user, existingCluster)) {
            return res.status(403).json({ error: 'Access denied: You can only edit your school\'s clusters.' });
        }
        if (req.user.role !== 'SUPER_ADMIN' && isCentral !== undefined && isCentral !== existingCluster.isCentral) {
            return res.status(403).json({ error: 'Only Super Admin can modify centrality of clusters.' });
        }
        const rawSchool = (_a = req.body.schoolIds) !== null && _a !== void 0 ? _a : req.body.schoolId;
        const central = req.user.role === 'SUPER_ADMIN' && isCentral !== undefined ? !!isCentral : existingCluster.isCentral;
        const schoolIds = central ? [] : (req.user.role === 'SUPER_ADMIN' && rawSchool !== undefined ? (0, skillAccess_1.skillSelections)(rawSchool) : (0, skillAccess_1.skillSelections)((_b = existingCluster.schoolIds) !== null && _b !== void 0 ? _b : existingCluster.schoolId));
        const schoolId = schoolIds[0] || null;
        if (!central && !schoolId)
            return res.status(400).json({ error: 'Select at least one school for a non-central cluster.' });
        if (schoolIds.length && (yield prisma_1.default.school.count({ where: { id: { in: schoolIds } } })) !== schoolIds.length)
            return res.status(400).json({ error: 'Invalid school assignment' });
        const checkSubject = subject !== undefined ? subject : existingCluster.subject;
        const checkGrade = grade !== undefined ? grade : existingCluster.grade;
        const isGrade123 = (g) => {
            if (!g)
                return false;
            const str = typeof g === 'string' ? g : JSON.stringify(g);
            return [
                "الصف الأول الابتدائي",
                "الصف الثاني الابتدائي",
                "الصف الثالث الابتدائي"
            ].some(gr => str.includes(gr));
        };
        if (checkSubject === 'العلوم' && checkGrade && isGrade123(checkGrade)) {
            return res.status(400).json({ error: 'Science (العلوم) is not allowed for Grade 1, 2, and 3 Primary.' });
        }
        const cluster = yield prisma_1.default.skillCluster.update({
            where: { id },
            data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (name !== undefined && { name })), (description !== undefined && { description })), (subject !== undefined && { subject })), (grade !== undefined && { grade })), (isCentral !== undefined && req.user.role === 'SUPER_ADMIN' && { isCentral: !!isCentral })), (req.user.role === 'SUPER_ADMIN' && { schoolId, schoolIds: JSON.stringify(schoolIds) }))
        });
        res.json({ message: 'Skill Cluster updated successfully', cluster: (0, skillAccess_1.skillClusterPayload)(cluster) });
    }
    catch (error) {
        console.error('Error updating skill cluster:', error);
        res.status(500).json({ error: 'Error updating skill cluster', details: error.message });
    }
}));
// Delete a Skill Cluster
router.delete('/api/skills-hub/clusters/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), enforceDeletionPolicy, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existingCluster = yield prisma_1.default.skillCluster.findUnique({ where: { id } });
        if (!existingCluster) {
            return res.status(404).json({ error: 'Skill Cluster not found' });
        }
        if (!(0, skillAccess_1.canDeleteSkillCluster)(req.user, existingCluster)) {
            return res.status(403).json({ error: 'Access denied: You can only delete your school\'s clusters.' });
        }
        yield prisma_1.default.skillCluster.delete({ where: { id } });
        res.json({ message: 'Skill Cluster deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting skill cluster:', error);
        res.status(500).json({ error: 'Error deleting skill cluster', details: error.message });
    }
}));
// --- 2. SKILL LESSONS CRUD ---
// Get all lessons for a cluster
router.get('/api/skills-hub/clusters/:clusterId/lessons', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { clusterId } = req.params;
        const cluster = yield prisma_1.default.skillCluster.findUnique({ where: { id: clusterId } });
        if (!cluster) {
            return res.status(404).json({ error: 'Skill Cluster not found' });
        }
        if (!(0, skillAccess_1.canViewSkillCluster)(req.user, cluster, (0, shared_1.getStudentGradeAndStage)(req.user.grade))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const lessons = yield prisma_1.default.skillLesson.findMany({
            where: { clusterId },
            include: {
                _count: {
                    select: { activities: true }
                }
            },
            orderBy: { order: 'asc' }
        });
        res.json(lessons);
    }
    catch (error) {
        console.error('Error fetching skill lessons:', error);
        res.status(500).json({ error: 'Error fetching skill lessons', details: error.message });
    }
}));
// Create a Skill Lesson
router.post(['/api/skills-hub/lessons', '/api/skills-hub/clusters/:clusterId/lessons'], auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const clusterId = req.body.clusterId || req.params.clusterId;
        const name = (req.body.name || req.body.title || '').trim();
        const { description, order } = req.body;
        if (!clusterId || !name) {
            return res.status(400).json({ error: 'يرجى إدخال اسم الدرس أو المهارة الفرعية المطلوبة.' });
        }
        const cluster = yield prisma_1.default.skillCluster.findUnique({ where: { id: clusterId } });
        if (!cluster) {
            return res.status(404).json({ error: 'Skill Cluster not found' });
        }
        if (!(0, skillAccess_1.canManageSkillCluster)(req.user, cluster)) {
            return res.status(403).json({ error: 'Access denied: Cannot add lessons to this cluster.' });
        }
        const lesson = yield prisma_1.default.skillLesson.create({
            data: {
                clusterId,
                name,
                description: description || '',
                order: order !== undefined ? Number(order) : 0
            }
        });
        res.json({ message: 'Skill Lesson created successfully', lesson });
    }
    catch (error) {
        console.error('Error creating skill lesson:', error);
        res.status(500).json({ error: 'Error creating skill lesson', details: error.message });
    }
}));
// Update a Skill Lesson
router.put('/api/skills-hub/lessons/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const name = (req.body.name || req.body.title || '').trim();
        let { description, order, metadata } = req.body;
        if (description === undefined && metadata !== undefined) {
            description = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
        }
        const existingLesson = yield prisma_1.default.skillLesson.findUnique({
            where: { id },
            include: { cluster: true }
        });
        if (!existingLesson) {
            return res.status(404).json({ error: 'Skill Lesson not found' });
        }
        if (!(0, skillAccess_1.canManageSkillCluster)(req.user, existingLesson.cluster)) {
            return res.status(403).json({ error: 'Access denied: Cannot edit lessons in this cluster.' });
        }
        const lesson = yield prisma_1.default.skillLesson.update({
            where: { id },
            data: {
                name: name || existingLesson.name,
                description: description !== undefined ? description : existingLesson.description,
                order: order !== undefined ? Number(order) : existingLesson.order
            }
        });
        res.json({ message: 'Skill Lesson updated successfully', lesson });
    }
    catch (error) {
        console.error('Error updating skill lesson:', error);
        res.status(500).json({ error: 'Error updating skill lesson', details: error.message });
    }
}));
// Delete a Skill Lesson
router.delete('/api/skills-hub/lessons/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), enforceDeletionPolicy, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existingLesson = yield prisma_1.default.skillLesson.findUnique({
            where: { id },
            include: { cluster: true }
        });
        if (!existingLesson) {
            return res.status(404).json({ error: 'Skill Lesson not found' });
        }
        if (!(0, skillAccess_1.canDeleteSkillCluster)(req.user, existingLesson.cluster)) {
            return res.status(403).json({ error: 'Access denied: Cannot delete lessons in this cluster.' });
        }
        yield prisma_1.default.skillLesson.delete({ where: { id } });
        res.json({ message: 'Skill Lesson deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting skill lesson:', error);
        res.status(500).json({ error: 'Error deleting skill lesson', details: error.message });
    }
}));
// Memory upload avoids retaining rejected/imported spreadsheets on disk.
const excelUpload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
router.post('/api/skills-hub/lessons/:id/upload-excel', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const lesson = yield prisma_1.default.skillLesson.findUnique({ where: { id: req.params.id }, include: { cluster: true } }).catch(() => null);
    if (!lesson)
        return res.status(404).json({ error: 'Lesson not found' });
    if (!(0, skillAccess_1.canManageSkillCluster)(req.user, lesson.cluster))
        return res.status(403).json({ error: 'Access denied' });
    excelUpload.single('file')(req, res, (uploadError) => __awaiter(void 0, void 0, void 0, function* () {
        if (uploadError)
            return res.status(400).json({ error: uploadError.message });
        if (!req.file || !/\.xlsx?$/i.test(req.file.originalname))
            return res.status(400).json({ error: 'Upload an .xls or .xlsx file' });
        let data;
        try {
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer', sheetRows: 1002 });
            if (!workbook.SheetNames.length)
                throw new Error('Empty workbook');
            data = (0, skillExcel_1.parseSkillExcelRows)(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' }), lesson.id);
            data = (0, shared_1.sanitizeDeep)(data);
        }
        catch (error) {
            return res.status(400).json({ error: error.message });
        }
        try {
            const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                const current = yield tx.skillLesson.findUnique({ where: { id: lesson.id }, include: { cluster: true } });
                if (!current || !(0, skillAccess_1.canManageSkillCluster)(req.user, current.cluster))
                    throw new Error('Access denied');
                return tx.interactiveActivity.createMany({ data });
            }));
            res.json({ message: 'Activities imported', count: result.count });
        }
        catch (error) {
            res.status(error.message === 'Access denied' ? 403 : 500).json({ error: 'Could not import activities' });
        }
    }));
}));
// --- 3. INTERACTIVE ACTIVITIES CRUD ---
// Get all activities for a lesson
router.get('/api/skills-hub/lessons/:lessonId/activities', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { lessonId } = req.params;
        const lesson = yield prisma_1.default.skillLesson.findUnique({
            where: { id: lessonId },
            include: { cluster: true }
        });
        if (!lesson) {
            return res.status(404).json({ error: 'Skill Lesson not found' });
        }
        if (!(0, skillAccess_1.canViewSkillCluster)(req.user, lesson.cluster, (0, shared_1.getStudentGradeAndStage)(req.user.grade))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const activities = yield prisma_1.default.interactiveActivity.findMany({
            where: { lessonId },
            orderBy: { createdAt: 'asc' }
        });
        const parsedActivities = activities.map(act => (0, skillAccess_1.skillActivityPayload)(act, req.user.role === 'STUDENT'));
        res.json(parsedActivities);
    }
    catch (error) {
        console.error('Error fetching interactive activities:', error);
        res.status(500).json({ error: 'Error fetching interactive activities', details: error.message });
    }
}));
// Get a single activity (for play mode)
router.get('/api/skills-hub/activities/:id', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const activity = yield prisma_1.default.interactiveActivity.findUnique({
            where: { id },
            include: {
                lesson: {
                    include: { cluster: true }
                }
            }
        });
        if (!activity) {
            return res.status(404).json({ error: 'Activity not found' });
        }
        if (!(0, skillAccess_1.canViewSkillCluster)(req.user, activity.lesson.cluster, (0, shared_1.getStudentGradeAndStage)(req.user.grade))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const responseData = (0, skillAccess_1.skillActivityPayload)(activity, req.user.role === 'STUDENT');
        res.json(responseData);
    }
    catch (error) {
        console.error('Error fetching activity:', error);
        res.status(500).json({ error: 'Error fetching activity', details: error.message });
    }
}));
// Create an Interactive Activity
router.post('/api/skills-hub/activities', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { lessonId, title, titleEn, questionText, questionTextEn, type, options, optionsEn, correctAnswer, correctAnswerEn, points, xpPoints, difficulty, dok, estimatedTime, standard, indicator, learningOutcome, skill, hint, hintEn, tip, tipEn, explanation, explanationEn, keyInsight, keyInsightEn } = req.body;
        const missing = (0, shared_1.hasRequiredFields)(req.body, ['lessonId', 'title', 'type', 'options', 'correctAnswer']);
        if (missing) {
            const fieldMap = {
                title: 'عنوان السؤال (Question Title)',
                type: 'نوع السؤال (Question Type)',
                options: 'الخيارات (Options)',
                correctAnswer: 'الإجابة الصحيحة (Correct Answer)',
                lessonId: 'الدرس (Lesson ID)'
            };
            const translatedMissing = missing.map(m => fieldMap[m] || m).join('، ');
            return res.status(400).json({ error: `يرجى إكمال الحقول المطلوبة لحفظ السؤال: ${translatedMissing}` });
        }
        const lesson = yield prisma_1.default.skillLesson.findUnique({
            where: { id: lessonId },
            include: { cluster: true }
        });
        if (!lesson) {
            return res.status(404).json({ error: 'Skill Lesson not found' });
        }
        if (!(0, skillAccess_1.canManageSkillCluster)(req.user, lesson.cluster)) {
            return res.status(403).json({ error: 'Access denied: Cannot add activities in this cluster.' });
        }
        const activity = yield prisma_1.default.interactiveActivity.create({
            data: {
                lessonId,
                title,
                titleEn: titleEn || null,
                questionText: questionText || null,
                questionTextEn: questionTextEn || null,
                type,
                options: typeof options === 'string' ? options : JSON.stringify(options),
                optionsEn: optionsEn !== undefined ? (typeof optionsEn === 'string' ? optionsEn : JSON.stringify(optionsEn)) : null,
                correctAnswer: typeof correctAnswer === 'string' ? correctAnswer : JSON.stringify(correctAnswer),
                correctAnswerEn: correctAnswerEn !== undefined ? (typeof correctAnswerEn === 'string' ? correctAnswerEn : JSON.stringify(correctAnswerEn)) : null,
                points: points !== undefined ? Number(points) : 10,
                xpPoints: xpPoints !== undefined ? Number(xpPoints) : 10,
                difficulty: difficulty || 'Medium',
                dok: dok || null,
                estimatedTime: estimatedTime !== undefined ? Number(estimatedTime) : 60,
                standard: standard || null,
                indicator: indicator || null,
                learningOutcome: learningOutcome || null,
                skill: skill || null,
                hint: hint || null,
                hintEn: hintEn || null,
                tip: tip || null,
                tipEn: tipEn || null,
                explanation: explanation || null,
                explanationEn: explanationEn || null,
                keyInsight: keyInsight || null,
                keyInsightEn: keyInsightEn || null
            }
        });
        res.json({ message: 'Interactive Activity created successfully', activity });
    }
    catch (error) {
        console.error('Error creating activity:', error);
        res.status(500).json({ error: 'Error creating activity', details: error.message });
    }
}));
// Update an Interactive Activity
router.put('/api/skills-hub/activities/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, titleEn, questionText, questionTextEn, type, options, optionsEn, correctAnswer, correctAnswerEn, points, xpPoints, difficulty, dok, estimatedTime, standard, indicator, learningOutcome, skill, hint, hintEn, tip, tipEn, explanation, explanationEn, keyInsight, keyInsightEn } = req.body;
        const existingActivity = yield prisma_1.default.interactiveActivity.findUnique({
            where: { id },
            include: { lesson: { include: { cluster: true } } }
        });
        if (!existingActivity) {
            return res.status(404).json({ error: 'Interactive Activity not found' });
        }
        if (!(0, skillAccess_1.canManageSkillCluster)(req.user, existingActivity.lesson.cluster)) {
            return res.status(403).json({ error: 'Access denied: Cannot edit activities in this cluster.' });
        }
        const activity = yield prisma_1.default.interactiveActivity.update({
            where: { id },
            data: {
                title: title !== undefined ? title : existingActivity.title,
                titleEn: titleEn !== undefined ? titleEn : existingActivity.titleEn,
                questionText: questionText !== undefined ? questionText : existingActivity.questionText,
                questionTextEn: questionTextEn !== undefined ? questionTextEn : existingActivity.questionTextEn,
                type: type !== undefined ? type : existingActivity.type,
                options: options !== undefined ? (typeof options === 'string' ? options : JSON.stringify(options)) : existingActivity.options,
                optionsEn: optionsEn !== undefined ? (typeof optionsEn === 'string' ? optionsEn : JSON.stringify(optionsEn)) : existingActivity.optionsEn,
                correctAnswer: correctAnswer !== undefined ? (typeof correctAnswer === 'string' ? correctAnswer : JSON.stringify(correctAnswer)) : existingActivity.correctAnswer,
                correctAnswerEn: correctAnswerEn !== undefined ? (typeof correctAnswerEn === 'string' ? correctAnswerEn : JSON.stringify(correctAnswerEn)) : existingActivity.correctAnswerEn,
                points: points !== undefined ? Number(points) : existingActivity.points,
                xpPoints: xpPoints !== undefined ? Number(xpPoints) : existingActivity.xpPoints,
                difficulty: difficulty !== undefined ? difficulty : existingActivity.difficulty,
                dok: dok !== undefined ? dok : existingActivity.dok,
                estimatedTime: estimatedTime !== undefined ? Number(estimatedTime) : existingActivity.estimatedTime,
                standard: standard !== undefined ? standard : existingActivity.standard,
                indicator: indicator !== undefined ? indicator : existingActivity.indicator,
                learningOutcome: learningOutcome !== undefined ? learningOutcome : existingActivity.learningOutcome,
                skill: skill !== undefined ? skill : existingActivity.skill,
                hint: hint !== undefined ? hint : existingActivity.hint,
                hintEn: hintEn !== undefined ? hintEn : existingActivity.hintEn,
                tip: tip !== undefined ? tip : existingActivity.tip,
                tipEn: tipEn !== undefined ? tipEn : existingActivity.tipEn,
                explanation: explanation !== undefined ? explanation : existingActivity.explanation,
                explanationEn: explanationEn !== undefined ? explanationEn : existingActivity.explanationEn,
                keyInsight: keyInsight !== undefined ? keyInsight : existingActivity.keyInsight,
                keyInsightEn: keyInsightEn !== undefined ? keyInsightEn : existingActivity.keyInsightEn
            }
        });
        res.json({ message: 'Interactive Activity updated successfully', activity });
    }
    catch (error) {
        console.error('Error updating activity:', error);
        res.status(500).json({ error: 'Error updating activity', details: error.message });
    }
}));
// Delete an Interactive Activity
router.delete('/api/skills-hub/activities/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), enforceDeletionPolicy, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existingActivity = yield prisma_1.default.interactiveActivity.findUnique({
            where: { id },
            include: { lesson: { include: { cluster: true } } }
        });
        if (!existingActivity) {
            return res.status(404).json({ error: 'Interactive Activity not found' });
        }
        if (!(0, skillAccess_1.canDeleteSkillCluster)(req.user, existingActivity.lesson.cluster)) {
            return res.status(403).json({ error: 'Access denied: Cannot delete activities in this cluster.' });
        }
        yield prisma_1.default.interactiveActivity.delete({ where: { id } });
        res.json({ message: 'Interactive Activity deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting activity:', error);
        res.status(500).json({ error: 'Error deleting activity', details: error.message });
    }
}));
// --- 4. ATTEMPT & GRADING EVALUATION ---
router.post('/api/skills-hub/activities/:id/attempt', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { selectedAnswer, timeTaken, hintsUsed = 0, attemptCount = 1 } = req.body;
        const user = req.user;
        const activity = yield prisma_1.default.interactiveActivity.findUnique({
            where: { id },
            include: { lesson: { include: { cluster: true } } }
        });
        if (!activity) {
            return res.status(404).json({ error: 'Activity not found' });
        }
        if (!(0, skillAccess_1.canViewSkillCluster)(user, activity.lesson.cluster, (0, shared_1.getStudentGradeAndStage)(user.grade))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const mockQuestion = {
            type: activity.type,
            correctAnswer: activity.correctAnswer,
            optionsEn: activity.optionsEn,
            correctAnswerEn: activity.correctAnswerEn,
            options: activity.options // ✅ required for MCQ grading in isAnswerCorrect
        };
        const isCorrect = (0, shared_1.isAnswerCorrect)(mockQuestion, selectedAnswer);
        let stars = 0;
        if (isCorrect) {
            const parsedHints = Number(hintsUsed) || 0;
            const parsedAttempts = Number(attemptCount) || 1;
            if (parsedAttempts <= 1 && parsedHints === 0) {
                stars = 3;
            }
            else if (parsedAttempts <= 2 && parsedHints <= 1) {
                stars = 2;
            }
            else {
                stars = 1;
            }
        }
        const basePoints = activity.points || 10;
        const score = Math.round(basePoints * (stars === 3 ? 1.0 : stars === 2 ? 0.7 : stars === 1 ? 0.5 : 0.0));
        const prevAttempts = yield prisma_1.default.activityAttempt.count({
            where: { userId: user.id, activityId: activity.id }
        });
        const attempt = yield prisma_1.default.activityAttempt.create({
            data: {
                userId: user.id,
                activityId: activity.id,
                selectedAnswer: typeof selectedAnswer === 'string' ? selectedAnswer : JSON.stringify(selectedAnswer),
                isCorrect,
                score,
                stars,
                timeTaken: timeTaken !== undefined ? Number(timeTaken) : null
            }
        });
        const isFirstAttempt = prevAttempts === 0;
        const earnedXP = (isFirstAttempt && isCorrect) ? (activity.xpPoints !== undefined ? Number(activity.xpPoints) : 10) : 0;
        yield prisma_1.default.xPHistory.create({
            data: {
                userId: user.id,
                xp: earnedXP,
                sourceType: "INTERACTIVE_ACTIVITY",
                sourceId: activity.lessonId,
                questionId: activity.id,
                isCorrect,
                attemptNum: prevAttempts + 1
            }
        });
        const activities = yield prisma_1.default.interactiveActivity.findMany({
            where: { lessonId: activity.lessonId },
            orderBy: { createdAt: 'asc' }
        });
        const firstAttempts = yield prisma_1.default.xPHistory.findMany({
            where: {
                userId: user.id,
                sourceId: activity.lessonId,
                sourceType: "INTERACTIVE_ACTIVITY",
                attemptNum: 1,
                isBonus: false
            }
        });
        const attemptsMap = new Map(firstAttempts.map(a => [a.questionId, a]));
        let currentStreak = 0;
        for (const act of activities) {
            const att = attemptsMap.get(act.id);
            if (!att)
                break;
            if (att.isCorrect) {
                currentStreak++;
            }
            else {
                currentStreak = 0;
            }
        }
        let bonusXP = 0;
        if (isFirstAttempt && isCorrect && (currentStreak === 5 || currentStreak === 10)) {
            const bonusType = `streak_${currentStreak}`;
            const alreadyHasBonus = (yield prisma_1.default.xPHistory.count({
                where: {
                    userId: user.id,
                    sourceId: activity.lessonId,
                    sourceType: "INTERACTIVE_ACTIVITY",
                    questionId: bonusType,
                    isBonus: true
                }
            })) > 0;
            if (!alreadyHasBonus) {
                bonusXP = currentStreak === 5 ? 10 : 30;
                yield prisma_1.default.xPHistory.create({
                    data: {
                        userId: user.id,
                        xp: bonusXP,
                        sourceType: "INTERACTIVE_ACTIVITY",
                        sourceId: activity.lessonId,
                        questionId: bonusType,
                        isCorrect: true,
                        attemptNum: 1,
                        isBonus: true
                    }
                });
            }
        }
        const totalXPToAward = earnedXP + bonusXP;
        if (totalXPToAward > 0) {
            yield prisma_1.default.user.update({
                where: { id: user.id },
                data: { xp: { increment: totalXPToAward } }
            });
        }
        if (typeof shared_1.statsCache !== 'undefined') {
            shared_1.statsCache.delete(`student_stats_${user.id}`);
        }
        res.json({
            message: 'Attempt logged successfully',
            attemptId: attempt.id,
            isCorrect,
            stars,
            score,
            earnedXP,
            bonusXP,
            currentStreak: isFirstAttempt ? currentStreak : 0,
            correctAnswer: typeof activity.correctAnswer === 'string' && (activity.correctAnswer.startsWith('{') || activity.correctAnswer.startsWith('[')) ? JSON.parse(activity.correctAnswer) : activity.correctAnswer,
            explanation: activity.explanation,
            keyInsight: activity.keyInsight
        });
    }
    catch (error) {
        console.error('Error logging activity attempt:', error);
        res.status(500).json({ error: 'Error logging activity attempt', details: error.message });
    }
}));
// --- 5. PROGRESS & MASTERY REPORTS ---
router.get('/api/skills-hub/progress', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { subject, grade } = req.query;
        const user = req.user;
        const targetUserId = req.query.userId && ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user.role)
            ? req.query.userId
            : user.id;
        const targetUser = yield prisma_1.default.user.findUnique({ where: { id: targetUserId } });
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (targetUserId !== user.id && (targetUser.role !== 'STUDENT' || (user.role !== 'SUPER_ADMIN' && (!user.schoolId || targetUser.schoolId !== user.schoolId)))) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const targetGrade = user.role === 'STUDENT' ? targetUser.grade : (String(grade || '') || targetUser.grade);
        if (!targetGrade)
            return res.json({ userId: targetUserId, grade: targetGrade, subject, subjects: [], clusters: [] });
        const clusterWhere = { AND: [(0, skillAccess_1.skillSchoolWhere)(targetUser.schoolId), (0, skillAccess_1.skillGradeWhere)((0, shared_1.getStudentGradeAndStage)(targetGrade))] };
        const clusters = yield prisma_1.default.skillCluster.findMany({
            where: clusterWhere,
            include: {
                skills: {
                    include: {
                        activities: {
                            select: {
                                id: true,
                                title: true,
                                type: true,
                                difficulty: true,
                                dok: true,
                                points: true,
                                estimatedTime: true,
                                standard: true,
                                indicator: true,
                                learningOutcome: true,
                            }
                        }
                    }
                }
            }
        });
        const attempts = yield prisma_1.default.activityAttempt.findMany({
            where: { userId: targetUserId },
            select: {
                activityId: true,
                stars: true,
                score: true,
                isCorrect: true,
            }
        });
        const bestAttemptsMap = new Map();
        attempts.forEach(att => {
            const prev = bestAttemptsMap.get(att.activityId);
            if (!prev || att.stars > prev.stars) {
                bestAttemptsMap.set(att.activityId, att);
            }
        });
        const subjects = [...new Set(clusters.map(cluster => cluster.subject))];
        const visibleClusters = subject ? clusters.filter(cluster => cluster.subject === String(subject)) : clusters;
        const clusterProgressReport = visibleClusters.map(cluster => {
            let totalActivities = 0;
            let completedActivities = 0;
            let totalStarsEarned = 0;
            let totalXPEarned = 0;
            const skillsReport = cluster.skills.map(skill => {
                const activitiesReport = skill.activities.map(act => {
                    totalActivities++;
                    const bestAttempt = bestAttemptsMap.get(act.id);
                    let bestAttemptStars = 0;
                    let bestAttemptCorrect = false;
                    if (bestAttempt) {
                        bestAttemptStars = bestAttempt.stars;
                        bestAttemptCorrect = bestAttempt.isCorrect;
                        totalStarsEarned += bestAttempt.stars;
                        totalXPEarned += bestAttempt.score;
                        if (bestAttempt.isCorrect) {
                            completedActivities++;
                        }
                    }
                    return {
                        id: act.id,
                        title: act.title,
                        type: act.type,
                        difficulty: act.difficulty,
                        dok: act.dok,
                        points: act.points,
                        estimatedTime: act.estimatedTime,
                        standard: act.standard,
                        indicator: act.indicator,
                        learningOutcome: act.learningOutcome,
                        bestAttemptStars,
                        bestAttemptCorrect
                    };
                });
                return {
                    id: skill.id,
                    name: skill.name,
                    description: skill.description,
                    order: skill.order,
                    activities: activitiesReport
                };
            });
            const maxPossibleStars = totalActivities * 3;
            const masteryPercent = maxPossibleStars > 0 ? Math.round((totalStarsEarned / maxPossibleStars) * 100) : 0;
            const completionPercent = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;
            return {
                id: cluster.id,
                name: cluster.name,
                description: cluster.description,
                subject: cluster.subject,
                grade: cluster.grade,
                isCentral: cluster.isCentral,
                skills: skillsReport,
                stats: {
                    totalActivities,
                    completedActivities,
                    completionPercent,
                    totalStarsEarned,
                    maxPossibleStars,
                    masteryPercent,
                    totalXPEarned
                }
            };
        });
        res.json({
            userId: targetUserId,
            grade: targetGrade,
            subject,
            subjects,
            clusters: clusterProgressReport
        });
    }
    catch (error) {
        console.error('Error fetching progress:', error);
        res.status(500).json({ error: 'Error fetching progress', details: error.message });
    }
}));
router.get('/api/skills-hub/classroom-mastery', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { classroomId, subject } = req.query;
        if (!classroomId) {
            return res.status(400).json({ error: 'classroomId is required' });
        }
        const classroom = yield prisma_1.default.classroom.findUnique({
            where: { id: classroomId },
            include: {
                students: {
                    select: { id: true, name: true, username: true }
                }
            }
        });
        if (!classroom) {
            return res.status(404).json({ error: 'Classroom not found' });
        }
        if (req.user.role !== 'SUPER_ADMIN' && classroom.schoolId !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const clusterWhere = Object.assign({ AND: [(0, skillAccess_1.skillSchoolWhere)(classroom.schoolId), (0, skillAccess_1.skillGradeWhere)((0, shared_1.getStudentGradeAndStage)(classroom.grade))] }, (subject ? { subject: String(subject) } : {}));
        const clusters = yield prisma_1.default.skillCluster.findMany({
            where: clusterWhere,
            include: {
                skills: {
                    include: {
                        activities: {
                            select: { id: true, points: true }
                        }
                    }
                }
            }
        });
        const activityIds = [];
        clusters.forEach(c => {
            c.skills.forEach(s => {
                s.activities.forEach(a => {
                    activityIds.push(a.id);
                });
            });
        });
        const studentIds = classroom.students.map(s => s.id);
        const attempts = yield prisma_1.default.activityAttempt.findMany({
            where: {
                userId: { in: studentIds },
                activityId: { in: activityIds }
            }
        });
        const studentAttemptsMap = new Map();
        studentIds.forEach(sid => studentAttemptsMap.set(sid, new Map()));
        attempts.forEach(att => {
            const userMap = studentAttemptsMap.get(att.userId);
            if (userMap) {
                const prev = userMap.get(att.activityId);
                if (!prev || att.stars > prev.stars) {
                    userMap.set(att.activityId, att);
                }
            }
        });
        const studentsReport = classroom.students.map(student => {
            const userMap = studentAttemptsMap.get(student.id);
            const clusterMasteryList = clusters.map(cluster => {
                let totalActivities = 0;
                let totalStars = 0;
                cluster.skills.forEach(skill => {
                    skill.activities.forEach(act => {
                        totalActivities++;
                        const bestAttempt = userMap === null || userMap === void 0 ? void 0 : userMap.get(act.id);
                        if (bestAttempt) {
                            totalStars += bestAttempt.stars;
                        }
                    });
                });
                const maxStars = totalActivities * 3;
                const masteryPercent = maxStars > 0 ? Math.round((totalStars / maxStars) * 100) : 0;
                return {
                    clusterId: cluster.id,
                    clusterName: cluster.name,
                    masteryPercent
                };
            });
            return {
                id: student.id,
                name: student.name,
                username: student.username,
                clusters: clusterMasteryList
            };
        });
        res.json({
            classroomId,
            className: classroom.name,
            grade: classroom.grade,
            subject,
            students: studentsReport
        });
    }
    catch (error) {
        console.error('Error fetching classroom mastery:', error);
        res.status(500).json({ error: 'Error fetching classroom mastery', details: error.message });
    }
}));
exports.default = router;
