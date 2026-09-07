import * as examsController from "../controllers/exams.controller";
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import {
  buildQuestionFingerprint,
  pickReconciliationCandidate,
  sortPersistedOrder,
} from '../lib/contentReconciliation';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import {
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields,
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses, acquireLock, releaseLock, extractAndSaveBase64Images
} from '../shared';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const router = Router();

const requireManagedExam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: { schools: { select: { id: true } } },
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (!await examsController.canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
    }
    next();
  } catch {
    return res.status(500).json({ error: 'Unable to verify exam access' });
  }
};







// ==========================================
// 🏆 STUDENT PORTFOLIO (GAMIFICATION) API
// ==========================================
router.get('/api/progress/portfolio', verifyToken, examsController.getExamHandler1);

router.post('/api/exams', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.postExamHandler2);

// 2. List Exams (with filters)
router.get('/api/exams', verifyToken, examsController.getExamHandler3);

// 2.5 Get Central Question Bank
router.get('/api/bank/questions', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.getExamHandler4);

// 3. Update Exam
router.put('/api/exams/:id', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.putExamHandler5);

// Clean duplicate & empty questions in exam
router.post('/api/exams/:id/clean-duplicates', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.cleanDuplicatesHandler);
router.post('/api/admin/clean-duplicates', verifyToken, checkRole(['SUPER_ADMIN']), examsController.cleanDuplicatesHandler);

// 4. Get Exam Details
router.delete('/api/exams/:id', verifyToken, checkRole(['SUPER_ADMIN']), examsController.deleteExamHandler6);

// Restore Exam
router.post('/api/admin/exams/:id/restore', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), examsController.postExamHandler7);

// Restore Question
router.post('/api/admin/questions/:id/restore', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), examsController.postExamHandler8);

router.get('/api/exams/:id/analytics', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.getExamHandler9);

// 3.8 Get Exam Questions only (Deferred/Background Load)
router.get('/api/exams/:id/questions', verifyToken, examsController.getExamQuestionsHandler);

// 4. Get Exam Details
router.get('/api/exams/:id', verifyToken, examsController.getExamHandler10);

// Check if student can take the exam (attempts, password, dates)
router.post('/api/exams/:id/verify-access', verifyToken, examsController.postExamHandler11);

// Check if student already took the exam
router.get('/api/exams/:id/check', verifyToken, examsController.getExamHandler12);

// 4. Submit Exam
router.post('/api/exams/:id/submit', verifyToken, checkRole(['STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER']), examsController.postExamHandler13);

// 5. Get Submission Details
router.get('/api/exams/submissions/:id', verifyToken, examsController.getExamHandler14);

// 6. Get All Submissions for an Exam (for Analytics)
router.get('/api/exams/:id/submissions', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.getExamHandler15);


router.post('/api/admin/exams/:id/restore', verifyToken, checkRole(['SUPER_ADMIN']), examsController.postExamHandler16);

router.post('/api/admin/questions/:id/restore', verifyToken, checkRole(['SUPER_ADMIN']), examsController.postExamHandler17);

// ==========================================
// 📦 INTERNAL EXAM MODULES API
// ==========================================

router.post('/api/exams/:id/modules', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postExamHandler18);

router.put('/api/exams/:id/modules/:moduleId', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.putExamHandler19);

router.delete('/api/exams/:id/modules/:moduleId', verifyToken, checkRole(['SUPER_ADMIN']), requireManagedExam, examsController.deleteExamHandler20);
router.post('/api/exams/:id/modules/:moduleId/exams', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postExamHandler28);
router.post('/api/exams/:id/modules/:moduleId/exams/:subExamId/collect-questions', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postExamHandler33);
router.put('/api/exams/:id/modules/:moduleId/exams/:subExamId', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.putExamHandler29);
router.delete('/api/exams/:id/modules/:moduleId/exams/:subExamId', verifyToken, checkRole(['SUPER_ADMIN']), requireManagedExam, examsController.deleteExamHandler30);
router.post('/api/exams/:id/modules/:moduleId/exams/:subExamId/move', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postMoveSubExamHandler);
router.post('/api/exams/:id/modules/:moduleId/exams/move-all', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postMoveAllSubExamsHandler);
router.post('/api/exams/:id/modules/:moduleId/move-module', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.postMoveModuleHandler);
router.get('/api/exams/:id/modules/:moduleId/exams/:subExamId/export-json', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, examsController.getExamHandler31);
router.post('/api/exams/:id/modules/:moduleId/exams/import-json', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), requireManagedExam, multerUpload.single('file'), examsController.postExamHandler32);

// ==========================================
// EXAM FOLDERS (MODULES) API
// ==========================================
router.get('/api/exam-folders', verifyToken, examsController.getExamHandler21);

router.post('/api/exam-folders', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), examsController.postExamHandler22);

router.put('/api/exam-folders/:id', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), examsController.putExamHandler23);

router.delete('/api/exam-folders/:id', verifyToken, checkRole(['SUPER_ADMIN']), examsController.deleteExamHandler24);


router.post('/api/exams/:id/move-standalone-questions', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.postExamHandler25);

router.post('/api/exams/:id/move-to-module', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), examsController.postExamHandler26);



export default router;
