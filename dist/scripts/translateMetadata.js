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
const replacements = {
    "معيار 1: الفهم والاستيعاب": "Standard 1: Understanding & Comprehension",
    "معيار 2: التطبيق والتحليل": "Standard 2: Application & Analysis",
    "معيار 3: التفكير النقدي": "Standard 3: Critical Thinking",
    "مؤشر 1: يحدد المفاهيم الأساسية": "Indicator 1: Identifies Basic Concepts",
    "مؤشر 2: يطبق القوانين الرياضية": "Indicator 2: Applies Mathematical Laws",
    "مؤشر 3: يستنتج العلاقات": "Indicator 3: Infers Relationships",
    "ناتج 1: أن يكون الطالب قادراً على...": "Outcome 1: Student will be able to...",
    "ناتج 2: أن يميز الطالب بين...": "Outcome 2: Student will distinguish between...",
    "ناتج 3: أن يحلل الطالب...": "Outcome 3: Student will analyze...",
    "مؤشر 1.1: تعريف المصطلحات": "Indicator 1.1: Defining Terms",
    "مؤشر 1.2: شرح المفاهيم": "Indicator 1.2: Explaining Concepts",
    "مؤشر 2.1: مقارنة النتائج": "Indicator 2.1: Comparing Results"
};
function translateString(str) {
    if (!str)
        return str;
    let newStr = str;
    for (const [ar, en] of Object.entries(replacements)) {
        newStr = newStr.split(ar).join(en);
    }
    return newStr;
}
function translateQuestions(questions) {
    if (!questions)
        return questions;
    if (Array.isArray(questions)) {
        return questions.map(q => {
            if (typeof q === 'object' && q !== null) {
                const newQ = Object.assign({}, q);
                if (newQ.standard)
                    newQ.standard = translateString(newQ.standard);
                if (newQ.indicator)
                    newQ.indicator = translateString(newQ.indicator);
                if (newQ.learningOutcome)
                    newQ.learningOutcome = translateString(newQ.learningOutcome);
                return newQ;
            }
            return q;
        });
    }
    return questions;
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Translating lessons metadata...");
        const lessons = yield prisma.lesson.findMany();
        let updatedCount = 0;
        for (const lesson of lessons) {
            let changed = false;
            const newStandards = translateString(lesson.standards);
            if (newStandards !== lesson.standards)
                changed = true;
            const newIndicators = translateString(lesson.indicators);
            if (newIndicators !== lesson.indicators)
                changed = true;
            const newLearningOutcomes = translateString(lesson.learningOutcomes);
            if (newLearningOutcomes !== lesson.learningOutcomes)
                changed = true;
            const newQuestions = translateQuestions(lesson.questions);
            if (JSON.stringify(newQuestions) !== JSON.stringify(lesson.questions))
                changed = true;
            const newAssignments = translateQuestions(lesson.assignments);
            if (JSON.stringify(newAssignments) !== JSON.stringify(lesson.assignments))
                changed = true;
            if (changed) {
                yield prisma.lesson.update({
                    where: { id: lesson.id },
                    data: {
                        standards: newStandards,
                        indicators: newIndicators,
                        learningOutcomes: newLearningOutcomes,
                        questions: newQuestions,
                        assignments: newAssignments
                    }
                });
                updatedCount++;
                console.log(`Updated lesson ${lesson.id}`);
            }
        }
        console.log(`Finished translating. Updated ${updatedCount} lessons.`);
        // Also translate questions model directly (exam questions)
        const examQuestions = yield prisma.question.findMany();
        let updatedExamQs = 0;
        for (const q of examQuestions) {
            let changed = false;
            const standard = translateString(q.standard);
            if (standard !== q.standard)
                changed = true;
            const indicator = translateString(q.indicator);
            if (indicator !== q.indicator)
                changed = true;
            const learningOutcome = translateString(q.learningOutcome);
            if (learningOutcome !== q.learningOutcome)
                changed = true;
            if (changed) {
                yield prisma.question.update({
                    where: { id: q.id },
                    data: { standard, indicator, learningOutcome }
                });
                updatedExamQs++;
            }
        }
        console.log(`Finished translating. Updated ${updatedExamQs} exam questions.`);
    });
}
main().catch(console.error).finally(() => prisma.$disconnect());
