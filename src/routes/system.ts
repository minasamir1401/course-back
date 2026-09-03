import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import { 
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields, 
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses
} from '../shared';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const router = Router();

// --- Extracted from lines 645-649 ---
router.get('/api/health', async (req: any, res: any) => {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database health check timed out')), 5_000)),
    ]);
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({
      status: 'degraded',
      error: 'Database unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

// Serve uploaded files as static assets with Cache-Control

router.post('/api/upload', verifyToken, (req: Request, res: Response) => {
  multerUpload.single('file')(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ error: 'Upload failed', details: err.message });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }
      const fileUrl = `/uploads/${req.file.filename}`;
      return res.json({
        message: 'File uploaded successfully',
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });
    } catch (innerErr: any) {
      return res.status(500).json({ error: 'Upload processing failed', details: innerErr.message });
    }
  });
});

// ==========================================
// 👥 BULK USER IMPORT (Excel → JSON payload)
// ==========================================

// Protected admin-only migration trigger
router.post('/api/system/migrate-images-now', verifyToken, checkRole(['SUPER_ADMIN']), (req: any, res: any) => {
  const { exec } = require('child_process');
  exec('npm run migrate:images', (error: any, stdout: any, stderr: any) => {
    if (error) {
      return res.status(500).json({ error: error.message, stderr });
    }
    res.json({ message: "Migration triggered successfully!", stdout });
  });
});

// 🔴 DANGER: WIPE ALL DUMMY DATA 🔴
router.post('/api/system/wipe-all-dummy-data-danger', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { confirm, dryRun } = req.body;

    if (dryRun) {
      const users = await prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' } } });
      const lessons = await prisma.lesson.count();
      const exams = await prisma.exam.count();
      return res.json({ success: true, message: "Dry run mode.", counts: { users, lessons, exams } });
    }

    if (confirm !== 'WIPE_EVERYTHING') {
      return res.status(400).json({ error: "Confirmation required. Send { confirm: 'WIPE_EVERYTHING' } to proceed." });
    }

    await prisma.studentAnswer.deleteMany();
    await prisma.examSubmission.deleteMany();
    await prisma.blockAnswer.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.xPHistory.deleteMany();
    await prisma.lessonProgress.deleteMany();
    await prisma.courseProgress.deleteMany();
    await prisma.activityLog.deleteMany();
    await prisma.deletedTombstone.deleteMany();

    await prisma.question.deleteMany();
    await prisma.exam.deleteMany();

    await prisma.interactiveActivity.deleteMany();
    await prisma.skillLesson.deleteMany();
    await prisma.skillCluster.deleteMany();
    await prisma.dynamicSection.deleteMany();
    await prisma.lessonBlock.deleteMany();
    await prisma.lesson.deleteMany();

    await prisma.studentEnrollment.deleteMany();
    await prisma.teacherCourse.deleteMany();
    await prisma.course.deleteMany();

    await prisma.classroom.deleteMany();

    const deleteUsersResult = await prisma.user.deleteMany({
      where: { role: { not: 'SUPER_ADMIN' } }
    });
    
    res.json({ success: true, message: "Database wiped successfully", usersDeleted: deleteUsersResult.count });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// ??? DANGER: WIPE SEEDED DUMMY DATA ONLY
// Requires body: { confirm: 'WIPE_DUMMY_DATA' }. Supports dry_run: true to preview.
router.post('/api/system/wipe-seeded-dummy-data', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
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
    const dummySchools = await prisma.school.findMany({ where: { subdomain: { in: DUMMY_DOMAINS } } });
    
    if (dummySchools.length === 0) {
      return res.json({ message: "No dummy schools found." });
    }

    const schoolIds = dummySchools.map(s => s.id);

    if (dry_run) {
      const userCount = await prisma.user.count({ where: { schoolId: { in: schoolIds } } });
      const courseCount = await prisma.course.count({ where: { schoolId: { in: schoolIds } } });
      return res.json({
        dry_run: true,
        message: "Preview only — no data deleted. Remove dry_run: true to execute.",
        schools: dummySchools.map(s => ({ id: s.id, subdomain: s.subdomain })),
        would_delete: { users: userCount, courses: courseCount, schools: dummySchools.length }
      });
    }

    await prisma.user.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await prisma.lesson.deleteMany({ where: { course: { schoolId: { in: schoolIds } } } });
    await prisma.course.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await prisma.classroom.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });

    res.json({ message: "Dummy data wiped successfully!", deleted_schools: schoolIds.length });
  } catch (error: any) {
    console.error("Error wiping dummy data:", error);
    res.status(500).json({ error: "Failed to wipe dummy data", details: error.message });
  }
});

export default router;