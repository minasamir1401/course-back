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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LIVE_BACKUP_PATH = 'd:\\pj\\porj\\corse\\backup-2026-07-29T16-24-32-285Z.json';
const CLEAN_BACKUPS_DIR = 'd:\\pj\\porj\\corse\\New folder';
const OUTPUT_PATH = 'd:\\pj\\porj\\corse\\fully_fixed_backup.json';
// Helper to count how many question marks are in an object (recursively or by JSON string)
function countQuestionMarks(obj) {
    if (!obj)
        return 0;
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const matches = str.match(/\?/g);
    return matches ? matches.length : 0;
}
// Deep clean: replace 3 or more ? with an empty string, or some pattern
function cleanQuestionMarks(str) {
    if (!str)
        return str;
    return str.replace(/\?{3,}/g, ' ');
}
function cleanObject(obj) {
    if (typeof obj === 'string')
        return cleanQuestionMarks(obj);
    if (Array.isArray(obj))
        return obj.map(cleanObject);
    if (obj !== null && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj)
            newObj[key] = cleanObject(obj[key]);
        return newObj;
    }
    return obj;
}
function mergeBackups() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`📂 Scanning clean backups directory: ${CLEAN_BACKUPS_DIR}`);
        if (!fs.existsSync(CLEAN_BACKUPS_DIR)) {
            console.error(`❌ Directory not found: ${CLEAN_BACKUPS_DIR}`);
            return;
        }
        const files = fs.readdirSync(CLEAN_BACKUPS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
            fullPath: path.join(CLEAN_BACKUPS_DIR, f),
            mtime: fs.statSync(path.join(CLEAN_BACKUPS_DIR, f)).mtime.getTime()
        }))
            .sort((a, b) => b.mtime - a.mtime);
        const cleanExamsMap = new Map();
        const examScores = new Map();
        // 1. Build a map of the cleanest version of every exam
        for (const file of files) {
            try {
                const raw = fs.readFileSync(file.fullPath, 'utf-8');
                const parsed = JSON.parse(raw);
                const data = parsed.data || parsed;
                const backupExams = Array.isArray(data.exam) ? data.exam : [];
                for (const e of backupExams) {
                    if (!e || !e.id)
                        continue;
                    const currentScore = countQuestionMarks(e);
                    if (!cleanExamsMap.has(e.id)) {
                        cleanExamsMap.set(e.id, e);
                        examScores.set(e.id, currentScore);
                    }
                    else {
                        const previousBestScore = examScores.get(e.id);
                        if (currentScore < previousBestScore) {
                            cleanExamsMap.set(e.id, e);
                            examScores.set(e.id, currentScore);
                        }
                    }
                }
            }
            catch (err) {
                console.warn(`  ⚠ Skipped ${path.basename(file.fullPath)}: ${err.message}`);
            }
        }
        console.log(`✅ Extracted ${cleanExamsMap.size} cleanest exams from the historical backups.`);
        // 2. Load the Live Corrupted Backup
        console.log(`📥 Loading live corrupted backup: ${LIVE_BACKUP_PATH}`);
        const liveRaw = fs.readFileSync(LIVE_BACKUP_PATH, 'utf-8');
        const liveParsed = JSON.parse(liveRaw);
        const liveExams = liveParsed.data.exam || [];
        let fixedCount = 0;
        // 3. Merge clean text into live structure
        for (let i = 0; i < liveExams.length; i++) {
            const liveExam = liveExams[i];
            const cleanExam = cleanExamsMap.get(liveExam.id);
            if (cleanExam) {
                // If live exam title is corrupted, use clean title
                if (countQuestionMarks(liveExam.title) > countQuestionMarks(cleanExam.title)) {
                    liveExam.title = cleanObject(cleanExam.title);
                }
                if (countQuestionMarks(liveExam.description) > countQuestionMarks(cleanExam.description)) {
                    liveExam.description = cleanObject(cleanExam.description);
                }
                // Replace questions completely with the clean version's questions
                // The structure of questions is complex, so pulling from the clean version directly is safest
                liveExam.questions = cleanObject(cleanExam.questions || []);
                // Also clean up any other stray ? marks in the live exam
                liveExam.title = cleanObject(liveExam.title);
                liveExam.description = cleanObject(liveExam.description);
                fixedCount++;
            }
            else {
                // Exam exists in live but not in clean backups. Just clean whatever we have.
                liveExam.title = cleanObject(liveExam.title);
                liveExam.description = cleanObject(liveExam.description);
                liveExam.questions = cleanObject(liveExam.questions || []);
            }
        }
        liveParsed.data.exam = liveExams;
        console.log(`🔧 Fixed and merged text for ${fixedCount} exams.`);
        // 4. Save the Final fully fixed backup
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(liveParsed, null, 2), 'utf-8');
        console.log(`🎉 Success! Saved fully fixed backup to: ${OUTPUT_PATH}`);
    });
}
mergeBackups().catch(console.error);
