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
        console.log('🤖 [Migration Safety] Validating and fixing JSON fields using RAW SQL before Prisma db push...');
        // 1. Fetch raw data — columns may already be JSONB (returns object) or TEXT (returns string)
        const lessons = yield prisma.$queryRaw `SELECT id, questions, slides, assignments, attachments FROM "Lesson"`;
        let fixedCount = 0;
        const fields = ['questions', 'slides', 'assignments', 'attachments'];
        for (const lesson of lessons) {
            // 🔒 SAFETY: Fix each field INDEPENDENTLY.
            // NEVER reset a valid field just because another field needed fixing.
            for (const field of fields) {
                const val = lesson[field];
                // Case 1: null or empty string → set to empty array JSON
                if (val === null || val === undefined || val === '') {
                    yield prisma.$executeRawUnsafe(`UPDATE "Lesson" SET "${field}" = '[]'::jsonb WHERE id = $1`, lesson.id);
                    console.warn(`[Fixing] Lesson ${lesson.id}, field "${field}" was null/empty → set to []`);
                    fixedCount++;
                    continue;
                }
                // Case 2: Already a JSONB object/array (postgres returned it parsed) → validate it's an array
                if (typeof val === 'object') {
                    if (!Array.isArray(val)) {
                        // It's an object but not an array — reset to []
                        yield prisma.$executeRawUnsafe(`UPDATE "Lesson" SET "${field}" = '[]'::jsonb WHERE id = $1`, lesson.id);
                        console.warn(`[Fixing] Lesson ${lesson.id}, field "${field}" was object (not array) → set to []`);
                        fixedCount++;
                    }
                    // If it's already a valid array → leave it untouched ✅
                    continue;
                }
                // Case 3: String value → validate that Postgres can parse it as JSONB array
                if (typeof val === 'string') {
                    try {
                        // Ask Postgres to validate the JSON natively
                        yield prisma.$queryRawUnsafe(`SELECT $1::jsonb`, val);
                        const parsed = JSON.parse(val);
                        if (!Array.isArray(parsed)) {
                            // Valid JSON but not an array → reset to []
                            yield prisma.$executeRawUnsafe(`UPDATE "Lesson" SET "${field}" = '[]'::jsonb WHERE id = $1`, lesson.id);
                            console.warn(`[Fixing] Lesson ${lesson.id}, field "${field}" was non-array JSON string → set to []`);
                            fixedCount++;
                        }
                        // Valid JSON array string → leave it untouched ✅
                    }
                    catch (e) {
                        // Postgres rejected the JSON → it's corrupt, reset to []
                        yield prisma.$executeRawUnsafe(`UPDATE "Lesson" SET "${field}" = '[]'::jsonb WHERE id = $1`, lesson.id);
                        console.warn(`[Fixing] Postgres rejected JSON in Lesson ${lesson.id}, field "${field}" → set to []`);
                        fixedCount++;
                    }
                }
            }
        }
        console.log(`🤖 Validation complete. Fixed ${fixedCount} field(s) across ${lessons.length} lesson(s).`);
        console.log('🤖 [Migration Safety] Ensuring columns are JSONB type...');
        try {
            yield prisma.$executeRawUnsafe(`
      ALTER TABLE "Lesson" 
      ALTER COLUMN "questions" TYPE JSONB USING COALESCE("questions"::jsonb, '[]'::jsonb),
      ALTER COLUMN "slides" TYPE JSONB USING COALESCE("slides"::jsonb, '[]'::jsonb),
      ALTER COLUMN "assignments" TYPE JSONB USING COALESCE("assignments"::jsonb, '[]'::jsonb),
      ALTER COLUMN "attachments" TYPE JSONB USING COALESCE("attachments"::jsonb, '[]'::jsonb);
    `);
            console.log('✅ Columns successfully ensured as JSONB!');
        }
        catch (e) {
            console.log('⚠️ Note: Alter table skipped (columns may already be JSONB). Message:', e.message);
        }
    });
}
main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
