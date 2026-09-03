import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function cleanQuestionMarks() {
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
          result = await prisma.$executeRawUnsafe(`
            UPDATE "${table}"
            SET "${field}" = TRIM(REGEXP_REPLACE("${field}", '[\\?؟]+', '', 'g'))
            WHERE "${field}" LIKE '%?%' OR "${field}" LIKE '%؟%';
          `);
        } catch {
          // Fallback standard SQL REPLACE
          result = await prisma.$executeRawUnsafe(`
            UPDATE "${table}"
            SET "${field}" = TRIM(REPLACE(REPLACE("${field}", '?', ''), '؟', ''))
            WHERE "${field}" LIKE '%?%' OR "${field}" LIKE '%؟%';
          `);
        }

        if (result > 0) {
          console.log(`✅ Cleaned ${result} rows in "${table}"."${field}"`);
          totalUpdated += result;
        }
      } catch (error: any) {
        console.error(`❌ Error cleaning "${table}"."${field}":`, error?.message || error);
      }
    }
  }

  // Clean JSON fields in Lesson table (questions, slides, assignments, attachments)
  const jsonFields = ['questions', 'slides', 'assignments', 'attachments'];
  for (const field of jsonFields) {
    try {
      let result = 0;
      try {
        result = await prisma.$executeRawUnsafe(`
          UPDATE "Lesson"
          SET "${field}" = REGEXP_REPLACE("${field}"::text, '[\\?؟]+', '', 'g')::jsonb
          WHERE "${field}"::text LIKE '%?%' OR "${field}"::text LIKE '%؟%';
        `);
      } catch {
        // Fallback for non-Postgres engines
        result = await prisma.$executeRawUnsafe(`
          UPDATE "Lesson"
          SET "${field}" = REPLACE(REPLACE("${field}"::text, '?', ''), '؟', '')::jsonb
          WHERE "${field}"::text LIKE '%?%' OR "${field}"::text LIKE '%؟%';
        `);
      }

      if (result > 0) {
        console.log(`✅ Cleaned ${result} JSON rows in "Lesson"."${field}"`);
        totalUpdated += result;
      }
    } catch (error: any) {
      // Ignored if JSON column doesn't match
    }
  }

  console.log(`✨ Database cleanup finished. Updated ${totalUpdated} fields.`);
}

if (require.main === module) {
  cleanQuestionMarks()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

