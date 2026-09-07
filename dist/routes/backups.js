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
exports.parseBackupBuffer = exports.performBackupAndPruning = exports.BACKUPS_DIR = void 0;
const multer_1 = __importDefault(require("multer"));
const backupSnapshot_1 = require("../lib/backupSnapshot");
const crypto_1 = require("crypto");
const backupsController = __importStar(require("../controllers/backups.controller"));
var backups_controller_1 = require("../controllers/backups.controller");
Object.defineProperty(exports, "BACKUPS_DIR", { enumerable: true, get: function () { return backups_controller_1.BACKUPS_DIR; } });
Object.defineProperty(exports, "performBackupAndPruning", { enumerable: true, get: function () { return backups_controller_1.performBackupAndPruning; } });
Object.defineProperty(exports, "parseBackupBuffer", { enumerable: true, get: function () { return backups_controller_1.parseBackupBuffer; } });
const backups_controller_2 = require("../controllers/backups.controller");
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const archiver = require('archiver');
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
function createZipArchive(options = { zlib: { level: 9 } }) {
    if (archiver.ZipArchive) {
        return new archiver.ZipArchive(options);
    }
    if (typeof archiver === 'function')
        return archiver('zip', options);
    if (archiver.create)
        return archiver.create('zip', options);
    if (archiver.default)
        return archiver.default('zip', options);
    throw new Error('Could not instantiate zip archiver.');
}
function writeJsonZip(filePath, entryName, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        yield new Promise((resolve, reject) => {
            const output = fs_1.default.createWriteStream(filePath);
            const archive = createZipArchive({ zlib: { level: 9 } });
            output.on('close', () => resolve());
            output.on('error', reject);
            archive.on('error', reject);
            archive.pipe(output);
            archive.append(JSON.stringify(payload), { name: entryName });
            archive.finalize();
        });
    });
}
// --- Extracted from lines 1685-1797 ---
let storageReady;
router.use('/api/admin/backup', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    (storageReady || (storageReady = (0, backupSnapshot_1.ensureBackupStorage)())).then(() => next(), next);
});
const backupUpload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, done) => done(null, backups_controller_2.BACKUPS_DIR),
        filename: (_req, _file, done) => done(null, 'upload-' + (0, crypto_1.randomUUID)() + '.tmp')
    }),
    limits: { fileSize: 100 * 1024 * 1024, files: 1 }
});
// Helper function to fetch all database records cleanly as a backup payload
// Helper function to perform data backup — saves locally AND to Cloud Backup cloud
// --- Extracted from lines 1984-2304 ---
router.post('/api/admin/backup/create', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler1);
// 2. List Backups (Merging Local and Cloud)
router.get('/api/admin/backup/list', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.getBackupHandler2);
// 2.1 List Cloud Backups (Cloud Backup)
router.get('/api/admin/backup/cloud-list', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.getBackupHandler3);
// 2.2 Create Cloud Backup right now (Cloud Backup)
router.post('/api/admin/backup/cloud-create', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler4);
// 2.3 Force full sync of ALL PostgreSQL courses to Cloud Backup as a REALTIME_SYNC record
// Use this to recover from missing courses in Cloud Backup (e.g. a newly added course not appearing in cloud)
router.post('/api/admin/backup/cloud-sync-all', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler5);
// ════════════════════════════════════════════════════════════════════
// 2.4 Restore from Cloud → Pull cloud backup data into primary DB
// Use this when courses appear as "☁️ Backup DB Only" (exist in cloud
// but are missing from the primary PostgreSQL database).
// Finds the latest REALTIME_SYNC or AUTO_HOURLY cloud record, then
// upserts all missing courses and their embedded lessons into primary DB.
// ════════════════════════════════════════════════════════════════════
router.post('/api/admin/backup/restore-from-cloud', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler6);
// 3. Download Backup
router.get('/api/admin/backup/download/:filename', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.getBackupHandler7);
// 3.4.5 Download Full Backup with Media
router.get('/api/admin/backup/download-full-with-media', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.getBackupHandler8);
// 3.5 Download All Backups as ZIP
router.get('/api/admin/backup/download-all', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.getBackupHandler9);
// 3.6 Manual Bundle All Backups to DB
router.post('/api/admin/backup/bundle-manual', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler10);
// 4. Upload Backup
router.post('/api/admin/backup/upload', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupUpload.single('file'), backupsController.postBackupHandler11);
// Delete Backup
router.delete('/api/admin/backup/:filename', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.deleteBackupHandler12);
// 5. Restore Backup (local file OR cloud backup)
router.post('/api/admin/backup/restore', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler13);
// 6. Partial Restore: Restore only the lessons of a specific course from backup
router.post('/api/admin/backup/restore-course', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler14);
// 7. Search for a lesson across ALL sources: Active DB, Local Backup Files, and Cloud Backup DB
router.get('/api/admin/backup/search-lesson', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.getBackupHandler15);
// Explore Backup: Parses a backup file and returns a skeletal tree of its contents (Courses -> Lessons/Exams)
router.post('/api/admin/backup/explore', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler16);
// Selective Restore: Restores specific selected items from a backup
router.post('/api/admin/backup/selective-restore', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler17);
// Temporary endpoint to force restore specific lesson to specific course
router.get('/api/admin/force-restore-work', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.getBackupHandler18);
// 8. Partial Restore: Restore a single lesson (and its parent course if missing) from any backup source
router.post('/api/admin/backup/restore-lesson', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler19);
// ==========================================
// 9. 🎯 RESTORE LESSON CONTENT (Quizzes, Assignments, Slides, Attachments)
//    Reads a backup file and restores Q, A, Slides, Attachments for every lesson.
//    Uses "richer data wins" — only overwrites if backup has MORE items.
//    POST /api/admin/backup/restore-lesson-content
//    Body: { filename: "backup-xxx.json" }  OR  { useLatest: true }
// ==========================================
router.post('/api/admin/backup/restore-lesson-content', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), backupsController.postBackupHandler20);
// ==========================================
// 🏫 CLASSROOM ROUTES
// ==========================================
exports.default = router;
