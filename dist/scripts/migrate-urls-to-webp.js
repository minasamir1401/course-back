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
// Directory where uploads are stored on the server
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
/**
 * Extracts the filename from an upload URL and checks if its .webp version exists on disk.
 * SAFE: only returns true if the webp file actually exists.
 */
function webpExistsForUrl(url) {
    try {
        // Extract filename from URL like https://api.klevro.tech/uploads/image.png
        const match = url.match(/\/uploads\/([^"'\s?]+)/);
        if (!match)
            return false;
        const filename = match[1];
        const ext = path.extname(filename).toLowerCase();
        if (!['.png', '.jpg', '.jpeg'].includes(ext))
            return false;
        const webpFilename = filename.substring(0, filename.lastIndexOf('.')) + '.webp';
        const webpPath = path.join(UPLOADS_DIR, webpFilename);
        return fs.existsSync(webpPath);
    }
    catch (_a) {
        return false;
    }
}
/**
 * Safely replaces a single URL string: only if the webp file exists.
 */
function safeReplaceUrl(url) {
    if (webpExistsForUrl(url)) {
        return url.replace(/\.(png|jpg|jpeg)(?=["'<\s]|$)/i, '.webp');
    }
    return url;
}
/**
 * Scans a text (HTML / plain) and replaces all upload URLs that have a webp counterpart.
 */
function replaceInText(text) {
    if (!text)
        return text;
    // Match any upload URL ending with an image extension
    return text.replace(/(https?:\/\/[^\s"'<]*\/uploads\/[^\s"'<]+\.(png|jpg|jpeg))/gi, (match) => safeReplaceUrl(match));
}
/**
 * Recursively scans JSON objects/arrays and replaces upload URLs.
 */
function replaceInJSON(value) {
    if (!value)
        return value;
    if (typeof value === 'string')
        return replaceInText(value);
    if (Array.isArray(value))
        return value.map(replaceInJSON);
    if (typeof value === 'object') {
        const result = {};
        for (const key in value)
            result[key] = replaceInJSON(value[key]);
        return result;
    }
    return value;
}
function migrateUrlsToWebP() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🚀 Starting SAFE DB migration to WebP URLs...');
        console.log(`📁 Checking WebP files in: ${UPLOADS_DIR}`);
        let stats = { courses: 0, users: 0, questions: 0, lessons: 0, blocks: 0, sections: 0 };
        // ── 1. Courses ──────────────────────────────────────────────
        const courses = yield prisma.course.findMany({ select: { id: true, coverImage: true } });
        for (const c of courses) {
            const newVal = replaceInText(c.coverImage);
            if (newVal !== c.coverImage) {
                yield prisma.course.update({ where: { id: c.id }, data: { coverImage: newVal } });
                stats.courses++;
            }
        }
        console.log(`✅ Courses updated: ${stats.courses}`);
        // ── 2. Users ─────────────────────────────────────────────────
        const users = yield prisma.user.findMany({ select: { id: true, avatar: true } });
        for (const u of users) {
            const newVal = replaceInText(u.avatar);
            if (newVal !== u.avatar) {
                yield prisma.user.update({ where: { id: u.id }, data: { avatar: newVal } });
                stats.users++;
            }
        }
        console.log(`✅ Users updated: ${stats.users}`);
        // ── 3. Questions ──────────────────────────────────────────────
        const questions = yield prisma.question.findMany({
            select: { id: true, imageUrl: true, text: true, explanation: true }
        });
        for (const q of questions) {
            const newImageUrl = replaceInText(q.imageUrl);
            const newText = replaceInText(q.text);
            const newExplanation = replaceInText(q.explanation);
            if (newImageUrl !== q.imageUrl || newText !== q.text || newExplanation !== q.explanation) {
                yield prisma.question.update({
                    where: { id: q.id },
                    data: {
                        imageUrl: newImageUrl !== null && newImageUrl !== void 0 ? newImageUrl : undefined,
                        text: newText !== null && newText !== void 0 ? newText : q.text,
                        explanation: newExplanation !== null && newExplanation !== void 0 ? newExplanation : undefined
                    }
                });
                stats.questions++;
            }
        }
        console.log(`✅ Questions updated: ${stats.questions}`);
        // ── 4. Lessons ────────────────────────────────────────────────
        const lessons = yield prisma.lesson.findMany();
        for (const l of lessons) {
            let changed = false;
            const newContent = replaceInText(l.content);
            const newNotes = replaceInText(l.notes);
            const newSummary = replaceInText(l.summary);
            let newSlides = l.slides, newQuestions = l.questions;
            let newAttachments = l.attachments, newAssignments = l.assignments;
            if (newContent !== l.content)
                changed = true;
            if (newNotes !== l.notes)
                changed = true;
            if (newSummary !== l.summary)
                changed = true;
            if (l.slides) {
                const p = replaceInJSON(l.slides);
                if (JSON.stringify(p) !== JSON.stringify(l.slides)) {
                    newSlides = p;
                    changed = true;
                }
            }
            if (l.questions) {
                const p = replaceInJSON(l.questions);
                if (JSON.stringify(p) !== JSON.stringify(l.questions)) {
                    newQuestions = p;
                    changed = true;
                }
            }
            if (l.attachments) {
                const p = replaceInJSON(l.attachments);
                if (JSON.stringify(p) !== JSON.stringify(l.attachments)) {
                    newAttachments = p;
                    changed = true;
                }
            }
            if (l.assignments) {
                const p = replaceInJSON(l.assignments);
                if (JSON.stringify(p) !== JSON.stringify(l.assignments)) {
                    newAssignments = p;
                    changed = true;
                }
            }
            if (changed) {
                yield prisma.lesson.update({
                    where: { id: l.id },
                    data: {
                        content: newContent, notes: newNotes, summary: newSummary,
                        slides: newSlides !== null && newSlides !== void 0 ? newSlides : undefined, questions: newQuestions !== null && newQuestions !== void 0 ? newQuestions : undefined,
                        attachments: newAttachments !== null && newAttachments !== void 0 ? newAttachments : undefined, assignments: newAssignments !== null && newAssignments !== void 0 ? newAssignments : undefined
                    }
                });
                stats.lessons++;
            }
        }
        console.log(`✅ Lessons updated: ${stats.lessons}`);
        // ── 5. Lesson Blocks ──────────────────────────────────────────
        const blocks = yield prisma.lessonBlock.findMany({ select: { id: true, content: true, options: true } });
        for (const b of blocks) {
            let changed = false;
            const newContent = replaceInText(b.content);
            let newOptions = b.options;
            if (newContent !== b.content)
                changed = true;
            if (b.options) {
                try {
                    const opts = replaceInJSON(JSON.parse(b.options));
                    const strOpts = JSON.stringify(opts);
                    if (strOpts !== b.options) {
                        newOptions = strOpts;
                        changed = true;
                    }
                }
                catch (_a) {
                    const direct = replaceInText(b.options);
                    if (direct !== b.options) {
                        newOptions = direct;
                        changed = true;
                    }
                }
            }
            if (changed) {
                yield prisma.lessonBlock.update({
                    where: { id: b.id },
                    data: { content: newContent, options: newOptions }
                });
                stats.blocks++;
            }
        }
        console.log(`✅ Lesson blocks updated: ${stats.blocks}`);
        // ── 6. Dynamic Sections ───────────────────────────────────────
        const sections = yield prisma.dynamicSection.findMany({ select: { id: true, content: true } });
        for (const s of sections) {
            const newContent = replaceInText(s.content);
            if (newContent !== null && newContent !== undefined && newContent !== s.content) {
                yield prisma.dynamicSection.update({ where: { id: s.id }, data: { content: newContent } });
                stats.sections++;
            }
        }
        console.log(`✅ Dynamic sections updated: ${stats.sections}`);
        const total = Object.values(stats).reduce((a, b) => a + b, 0);
        console.log(`\n🎉 Migration complete! Total records updated: ${total}`);
        console.log(`   Breakdown:`, stats);
    });
}
migrateUrlsToWebP()
    .catch((e) => { console.error('❌ Migration failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
