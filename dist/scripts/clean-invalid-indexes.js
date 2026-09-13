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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../lib/prisma"));
const shared_1 = require("../shared");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        console.log('[DB-Maintenance] Checking for invalid indexes in PostgreSQL...');
        const isPostgres = ((_a = process.env.DATABASE_URL) === null || _a === void 0 ? void 0 : _a.startsWith('postgres')) || ((_b = process.env.DATABASE_URL) === null || _b === void 0 ? void 0 : _b.startsWith('postgresql'));
        if (!isPostgres) {
            console.log('[DB-Maintenance] Not a PostgreSQL database, skipping invalid index inspection.');
            return;
        }
        try {
            const invalidIndexes = yield prisma_1.default.$queryRawUnsafe(`
      SELECT 
        c.relname as index_name,
        t.relname as table_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE i.indisvalid = false AND n.nspname = 'public';
    `);
            if (!Array.isArray(invalidIndexes) || invalidIndexes.length === 0) {
                console.log('[DB-Maintenance] All database indexes are valid.');
            }
            else {
                console.log(`[DB-Maintenance] Found ${invalidIndexes.length} invalid index(es):`);
                for (const row of invalidIndexes) {
                    console.log(`  - ${row.index_name} on table ${row.table_name}`);
                    try {
                        console.log(`  Dropping invalid index "${row.index_name}"...`);
                        yield prisma_1.default.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${row.index_name}"`);
                        console.log(`  Successfully dropped "${row.index_name}".`);
                    }
                    catch (dropErr) {
                        console.error(`  Failed to drop "${row.index_name}":`, dropErr.message);
                    }
                }
            }
            // Clean orphan/dangling foreign keys in Question table to ensure total DB integrity
            try {
                console.log('[DB-Maintenance] Cleaning dangling Question foreign keys (modules/subExams)...');
                const orphanModulesResult = yield prisma_1.default.$executeRawUnsafe(`
        UPDATE "Question" 
        SET "moduleId" = NULL 
        WHERE "moduleId" IS NOT NULL 
          AND "moduleId" NOT IN (SELECT "id" FROM "ExamModule");
      `);
                if (orphanModulesResult > 0) {
                    console.log(`  Cleaned ${orphanModulesResult} question(s) with dangling moduleId.`);
                }
                const orphanSubExamsResult = yield prisma_1.default.$executeRawUnsafe(`
        UPDATE "Question" 
        SET "subExamId" = NULL 
        WHERE "subExamId" IS NOT NULL 
          AND "subExamId" NOT IN (SELECT "id" FROM "SubExam");
      `);
                if (orphanSubExamsResult > 0) {
                    console.log(`  Cleaned ${orphanSubExamsResult} question(s) with dangling subExamId.`);
                }
            }
            catch (fkErr) {
                console.warn(`  Notice during orphan foreign key cleanup: ${fkErr.message}`);
            }
            // Ensure recently added schema columns exist in PostgreSQL
            console.log('[DB-Maintenance] Ensuring all schema columns exist in database...');
            const schemaColumns = [
                'ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "textEn" TEXT',
                'ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "optionsEn" TEXT',
                'ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "explanationEn" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "titleEn" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "questionText" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "questionTextEn" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "optionsEn" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "correctAnswerEn" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "hintEn" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "tipEn" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "explanationEn" TEXT',
                'ALTER TABLE "InteractiveActivity" ADD COLUMN IF NOT EXISTS "keyInsightEn" TEXT',
                'ALTER TABLE "ExamModule" ADD COLUMN IF NOT EXISTS "parentModuleId" TEXT'
            ];
            for (const sql of schemaColumns) {
                try {
                    yield prisma_1.default.$executeRawUnsafe(sql);
                }
                catch (colErr) {
                    console.warn(`  Notice during schema column reconciliation: ${colErr.message}`);
                }
            }
            console.log('[DB-Maintenance] Schema column reconciliation completed.');
            console.log('[DB-Maintenance] Rebuilding performance indexes cleanly...');
            delete process.env.NODE_APP_INSTANCE;
            yield (0, shared_1.ensurePerformanceIndexes)();
            console.log('[DB-Maintenance] Database maintenance completed successfully.');
        }
        catch (error) {
            console.error('[DB-Maintenance] Error during index maintenance:', error);
        }
        finally {
            yield prisma_1.default.$disconnect();
        }
    });
}
main();
