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
// @ts-nocheck
const client_1 = require("@prisma/client");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const prisma = new client_1.PrismaClient();
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR))
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const PORT = process.env.PORT || 3001;
const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
function processString(str) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!str || typeof str !== 'string')
            return str;
        const regex = /<img[^>]*src="data:image\/[^"]+"[^>]*>/g;
        const matches = [...str.matchAll(regex)];
        if (matches.length === 0) {
            return str;
        }
        let newStr = str;
        for (const match of matches) {
            const fullMatch = match[0];
            newStr = newStr.replace(fullMatch, "");
            console.log(`    [-] Deleted base64 image completely.`);
        }
        return newStr;
    });
}
function migrate() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("🚀 Starting Base64 to Server File Migration...");
        // 1. Courses
        console.log("\nMigrating Courses...");
        const courses = yield prisma.course.findMany();
        for (const course of courses) {
            const updatedCover = yield processString(course.coverImage);
            const updatedDesc = yield processString(course.description);
            if (updatedCover !== course.coverImage || updatedDesc !== course.description) {
                yield prisma.course.update({
                    where: { id: course.id },
                    data: { coverImage: updatedCover, description: updatedDesc }
                });
                console.log(`  -> Updated Course: ${course.id}`);
            }
        }
        // 2. Lessons
        console.log("\nMigrating Lessons...");
        const lessons = yield prisma.lesson.findMany();
        for (const lesson of lessons) {
            const updatedContent = yield processString(lesson.content);
            const updatedQuestions = yield processString(lesson.questions);
            const updatedSlides = yield processString(lesson.slides);
            const updatedAssignments = yield processString(lesson.assignments);
            if (updatedContent !== lesson.content || updatedQuestions !== lesson.questions ||
                updatedSlides !== lesson.slides || updatedAssignments !== lesson.assignments) {
                yield prisma.lesson.update({
                    where: { id: lesson.id },
                    data: {
                        content: updatedContent,
                        questions: updatedQuestions,
                        slides: updatedSlides,
                        assignments: updatedAssignments
                    }
                });
                console.log(`  -> Updated Lesson: ${lesson.id}`);
            }
        }
        // 3. Exams
        console.log("\nMigrating Exams...");
        const exams = yield prisma.exam.findMany();
        for (const exam of exams) {
            const updatedDesc = yield processString(exam.description);
            if (updatedDesc !== exam.description) {
                yield prisma.exam.update({
                    where: { id: exam.id },
                    data: { description: updatedDesc }
                });
                console.log(`  -> Updated Exam: ${exam.id}`);
            }
        }
        // 4. Questions
        console.log("\nMigrating Questions...");
        const questions = yield prisma.question.findMany();
        for (const q of questions) {
            const updatedText = yield processString(q.text);
            const updatedOptions = yield processString(q.options);
            const updatedExplanation = yield processString(q.explanation);
            const updatedImageUrl = yield processString(q.imageUrl);
            if (updatedText !== q.text || updatedOptions !== q.options ||
                updatedExplanation !== q.explanation || updatedImageUrl !== q.imageUrl) {
                yield prisma.question.update({
                    where: { id: q.id },
                    data: {
                        text: updatedText,
                        options: updatedOptions,
                        explanation: updatedExplanation,
                        imageUrl: updatedImageUrl
                    }
                });
                console.log(`  -> Updated Question: ${q.id}`);
            }
        }
        // 5. LessonBlocks
        console.log("\nMigrating LessonBlocks...");
        const blocks = yield prisma.lessonBlock.findMany();
        for (const block of blocks) {
            const updatedContent = yield processString(block.content);
            const updatedOptions = yield processString(block.options);
            if (updatedContent !== block.content || updatedOptions !== block.options) {
                yield prisma.lessonBlock.update({
                    where: { id: block.id },
                    data: { content: updatedContent, options: updatedOptions }
                });
                console.log(`  -> Updated LessonBlock: ${block.id}`);
            }
        }
        // 6. DynamicSections
        console.log("\nMigrating DynamicSections...");
        const sections = yield prisma.dynamicSection.findMany();
        for (const sec of sections) {
            const updatedContent = yield processString(sec.content);
            if (updatedContent !== sec.content) {
                yield prisma.dynamicSection.update({
                    where: { id: sec.id },
                    data: { content: updatedContent }
                });
                console.log(`  -> Updated DynamicSection: ${sec.id}`);
            }
        }
        console.log("\n✅ Migration completed successfully!");
    });
}
migrate()
    .catch(e => {
    console.error("Migration failed:", e);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
