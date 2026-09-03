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
const BACKUP_DIR = 'd:\\pj\\porj\\corse\\New folder';
const OUTPUT_FILE = path.join(process.cwd(), 'restored_exams_clean.json');
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
    // Replace 3 or more question marks with a space
    return str.replace(/\?{3,}/g, ' ');
}
// Recursively clean object strings
function cleanObject(obj) {
    if (typeof obj === 'string') {
        return cleanQuestionMarks(obj);
    }
    if (Array.isArray(obj)) {
        return obj.map(cleanObject);
    }
    if (obj !== null && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = cleanObject(obj[key]);
        }
        return newObj;
    }
    return obj;
}
function generateCleanExams() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`📂 Scanning backup directory: ${BACKUP_DIR}`);
        if (!fs.existsSync(BACKUP_DIR)) {
            console.error(`❌ Directory not found: ${BACKUP_DIR}`);
            return;
        }
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
            name: f,
            fullPath: path.join(BACKUP_DIR, f),
            mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
        }))
            .sort((a, b) => b.mtime - a.mtime); // Newest first
        console.log(`📄 Found ${files.length} backup files.`);
        const bestExams = new Map();
        const examScores = new Map();
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
                    if (!bestExams.has(e.id)) {
                        bestExams.set(e.id, e);
                        examScores.set(e.id, currentScore);
                    }
                    else {
                        // If this version has FEWER question marks, it means it's an older/cleaner version
                        const previousBestScore = examScores.get(e.id);
                        if (currentScore < previousBestScore) {
                            bestExams.set(e.id, e);
                            examScores.set(e.id, currentScore);
                        }
                    }
                }
            }
            catch (err) {
                console.warn(`  ⚠ Skipped ${file.name}: ${err.message}`);
            }
        }
        console.log(`✅ Extracted ${bestExams.size} unique exams with best possible texts.`);
        // Clean remaining ?
        const cleanedExams = Array.from(bestExams.values()).map(e => cleanObject(e));
        // Save to output file
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ exam: cleanedExams }, null, 2), 'utf-8');
        console.log(`🎉 Success! Saved clean exams to: ${OUTPUT_FILE}`);
    });
}
generateCleanExams().catch(console.error);
