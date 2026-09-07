import multer from 'multer';
import { ensureBackupStorage } from '../lib/backupSnapshot';
import { randomUUID } from 'crypto';
import * as backupsController from "../controllers/backups.controller";
export { BACKUPS_DIR, performBackupAndPruning, parseBackupBuffer } from "../controllers/backups.controller";
import { BACKUPS_DIR, parseBackupBuffer } from "../controllers/backups.controller";
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
const archiver = require('archiver') as any;
import prisma from '../lib/prisma';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import {
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields,
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses, externalizeEmbeddedDataImages
} from '../shared';
import { saveToCloudBackup, getCloudBackups, createManualBundle } from '../lib/db-backup';
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}
const router = Router();
function createZipArchive(options: any = { zlib: { level: 9 } }) {
  if (archiver.ZipArchive) {
    return new archiver.ZipArchive(options);
  }
  if (typeof archiver === 'function') return archiver('zip', options);
  if (archiver.create) return archiver.create('zip', options);
  if (archiver.default) return archiver.default('zip', options);
  throw new Error('Could not instantiate zip archiver.');
}
async function writeJsonZip(filePath: string, entryName: string, payload: any): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = createZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(JSON.stringify(payload), { name: entryName });
    archive.finalize();
  });
}


// --- Extracted from lines 1685-1797 ---
let storageReady: Promise<void> | undefined;
router.use('/api/admin/backup', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  (storageReady ||= ensureBackupStorage()).then(() => next(), next);
});
const backupUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, BACKUPS_DIR),
    filename: (_req, _file, done) => done(null, 'upload-' + randomUUID() + '.tmp')
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 }
});
// Helper function to fetch all database records cleanly as a backup payload
// Helper function to perform data backup — saves locally AND to Cloud Backup cloud
// --- Extracted from lines 1984-2304 ---
router.post('/api/admin/backup/create', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler1);
// 2. List Backups (Merging Local and Cloud)
router.get('/api/admin/backup/list', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.getBackupHandler2);
// 2.1 List Cloud Backups (Cloud Backup)
router.get('/api/admin/backup/cloud-list', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.getBackupHandler3);
// 2.2 Create Cloud Backup right now (Cloud Backup)
router.post('/api/admin/backup/cloud-create', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler4);
// 2.3 Force full sync of ALL PostgreSQL courses to Cloud Backup as a REALTIME_SYNC record
// Use this to recover from missing courses in Cloud Backup (e.g. a newly added course not appearing in cloud)
router.post('/api/admin/backup/cloud-sync-all', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler5);
// ════════════════════════════════════════════════════════════════════
// 2.4 Restore from Cloud → Pull cloud backup data into primary DB
// Use this when courses appear as "☁️ Backup DB Only" (exist in cloud
// but are missing from the primary PostgreSQL database).
// Finds the latest REALTIME_SYNC or AUTO_HOURLY cloud record, then
// upserts all missing courses and their embedded lessons into primary DB.
// ════════════════════════════════════════════════════════════════════
router.post('/api/admin/backup/restore-from-cloud', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler6);
// 3. Download Backup
router.get('/api/admin/backup/download/:filename', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.getBackupHandler7);
// 3.4.5 Download Full Backup with Media
router.get('/api/admin/backup/download-full-with-media', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.getBackupHandler8);
// 3.5 Download All Backups as ZIP
router.get('/api/admin/backup/download-all', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.getBackupHandler9);
// 3.6 Manual Bundle All Backups to DB
router.post('/api/admin/backup/bundle-manual', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler10);
// 4. Upload Backup
router.post('/api/admin/backup/upload', verifyToken, checkRole(['SUPER_ADMIN']), backupUpload.single('file'), backupsController.postBackupHandler11);
// Delete Backup
router.delete('/api/admin/backup/:filename', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.deleteBackupHandler12);
// 5. Restore Backup (local file OR cloud backup)
router.post('/api/admin/backup/restore', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler13);
// 6. Partial Restore: Restore only the lessons of a specific course from backup
router.post('/api/admin/backup/restore-course', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler14);
// 7. Search for a lesson across ALL sources: Active DB, Local Backup Files, and Cloud Backup DB
router.get('/api/admin/backup/search-lesson', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.getBackupHandler15);
// Explore Backup: Parses a backup file and returns a skeletal tree of its contents (Courses -> Lessons/Exams)
router.post('/api/admin/backup/explore', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler16);
// Selective Restore: Restores specific selected items from a backup
router.post('/api/admin/backup/selective-restore', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler17);
// Temporary endpoint to force restore specific lesson to specific course
router.get('/api/admin/force-restore-work', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.getBackupHandler18);
// 8. Partial Restore: Restore a single lesson (and its parent course if missing) from any backup source
router.post('/api/admin/backup/restore-lesson', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler19);
// ==========================================
// 9. 🎯 RESTORE LESSON CONTENT (Quizzes, Assignments, Slides, Attachments)
//    Reads a backup file and restores Q, A, Slides, Attachments for every lesson.
//    Uses "richer data wins" — only overwrites if backup has MORE items.
//    POST /api/admin/backup/restore-lesson-content
//    Body: { filename: "backup-xxx.json" }  OR  { useLatest: true }
// ==========================================
router.post('/api/admin/backup/restore-lesson-content', verifyToken, checkRole(['SUPER_ADMIN']), backupsController.postBackupHandler20);
// ==========================================
// 🏫 CLASSROOM ROUTES
// ==========================================
export default router;