import prisma from '../lib/prisma';
import { ensurePerformanceIndexes } from '../shared';

async function main() {
  console.log('🔍 Checking for invalid indexes in PostgreSQL...');
  const isPostgres = process.env.DATABASE_URL?.startsWith('postgres') || process.env.DATABASE_URL?.startsWith('postgresql');

  if (!isPostgres) {
    console.log('ℹ️ Not a PostgreSQL database, skipping invalid index inspection.');
    return;
  }

  try {
    const invalidIndexes: any = await prisma.$queryRawUnsafe(`
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
      console.log('✅ No invalid indexes found. All indexes are valid.');
    } else {
      console.log(`⚠️ Found ${invalidIndexes.length} invalid index(es):`);
      for (const row of invalidIndexes) {
        console.log(`  - ${row.index_name} on table ${row.table_name}`);
        try {
          console.log(`  🗑️ Dropping invalid index "${row.index_name}"...`);
          await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${row.index_name}"`);
          console.log(`  ✅ Successfully dropped "${row.index_name}".`);
        } catch (dropErr: any) {
          console.error(`  ❌ Failed to drop "${row.index_name}":`, dropErr.message);
        }
      }
    }

    // Clean orphan/dangling foreign keys in Question table to ensure total DB integrity
    try {
      console.log('🧹 Cleaning dangling Question foreign keys (modules/subExams)...');
      const orphanModulesResult: any = await prisma.$executeRawUnsafe(`
        UPDATE "Question" 
        SET "moduleId" = NULL 
        WHERE "moduleId" IS NOT NULL 
          AND "moduleId" NOT IN (SELECT "id" FROM "ExamModule");
      `);
      if (orphanModulesResult > 0) {
        console.log(`  ✅ Cleaned ${orphanModulesResult} question(s) with dangling moduleId.`);
      }

      const orphanSubExamsResult: any = await prisma.$executeRawUnsafe(`
        UPDATE "Question" 
        SET "subExamId" = NULL 
        WHERE "subExamId" IS NOT NULL 
          AND "subExamId" NOT IN (SELECT "id" FROM "SubExam");
      `);
      if (orphanSubExamsResult > 0) {
        console.log(`  ✅ Cleaned ${orphanSubExamsResult} question(s) with dangling subExamId.`);
      }
    } catch (fkErr: any) {
      console.warn(`  ⚠️ Notice during orphan foreign key cleanup: ${fkErr.message}`);
    }

    console.log('🛠️ Rebuilding performance indexes cleanly...');
    // Clear NODE_APP_INSTANCE for this standalone maintenance script so it runs
    delete process.env.NODE_APP_INSTANCE;
    await ensurePerformanceIndexes();
    console.log('✅ Database maintenance completed successfully.');
  } catch (error: any) {
    console.error('❌ Error during index maintenance:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
