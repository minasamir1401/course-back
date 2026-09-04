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
const examsController = __importStar(require("../controllers/exams.controller"));
const express_1 = require("express");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const router = (0, express_1.Router)();
const requireManagedExam = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const exam = yield prisma_1.default.exam.findUnique({
            where: { id: req.params.id },
            include: { schools: { select: { id: true } } },
        });
        if (!exam)
            return res.status(404).json({ error: 'Exam not found' });
        if (!(yield examsController.canManageExam(req.user, exam))) {
            return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
        }
        next();
    }
    catch (_a) {
        return res.status(500).json({ error: 'Unable to verify exam access' });
    }
});
// ==========================================
// 🏆 STUDENT PORTFOLIO (GAMIFICATION) API
// ==========================================
router.get('/api/progress/portfolio', auth_1.verifyToken, examsController.getExamHandler1);
router.post('/api/exams', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.postExamHandler2);
// 2. List Exams (with filters)
router.get('/api/exams', auth_1.verifyToken, examsController.getExamHandler3);
// 2.5 Get Central Question Bank
router.get('/api/bank/questions', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.getExamHandler4);
// 3. Update Exam
router.put('/api/exams/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.putExamHandler5);
// 4. Get Exam Details
router.delete('/api/exams/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), examsController.deleteExamHandler6);
// Restore Exam
router.post('/api/admin/exams/:id/restore', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), examsController.postExamHandler7);
// Restore Question
router.post('/api/admin/questions/:id/restore', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), examsController.postExamHandler8);
router.get('/api/exams/:id/analytics', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.getExamHandler9);
// 4. Get Exam Details
router.get('/api/exams/:id', auth_1.verifyToken, examsController.getExamHandler10);
// Check if student can take the exam (attempts, password, dates)
router.post('/api/exams/:id/verify-access', auth_1.verifyToken, examsController.postExamHandler11);
// Check if student already took the exam
router.get('/api/exams/:id/check', auth_1.verifyToken, examsController.getExamHandler12);
// 4. Submit Exam
router.post('/api/exams/:id/submit', auth_1.verifyToken, (0, auth_1.checkRole)(['STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER']), examsController.postExamHandler13);
// 5. Get Submission Details
router.get('/api/exams/submissions/:id', auth_1.verifyToken, examsController.getExamHandler14);
// 6. Get All Submissions for an Exam (for Analytics)
router.get('/api/exams/:id/submissions', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.getExamHandler15);
router.post('/api/admin/exams/:id/restore', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), examsController.postExamHandler16);
router.post('/api/admin/questions/:id/restore', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), examsController.postExamHandler17);
// ==========================================
// 📦 INTERNAL EXAM MODULES API
// ==========================================
router.post('/api/exams/:id/modules', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postExamHandler18);
router.put('/api/exams/:id/modules/:moduleId', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.putExamHandler19);
router.delete('/api/exams/:id/modules/:moduleId', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), requireManagedExam, examsController.deleteExamHandler20);
router.post('/api/exams/:id/modules/:moduleId/exams', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postExamHandler28);
router.post('/api/exams/:id/modules/:moduleId/exams/:subExamId/collect-questions', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postExamHandler33);
router.put('/api/exams/:id/modules/:moduleId/exams/:subExamId', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.putExamHandler29);
router.delete('/api/exams/:id/modules/:moduleId/exams/:subExamId', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), requireManagedExam, examsController.deleteExamHandler30);
router.get('/api/exams/:id/modules/:moduleId/exams/:subExamId/export-json', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.getExamHandler31);
router.post('/api/exams/:id/modules/:moduleId/exams/import-json', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, shared_1.multerUpload.single('file'), examsController.postExamHandler32);
// ==========================================
// EXAM FOLDERS (MODULES) API
// ==========================================
router.get('/api/exam-folders', auth_1.verifyToken, examsController.getExamHandler21);
router.post('/api/exam-folders', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), examsController.postExamHandler22);
router.put('/api/exam-folders/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), examsController.putExamHandler23);
router.delete('/api/exam-folders/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), examsController.deleteExamHandler24);
router.post('/api/exams/:id/move-standalone-questions', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.postExamHandler25);
router.post('/api/exams/:id/move-to-module', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.postExamHandler26);
exports.default = router;
