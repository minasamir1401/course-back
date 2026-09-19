import { Prisma } from '@prisma/client';

// Only server-owned field names can enter SQL. Values stay bound parameters.
const QUESTION_FIELDS = ['text', 'textEn', 'type', 'options', 'optionsEn', 'correctAnswer', 'points', 'xpPoints', 'skill',
  'learningOutcome', 'indicator', 'videoUrl', 'level', 'dok', 'cognitive', 'course', 'section', 'domain',
  'standard', 'subskill', 'microSkill', 'gradeTarget', 'errorPattern', 'estimatedTime', 'explanation', 'explanationEn',
  'hint', 'hintEn', 'imageUrl', 'moduleId', 'subExamId', 'order'] as const;
export async function persistQuestionUpdates(tx: any, examId: string, updates: Array<{ id: string; data: Record<string, any> }>) {
  if (!updates.length) return;
  const columns = Prisma.raw(QUESTION_FIELDS.map(field => `"${field}"`).join(', '));
  const selected = Prisma.raw(QUESTION_FIELDS.map(field => `r."${field}"`).join(', '));
  for (let offset = 0; offset < updates.length; offset += 250) {
    const batch = updates.slice(offset, offset + 250).map(update => ({ id: update.id,
      data: Object.fromEntries(QUESTION_FIELDS.filter(field => update.data[field] !== undefined).map(field => [field, update.data[field]])) }));
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Question" AS q
      SET (${columns}) = (SELECT ${selected} FROM jsonb_populate_record(q, patch.data) AS r), "updatedAt" = NOW()
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS patch(id text, data jsonb)
      WHERE q.id = patch.id AND q."examId" = ${examId} AND q."deletedAt" IS NULL
    `);
  }
}
