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
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('\n🤖 [Auto-Recover] Starting automatic slide recovery script...');
        // 1. Fetch all lessons currently in the database
        console.log('🤖 [Auto-Recover] Fetching active lessons from database...');
        const activeLessons = yield prisma.lesson.findMany({
            select: { id: true, title: true, slides: true, courseId: true }
        });
        console.log(`🤖 [Auto-Recover] Found ${activeLessons.length} lessons in the active database.`);
        const activeLessonsMap = new Map(activeLessons.map(l => [l.id, l]));
        // 2. Identify potential backup files to scan
        const searchDirs = [
            process.cwd(), // Root directory
            path.join(process.cwd(), 'uploads', 'backups'), // backups subdirectory
            '/app', // Docker container root
            '/app/uploads/backups' // Docker backups directory
        ];
        const backupFiles = [];
        searchDirs.forEach(dir => {
            try {
                if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                    const files = fs.readdirSync(dir);
                    files.forEach(file => {
                        if (file.endsWith('.json') && (file.startsWith('backup-') || file.includes('backup'))) {
                            const fullPath = path.join(dir, file);
                            if (!backupFiles.includes(fullPath)) {
                                backupFiles.push(fullPath);
                            }
                        }
                    });
                }
            }
            catch (e) {
                // Skip directories that can't be read
            }
        });
        console.log(`🤖 [Auto-Recover] Found ${backupFiles.length} backup files to scan:`);
        backupFiles.forEach(f => console.log(`   - ${f}`));
        if (backupFiles.length === 0) {
            console.log('🤖 [Auto-Recover] No backup files found. Skipping recovery.');
            return;
        }
        let recoveryCount = 0;
        // 3. Scan each backup file for slides data
        for (const backupPath of backupFiles) {
            console.log(`\n🔍 [Auto-Recover] Scanning backup: ${backupPath}`);
            try {
                const content = fs.readFileSync(backupPath, 'utf8');
                const backupObj = JSON.parse(content);
                if (!backupObj || !backupObj.data || !Array.isArray(backupObj.data.lesson)) {
                    console.log(`   ⚠️ Invalid backup format in ${backupPath}. Skipping.`);
                    continue;
                }
                const backupLessons = backupObj.data.lesson;
                console.log(`   Found ${backupLessons.length} lessons in this backup.`);
                for (const backupLesson of backupLessons) {
                    const activeLesson = activeLessonsMap.get(backupLesson.id);
                    if (!activeLesson) {
                        // If the lesson doesn't exist in the active database, we don't restore it automatically
                        continue;
                    }
                    const fields = ['slides', 'questions', 'assignments', 'attachments'];
                    let lessonUpdated = false;
                    let updatePayload = {};
                    for (const field of fields) {
                        // Parse active
                        let activeCount = 0;
                        try {
                            const activeData = (typeof activeLesson[field] === 'string' ? JSON.parse(activeLesson[field]) : activeLesson[field]) || [];
                            activeCount = Array.isArray(activeData) ? activeData.length : 0;
                        }
                        catch (e) { }
                        // Parse backup
                        let backupCount = 0;
                        let backupData = [];
                        try {
                            if (backupLesson[field]) {
                                const parsedBackup = typeof backupLesson[field] === 'string' ? JSON.parse(backupLesson[field]) : backupLesson[field];
                                backupCount = Array.isArray(parsedBackup) ? parsedBackup.length : 0;
                                backupData = parsedBackup;
                            }
                        }
                        catch (e) { }
                        // Compare
                        if (backupCount > activeCount) {
                            console.log(`   ✨ [RECOVERABLE] Lesson "${activeLesson.title}" (${activeLesson.id}) - ${field}:`);
                            console.log(`      Active: ${activeCount} | Backup: ${backupCount} (in ${path.basename(backupPath)})`);
                            updatePayload[field] = backupData;
                            activeLesson[field] = backupData;
                            lessonUpdated = true;
                        }
                    }
                    if (lessonUpdated) {
                        console.log(`      💾 Restoring ${Object.keys(updatePayload).join(', ')} in database...`);
                        yield prisma.lesson.update({
                            where: { id: activeLesson.id },
                            data: updatePayload
                        });
                        recoveryCount++;
                        console.log(`      ✅ Restored successfully!`);
                    }
                }
            }
            catch (err) {
                console.error(`   ❌ Error reading/parsing backup ${backupPath}:`, err.message);
            }
        }
        console.log(`\n🤖 [Auto-Recover] Completed. Recovered/restored ${recoveryCount} lessons.`);
    });
}
// ─── ENTRY POINT GUARD ───────────────────────────────────────────────────────
// Run manually ONLY: npx tsx src/scripts/auto-recover.ts
// Must NEVER run automatically on server startup or when imported.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    main()
        .catch((err) => console.error('🤖 [Auto-Recover] Critical Error:', err))
        .finally(() => __awaiter(void 0, void 0, void 0, function* () {
        yield prisma.$disconnect();
        console.log('🤖 [Auto-Recover] Disconnected from database.\n');
    }));
}
