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
const crypto = __importStar(require("crypto"));
const prisma = new client_1.PrismaClient();
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const LOG_PATH = path.join(UPLOADS_DIR, 'cleanup-delete-log.txt');
// ── Hash ──────────────────────────────────────────────────────────────────────
function hashFile(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buf).digest('hex');
}
// ── Extract filenames referenced in DB ───────────────────────────────────────
function extractFilenames(text) {
    if (!text)
        return [];
    const matches = text.match(/\/uploads\/([^\s"'<>?]+)/g) || [];
    return matches.map(m => path.basename(m.split('?')[0]));
}
function extractFromJSON(value) {
    if (!value)
        return [];
    if (typeof value === 'string')
        return extractFilenames(value);
    if (Array.isArray(value))
        return value.flatMap(extractFromJSON);
    if (typeof value === 'object')
        return Object.values(value).flatMap(extractFromJSON);
    return [];
}
function collectUsedFilenames() {
    return __awaiter(this, void 0, void 0, function* () {
        const used = new Set();
        const courses = yield prisma.course.findMany({ select: { coverImage: true } });
        courses.forEach(c => extractFilenames(c.coverImage).forEach(f => used.add(f)));
        const users = yield prisma.user.findMany({ select: { avatar: true } });
        users.forEach(u => extractFilenames(u.avatar).forEach(f => used.add(f)));
        const questions = yield prisma.question.findMany({ select: { imageUrl: true, text: true, explanation: true } });
        questions.forEach(q => {
            extractFilenames(q.imageUrl).forEach(f => used.add(f));
            extractFilenames(q.text).forEach(f => used.add(f));
            extractFilenames(q.explanation).forEach(f => used.add(f));
        });
        const lessons = yield prisma.lesson.findMany({
            select: { content: true, notes: true, summary: true, slides: true, questions: true, attachments: true, assignments: true }
        });
        lessons.forEach(l => {
            extractFilenames(l.content).forEach(f => used.add(f));
            extractFilenames(l.notes).forEach(f => used.add(f));
            extractFilenames(l.summary).forEach(f => used.add(f));
            extractFromJSON(l.slides).forEach(f => used.add(f));
            extractFromJSON(l.questions).forEach(f => used.add(f));
            extractFromJSON(l.attachments).forEach(f => used.add(f));
            extractFromJSON(l.assignments).forEach(f => used.add(f));
        });
        const blocks = yield prisma.lessonBlock.findMany({ select: { content: true, options: true } });
        blocks.forEach(b => {
            extractFilenames(b.content).forEach(f => used.add(f));
            try {
                extractFromJSON(JSON.parse(b.options || '{}')).forEach(f => used.add(f));
            }
            catch (_a) { }
        });
        const sections = yield prisma.dynamicSection.findMany({ select: { content: true } });
        sections.forEach(s => extractFilenames(s.content).forEach(f => used.add(f)));
        return used;
    });
}
function runDelete() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🔍 جاري فحص قاعدة البيانات والملفات...');
        const usedFilenames = yield collectUsedFilenames();
        const allFiles = fs.readdirSync(UPLOADS_DIR).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.mp4', '.gif'].includes(ext);
        });
        const IMAGE_EXTS = ['.png', '.jpg', '.jpeg'];
        const toDelete = [];
        // ── 1. Old PNG/JPG that have been converted to WebP and DB updated ──────────
        for (const filename of allFiles) {
            const ext = path.extname(filename).toLowerCase();
            if (!IMAGE_EXTS.includes(ext))
                continue;
            const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
            const webpPath = path.join(UPLOADS_DIR, nameWithoutExt + '.webp');
            const hasWebP = fs.existsSync(webpPath);
            const isUsed = usedFilenames.has(filename);
            if (hasWebP && !isUsed) {
                toDelete.push(filename); // تحول لـ WebP وتحدث رابطه
            }
            else if (!isUsed) {
                toDelete.push(filename); // غير مستخدم خالص
            }
        }
        // ── 2. Duplicate WebP files (keep only the first in each hash group) ────────
        const hashMap = new Map();
        for (const filename of allFiles) {
            const ext = path.extname(filename).toLowerCase();
            if (ext !== '.webp')
                continue;
            const filepath = path.join(UPLOADS_DIR, filename);
            try {
                const hash = hashFile(filepath);
                if (!hashMap.has(hash))
                    hashMap.set(hash, []);
                hashMap.get(hash).push(filename);
            }
            catch (_a) { }
        }
        const duplicatesToDelete = [];
        for (const [, group] of hashMap.entries()) {
            if (group.length > 1) {
                // احتفظ بالأول وامسح الباقي
                group.slice(1).forEach(f => duplicatesToDelete.push(f));
            }
        }
        // ── Execute deletion ─────────────────────────────────────────────────────────
        const logLines = [];
        logLines.push('='.repeat(80));
        logLines.push('🗑️  سجل الحذف - Deletion Log');
        logLines.push(`📅 التاريخ: ${new Date().toLocaleString('ar-EG')}`);
        logLines.push('='.repeat(80));
        logLines.push('');
        let deletedCount = 0;
        let deletedSize = 0;
        let errorCount = 0;
        const allToDelete = [...toDelete, ...duplicatesToDelete];
        const uniqueToDelete = [...new Set(allToDelete)];
        console.log(`\n🗑️  بدء الحذف: ${toDelete.length} ملف قديم/غير مستخدم + ${duplicatesToDelete.length} مكرر`);
        console.log(`📊 إجمالي الملفات للحذف: ${uniqueToDelete.length}\n`);
        logLines.push(`📊 ملفات PNG/JPG قديمة وغير مستخدمة: ${toDelete.length}`);
        logLines.push(`♊  ملفات مكررة (WebP): ${duplicatesToDelete.length}`);
        logLines.push(`📊 إجمالي: ${uniqueToDelete.length}`);
        logLines.push('');
        logLines.push('─'.repeat(80));
        logLines.push('الملفات المحذوفة:');
        logLines.push('─'.repeat(80));
        for (const filename of uniqueToDelete) {
            const filepath = path.join(UPLOADS_DIR, filename);
            try {
                if (!fs.existsSync(filepath)) {
                    logLines.push(`  ⚠️  لم يوجد: ${filename}`);
                    continue;
                }
                const size = fs.statSync(filepath).size;
                fs.unlinkSync(filepath);
                deletedCount++;
                deletedSize += size;
                const sizeKB = (size / 1024).toFixed(1);
                logLines.push(`  ✅ حُذف: ${filename.padEnd(60, ' ')} ${sizeKB} KB`);
                if (deletedCount % 100 === 0) {
                    console.log(`   ... حُذف ${deletedCount} ملف حتى الآن`);
                }
            }
            catch (e) {
                errorCount++;
                logLines.push(`  ❌ خطأ: ${filename} → ${e.message}`);
            }
        }
        const freedMB = (deletedSize / 1024 / 1024).toFixed(2);
        logLines.push('');
        logLines.push('='.repeat(80));
        logLines.push(`✅ تم حذف: ${deletedCount} ملف`);
        logLines.push(`❌ أخطاء:  ${errorCount} ملف`);
        logLines.push(`💾 المساحة المحررة: ${freedMB} MB`);
        logLines.push('='.repeat(80));
        const logContent = logLines.join('\n');
        fs.writeFileSync(LOG_PATH, logContent, 'utf-8');
        console.log(`\n${'='.repeat(60)}`);
        console.log(`✅ تم حذف: ${deletedCount} ملف`);
        console.log(`❌ أخطاء:  ${errorCount} ملف`);
        console.log(`💾 المساحة المحررة: ${freedMB} MB`);
        console.log(`📄 السجل محفوظ في: ${LOG_PATH}`);
        console.log(`🌐 السجل متاح على: https://api.klevro.tech/uploads/cleanup-delete-log.txt`);
    });
}
runDelete()
    .catch(e => { console.error('❌ خطأ:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
