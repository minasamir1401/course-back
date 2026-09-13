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
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const translation_service_1 = require("../services/translation.service");
const router = (0, express_1.Router)();
// ==========================================
// SYSTEM & HEALTH API
// ==========================================
router.get('/api/health', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield prisma_1.default.$queryRaw `SELECT 1`;
        return res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    }
    catch (err) {
        return res.status(503).json({
            status: 'error',
            database: 'disconnected',
            error: 'Database unavailable',
            timestamp: new Date().toISOString(),
        });
    }
}));
// Serve uploaded files as static assets with Cache-Control
router.post('/api/upload', auth_1.verifyToken, (req, res) => {
    shared_1.multerUpload.single('file')(req, res, (err) => __awaiter(void 0, void 0, void 0, function* () {
        if (err) {
            return res.status(400).json({ error: 'Upload failed', details: err.message });
        }
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file provided.' });
            }
            const persisted = yield (0, shared_1.persistUpload)(req.file.path, req.file.filename, req.file.mimetype);
            return res.json({
                message: 'File uploaded successfully',
                url: persisted.url,
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                isCloud: persisted.isCloud,
            });
        }
        catch (innerErr) {
            return res.status(500).json({ error: 'Upload processing failed', details: innerErr.message });
        }
    }));
});
// Protected admin-only migration trigger
router.post('/api/system/migrate-images-now', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => {
    const { exec } = require('child_process');
    exec('npm run migrate:images', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: error.message, stderr });
        }
        res.json({ message: "Migration triggered successfully!", stdout });
    });
});
router.post('/api/system/wipe-all-dummy-data-danger', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { confirm, dryRun } = req.body;
        if (dryRun) {
            const users = yield prisma_1.default.user.count({ where: { role: { not: 'SUPER_ADMIN' } } });
            const lessons = yield prisma_1.default.lesson.count();
            const exams = yield prisma_1.default.exam.count();
            return res.json({ success: true, message: "Dry run mode.", counts: { users, lessons, exams } });
        }
        if (confirm !== 'WIPE_EVERYTHING') {
            return res.status(400).json({ error: "Confirmation required. Send { confirm: 'WIPE_EVERYTHING' } to proceed." });
        }
        yield prisma_1.default.studentAnswer.deleteMany();
        yield prisma_1.default.examSubmission.deleteMany();
        yield prisma_1.default.blockAnswer.deleteMany();
        yield prisma_1.default.activityAttempt.deleteMany();
        yield prisma_1.default.xPHistory.deleteMany();
        yield prisma_1.default.lessonProgress.deleteMany();
        yield prisma_1.default.courseProgress.deleteMany();
        yield prisma_1.default.activityLog.deleteMany();
        yield prisma_1.default.deletedTombstone.deleteMany();
        yield prisma_1.default.question.deleteMany();
        yield prisma_1.default.exam.deleteMany();
        yield prisma_1.default.interactiveActivity.deleteMany();
        yield prisma_1.default.skillLesson.deleteMany();
        yield prisma_1.default.skillCluster.deleteMany();
        yield prisma_1.default.dynamicSection.deleteMany();
        yield prisma_1.default.lessonBlock.deleteMany();
        yield prisma_1.default.lesson.deleteMany();
        yield prisma_1.default.studentEnrollment.deleteMany();
        yield prisma_1.default.teacherCourse.deleteMany();
        yield prisma_1.default.course.deleteMany();
        yield prisma_1.default.classroom.deleteMany();
        const deleteUsersResult = yield prisma_1.default.user.deleteMany({
            where: { role: { not: 'SUPER_ADMIN' } }
        });
        res.json({ success: true, message: "Database wiped successfully", usersDeleted: deleteUsersResult.count });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}));
// ??? DANGER: WIPE SEEDED DUMMY DATA ONLY
// Requires body: { confirm: 'WIPE_DUMMY_DATA' }. Supports dry_run: true to preview.
router.post('/api/system/wipe-seeded-dummy-data', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { confirm, dry_run } = req.body;
        // Require explicit confirmation string to prevent accidental or CSRF-triggered deletion
        if (confirm !== 'WIPE_DUMMY_DATA') {
            return res.status(400).json({
                error: "Confirmation required.",
                message: "Send { confirm: 'WIPE_DUMMY_DATA' } in the request body to proceed. Add dry_run: true to preview."
            });
        }
        const DUMMY_DOMAINS = ['alrowad', 'nile', 'almanara'];
        const dummySchools = yield prisma_1.default.school.findMany({ where: { subdomain: { in: DUMMY_DOMAINS } } });
        if (dummySchools.length === 0) {
            return res.json({ message: "No dummy schools found." });
        }
        const schoolIds = dummySchools.map(s => s.id);
        if (dry_run) {
            const userCount = yield prisma_1.default.user.count({ where: { schoolId: { in: schoolIds } } });
            const courseCount = yield prisma_1.default.course.count({ where: { schoolId: { in: schoolIds } } });
            return res.json({
                dry_run: true,
                message: "Preview only — no data deleted. Remove dry_run: true to execute.",
                schools: dummySchools.map(s => ({ id: s.id, subdomain: s.subdomain })),
                would_delete: { users: userCount, courses: courseCount, schools: dummySchools.length }
            });
        }
        yield prisma_1.default.user.deleteMany({ where: { schoolId: { in: schoolIds } } });
        yield prisma_1.default.lesson.deleteMany({ where: { course: { schoolId: { in: schoolIds } } } });
        yield prisma_1.default.course.deleteMany({ where: { schoolId: { in: schoolIds } } });
        yield prisma_1.default.classroom.deleteMany({ where: { schoolId: { in: schoolIds } } });
        yield prisma_1.default.school.deleteMany({ where: { id: { in: schoolIds } } });
        res.json({ message: "Dummy data wiped successfully!", deleted_schools: schoolIds.length });
    }
    catch (error) {
        console.error("Error wiping dummy data:", error);
        res.status(500).json({ error: "Failed to wipe dummy data", details: error.message });
    }
}));
router.post('/api/translate', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { text, texts, from = 'ar', to = 'en' } = req.body;
        const validFrom = from === 'en' ? 'en' : 'ar';
        const validTo = to === 'ar' ? 'ar' : 'en';
        if (text !== undefined) {
            const translated = yield (0, translation_service_1.translateSingleText)(String(text || ''), validFrom, validTo);
            return res.json({ translatedText: translated });
        }
        if (Array.isArray(texts)) {
            const translations = yield (0, translation_service_1.translateBatchTexts)(texts, validFrom, validTo);
            return res.json({ translations });
        }
        return res.status(400).json({ error: 'Either "text" or "texts" must be provided.' });
    }
    catch (error) {
        console.error('Translation error:', error);
        return res.status(500).json({ error: 'Translation failed', details: error.message });
    }
}));
exports.default = router;
