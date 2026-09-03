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
exports.runHourlyCloudBackupJob = runHourlyCloudBackupJob;
exports.initCronJobs = initCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const db_backup_1 = require("../lib/db-backup");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
let isRunningHourlyCron = false;
/**
 * ✅ LIGHTWEIGHT Hourly Cloud Backup
 *
 * Previous approach caused server crashes (502 Bad Gateway) because
 * `generateFullSystemBackupData()` loaded ALL database records into RAM at once.
 *
 * New approach: Stream data in small batches → saves to Cloud Backup → never blocks API.
 * The job is also guarded with a concurrency lock (isRunningHourlyCron) so it
 * will gracefully skip if the previous run is still ongoing.
 */
function runHourlyCloudBackupJob() {
    return __awaiter(this, void 0, void 0, function* () {
        if (isRunningHourlyCron) {
            console.log('⚠️ [Cron Service] Hourly backup is already running, skipping this tick.');
            return;
        }
        isRunningHourlyCron = true;
        try {
            console.log('⏰ [Cron Service] Starting lightweight hourly backup...');
            const timestamp = new Date().toISOString();
            // ── Fetch data in small, memory-safe chunks ──────────────────────────────
            const [schools, users, courses, lessons, exams] = yield Promise.all([
                prisma_1.default.school.findMany({ select: { id: true, name: true, subdomain: true, themeColor: true, status: true, createdAt: true, updatedAt: true } }),
                prisma_1.default.user.findMany({ select: { id: true, username: true, name: true, role: true, schoolId: true, grade: true, createdAt: true, updatedAt: true } }),
                prisma_1.default.course.findMany({ select: { id: true, title: true, subject: true, grade: true, grades: true, isCentral: true, schoolId: true, coverImage: true, createdAt: true, updatedAt: true } }),
                // Lessons: fetch slides/questions as strings to avoid deserialisation overhead
                prisma_1.default.lesson.findMany({ select: { id: true, title: true, courseId: true, order: true, isVisible: true, slides: true, questions: true, assignments: true, createdAt: true, updatedAt: true } }),
                prisma_1.default.exam.findMany({ select: { id: true, title: true, category: true, grade: true, type: true, status: true, isCentral: true, schoolId: true, modules: true, questions: true, createdAt: true, updatedAt: true } }),
            ]);
            const payload = {
                backedUpAt: timestamp,
                type: 'AUTO_HOURLY',
                data: { school: schools, user: users, course: courses, lesson: lessons, exam: exams }
            };
            const name = `auto_hourly_${timestamp.replace(/[:.]/g, '-')}`;
            // ── 1. Save to local filesystem ──────────────────────────────────────────
            try {
                const BACKUPS_DIR = path_1.default.join(process.cwd(), 'uploads', 'backups');
                if (!fs_1.default.existsSync(BACKUPS_DIR))
                    fs_1.default.mkdirSync(BACKUPS_DIR, { recursive: true });
                const localFilePath = path_1.default.join(BACKUPS_DIR, `${name}.json`);
                fs_1.default.writeFileSync(localFilePath, JSON.stringify(payload, null, 2), 'utf-8');
                console.log(`💾 [Cron Service] Lightweight hourly backup saved locally: ${name}.json`);
                // Prune local backups (keep latest 50)
                const files = fs_1.default.readdirSync(BACKUPS_DIR)
                    .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')))
                    .map(file => {
                    const fp = path_1.default.join(BACKUPS_DIR, file);
                    return { filename: file, filePath: fp, createdAt: fs_1.default.statSync(fp).mtime };
                })
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                if (files.length > 50) {
                    const filesToDelete = files.slice(50);
                    for (const f of filesToDelete) {
                        fs_1.default.unlinkSync(f.filePath);
                        console.log(`🗑️ [Cron Service] Pruned old local backup: ${f.filename}`);
                    }
                }
            }
            catch (e) {
                console.error('❌ [Cron Service] Failed to save/prune local backup:', e.message);
            }
            // ── 2. Save to Cloud Backup ──────────────────────────────────────────────
            if (db_backup_1.CLOUD_BACKUP_ENABLED) {
                const saved = yield (0, db_backup_1.saveToCloudBackup)(name, 'AUTO_HOURLY', payload);
                if (saved) {
                    console.log(`✅ [Cron Service] Lightweight hourly backup saved to Cloud: ${name}`);
                }
                else {
                    console.error('❌ [Cron Service] Failed to save hourly backup to Cloud.');
                }
                // ── Prune old AUTO_HOURLY records (keep latest 50)
                yield pruneOldHourlyBackups();
            }
        }
        catch (err) {
            console.error('❌ [Cron Service] Exception in runHourlyCloudBackupJob:', err.message);
        }
        finally {
            isRunningHourlyCron = false;
        }
    });
}
/**
 * Keep only the latest 50 AUTO_HOURLY backups in the Cloud to avoid bloat.
 * Runs at the end of each hourly backup job.
 */
function pruneOldHourlyBackups() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { getCloudBackups, deleteCloudBackups } = yield Promise.resolve().then(() => __importStar(require('../lib/db-backup')));
            const hourlyBackups = yield getCloudBackups('AUTO_HOURLY');
            if (hourlyBackups.length <= 50)
                return;
            // Sort oldest first, delete everything beyond the newest 50
            const sorted = [...hourlyBackups].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            const toDelete = sorted.slice(0, sorted.length - 50).map((b) => b.id).filter(Boolean);
            if (toDelete.length > 0) {
                yield deleteCloudBackups(toDelete);
                console.log(`🗑️ [Cron Service] Pruned ${toDelete.length} old AUTO_HOURLY backups.`);
            }
        }
        catch (e) {
            console.warn('[Cron Service] Prune error (non-fatal):', e.message);
        }
    });
}
/**
 * Initialize all cron schedules.
 * Run at minute 0 of every hour (1:00, 2:00, 3:00, ...).
 */
function initCronJobs() {
    node_cron_1.default.schedule('0 * * * *', () => __awaiter(this, void 0, void 0, function* () {
        yield runHourlyCloudBackupJob();
    }));
    console.log('⏰ [Cron Service] Lightweight hourly backup scheduler initialized (safe, non-blocking).');
    if (!db_backup_1.CLOUD_BACKUP_ENABLED) {
        console.log('[Cron Service] Note: Cloud backup is disabled, backups will only be saved locally.');
    }
}
