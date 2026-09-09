import { Client } from 'pg';
import { persistQuestionUpdates } from '../src/utils/examQuestionWrites';
import * as dotenv from 'dotenv';
dotenv.config();
describe('batched question writes on temporary PostgreSQL rows', () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  beforeAll(async () => { await db.connect(); });
  afterAll(async () => { await db.end(); });
  it('updates 1000 questions in four statements and preserves scope and omitted fields', async () => {
    await db.query('BEGIN');
    try {
      await db.query('CREATE TEMP TABLE "Question" (LIKE public."Question" INCLUDING DEFAULTS) ON COMMIT DROP');
      await db.query(`INSERT INTO "Question" (id,"examId",text,options,"correctAnswer",skill,"updatedAt") SELECT 'q' || i, 'exam', 'Old', '[]', 'A', 'Keep', NOW() FROM generate_series(1,1000) i`);
      await db.query(`INSERT INTO "Question" (id,"examId",text,options,"correctAnswer","updatedAt","deletedAt") VALUES ('sibling','other','Old','[]','A',NOW(),NULL),('deleted','exam','Old','[]','A',NOW(),NOW())`);
      let statements = 0;
      const tx = { $executeRaw: async (query: any) => { statements++; return db.query(query.text, query.values); } };
      const start = Date.now();
      await persistQuestionUpdates(tx, 'exam', Array.from({ length: 1000 }, (_, i) => ({ id: 'q' + (i + 1), data: { text: "New ' value", points: 3, skill: undefined, examId: 'attack', id: 'attack' } })));
      expect(statements).toBe(4);
      const result = await db.query(`SELECT count(*)::int n FROM "Question" WHERE "examId" = 'exam' AND text = $1 AND points = 3 AND skill = 'Keep'`, ["New ' value"]);
      expect(result.rows[0].n).toBe(1000);
      console.log(`1000 question updates: ${Date.now() - start}ms, ${statements} statements (local temporary table)`);
      await persistQuestionUpdates(tx, 'exam', [{ id: 'sibling', data: { text: 'Bad' } }, { id: 'deleted', data: { text: 'Bad' } }, { id: 'q1', data: { skill: null } }]);
      const guarded = await db.query(`SELECT id, text, skill FROM "Question" WHERE id IN ('sibling','deleted','q1') ORDER BY id`);
      expect(guarded.rows.filter(r => r.id !== 'q1').every(r => r.text === 'Old')).toBe(true);
      expect(guarded.rows.find(r => r.id === 'q1').skill).toBeNull();
    } finally { await db.query('ROLLBACK'); }
  });
});
