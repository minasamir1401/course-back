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
exports.cleanQuestionMarks = cleanQuestionMarks;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function cleanQuestionMarks() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🧹 Starting database cleanup: Removing ALL question marks (? and ؟)...');
        const updates = [
            // School
            { table: 'School', fields: ['name'] },
            // Course
            { table: 'Course', fields: ['title', 'description', 'grade', 'grades', 'subject'] },
            // Lesson
            { table: 'Lesson', fields: ['title', 'content', 'domain', 'summary', 'notes', 'standards', 'indicators', 'learningOutcomes'] },
            // LessonBlock
            { table: 'LessonBlock', fields: ['title', 'content', 'options', 'correctAnswer'] },
            // DynamicSection
            { table: 'DynamicSection', fields: ['content'] },
            // Exam
            { table: 'Exam', fields: ['title', 'description', 'category', 'grade', 'grades', 'subjects', 'skill'] },
            // Question
            { table: 'Question', fields: ['text', 'options', 'correctAnswer', 'explanation', 'skill', 'standard', 'learningOutcome', 'indicator'] },
            // SkillCluster
            { table: 'SkillCluster', fields: ['name', 'description'] },
            // SkillLesson
            { table: 'SkillLesson', fields: ['name', 'description'] },
            // InteractiveActivity
            { table: 'InteractiveActivity', fields: ['title', 'options', 'correctAnswer', 'hint', 'tip', 'explanation', 'keyInsight'] }
        ];
        let totalUpdated = 0;
        for (const { table, fields } of updates) {
            for (const field of fields) {
                try {
                    let result = 0;
                    try {
                        result = yield prisma.$executeRawUnsafe(`
            UPDATE "${table}"
            SET "${field}" = TRIM(REGEXP_REPLACE("${field}", '[\\?؟]+', '', 'g'))
            WHERE "${field}" LIKE '%?%' OR "${field}" LIKE '%؟%';
          `);
                    }
                    catch (_a) {
                        // Fallback standard SQL REPLACE
                        result = yield prisma.$executeRawUnsafe(`
            UPDATE "${table}"
            SET "${field}" = TRIM(REPLACE(REPLACE("${field}", '?', ''), '؟', ''))
            WHERE "${field}" LIKE '%?%' OR "${field}" LIKE '%؟%';
          `);
                    }
                    if (result > 0) {
                        console.log(`✅ Cleaned ${result} rows in "${table}"."${field}"`);
                        totalUpdated += result;
                    }
                }
                catch (error) {
                    console.error(`❌ Error cleaning "${table}"."${field}":`, (error === null || error === void 0 ? void 0 : error.message) || error);
                }
            }
        }
        // Clean JSON fields in Lesson table (questions, slides, assignments, attachments)
        const jsonFields = ['questions', 'slides', 'assignments', 'attachments'];
        for (const field of jsonFields) {
            try {
                let result = 0;
                try {
                    result = yield prisma.$executeRawUnsafe(`
          UPDATE "Lesson"
          SET "${field}" = REGEXP_REPLACE("${field}"::text, '[\\?؟]+', '', 'g')::jsonb
          WHERE "${field}"::text LIKE '%?%' OR "${field}"::text LIKE '%؟%';
        `);
                }
                catch (_b) {
                    // Fallback for non-Postgres engines
                    result = yield prisma.$executeRawUnsafe(`
          UPDATE "Lesson"
          SET "${field}" = REPLACE(REPLACE("${field}"::text, '?', ''), '؟', '')::jsonb
          WHERE "${field}"::text LIKE '%?%' OR "${field}"::text LIKE '%؟%';
        `);
                }
                if (result > 0) {
                    console.log(`✅ Cleaned ${result} JSON rows in "Lesson"."${field}"`);
                    totalUpdated += result;
                }
            }
            catch (error) {
                // Ignored if JSON column doesn't match
            }
        }
        console.log(`✨ Database cleanup finished. Updated ${totalUpdated} fields.`);
    });
}
if (require.main === module) {
    cleanQuestionMarks()
        .catch((e) => {
        console.error(e);
        process.exit(1);
    })
        .finally(() => __awaiter(void 0, void 0, void 0, function* () {
        yield prisma.$disconnect();
    }));
}
