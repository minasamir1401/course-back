"use strict";
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
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const courses = yield prisma.course.findMany({
            where: { deletedAt: null },
            include: {
                lessons: {
                    where: { deletedAt: null },
                    select: { id: true, title: true, order: true, slides: true, questions: true, createdAt: true, updatedAt: true }
                },
                exams: {
                    where: { deletedAt: null },
                    select: { id: true, title: true }
                }
            }
        });
        console.log(`=== Found ${courses.length} Active Courses ===`);
        for (const c of courses) {
            console.log(`Course: [${c.id}] "${c.title}" (subject: ${c.subject}, grade: ${c.grade}) - Lessons: ${c.lessons.length}`);
            const lessonTitleMap = new Map();
            for (const l of c.lessons) {
                let slideCount = 0;
                try {
                    const s = typeof l.slides === 'string' ? JSON.parse(l.slides) : (l.slides || []);
                    slideCount = Array.isArray(s) ? s.length : 0;
                }
                catch (e) { }
                const count = (lessonTitleMap.get(l.title.trim()) || 0) + 1;
                lessonTitleMap.set(l.title.trim(), count);
                console.log(`   - Lesson [${l.id}] (order: ${l.order}): "${l.title}" | Slides: ${slideCount}`);
            }
            for (const [title, count] of lessonTitleMap.entries()) {
                if (count > 1) {
                    console.warn(`   ⚠️ DUPLICATE LESSON in course "${c.title}": "${title}" appears ${count} times!`);
                }
            }
        }
        // Check exams and questions
        const exams = yield prisma.exam.findMany({
            where: { deletedAt: null },
            include: {
                questions: {
                    where: { deletedAt: null },
                    select: { id: true, text: true, explanation: true, correctAnswer: true, options: true, order: true }
                }
            }
        });
        console.log(`\n=== Found ${exams.length} Active Exams ===`);
        for (const e of exams) {
            console.log(`Exam: [${e.id}] "${e.title}" - Questions: ${e.questions.length}`);
            for (const q of e.questions) {
                const hasExplanation = !!(q.explanation && q.explanation.trim() !== '');
                console.log(`   - Question [${q.id}]: "${q.text.substring(0, 40)}..." | Has Explanation: ${hasExplanation} | CorrectAnswer: ${q.correctAnswer}`);
            }
        }
    });
}
main().catch(console.error).finally(() => prisma.$disconnect());
