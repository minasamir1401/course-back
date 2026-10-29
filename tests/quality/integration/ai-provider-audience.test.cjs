require('dotenv/config');
process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
require('ts-node/register/transpile-only');
const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const { encryptAiKey } = require('../../../src/lib/aiSecurity');
const { completeAi } = require('../../../src/services/aiRouting.service');
const allowed = process.env.RUN_AI_DB_TESTS === '1' && ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL || 'http://invalid').hostname);

(allowed ? describe : describe.skip)('provider audiences through real PostgreSQL routing queries', () => {
  const db = new PrismaClient();
  afterAll(() => db.$disconnect());
  async function isolated(scopes, run, timezone = 'UTC') {
    return db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT set_config('TimeZone', ${timezone}, true)`);
      // Only this transaction sees these synthetic rows. Real provider settings,
      // credentials and enabled flags are never changed by the test.
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "AiProvider" (LIKE public."AiProvider" INCLUDING DEFAULTS) ON COMMIT DROP');
      for (let index = 0; index < scopes.length; index++) {
        const row = scopes[index], id = crypto.randomUUID();
        await tx.$executeRaw(Prisma.sql`INSERT INTO "AiProvider" ("id", "name", "kind", "baseUrl", "model", "encryptedKey", "keyFingerprint", "allowStudent", "allowPublic", "lastAssignedAt", "updatedAt", "cooldownUntil")
          VALUES (${id}, ${row.name}, 'CUSTOM', 'https://provider.example/v1', 'synthetic-model', ${encryptAiKey('key-' + row.name)}, ${id}, ${row.student}, ${row.public}, ${new Date(index)}, NOW(), CASE WHEN ${row.cooldownMinutes === undefined ? null : row.cooldownMinutes}::int IS NULL THEN NULL ELSE (NOW() AT TIME ZONE 'UTC') + ${row.cooldownMinutes || 0} * INTERVAL '1 minute' END)`);
      }
      const update = async ({ where, data }) => {
        const fields = ['lastAssignedAt', 'requestCount', 'lastStatus', 'failureCount', 'cooldownUntil'];
        const assignments = fields.filter(field => data[field] !== undefined).map(field => {
          const column = Prisma.raw('"' + field + '"');
          return data[field]?.increment !== undefined ? Prisma.sql`${column} = ${column} + ${data[field].increment}` : Prisma.sql`${column} = ${data[field]}`;
        });
        const rows = await tx.$queryRaw(Prisma.sql`UPDATE "AiProvider" SET ${Prisma.join(assignments)} WHERE "id" = ${where.id} RETURNING *`);
        return rows[0];
      };
      const transaction = { $queryRaw: query => tx.$queryRaw(query), aiProvider: { update } };
      return run({ $transaction: operation => operation(transaction), aiProvider: { update } });
    }, { timeout: 15000 });
  }
  const success = { status: 200, headers: {}, data: { choices: [{ message: { content: 'OK' } }] } };
  const messages = [{ role: 'user', content: 'Synthetic scope check' }];
  const separate = [{ name: 'public', public: true, student: false }, { name: 'student', public: false, student: true }];
  test.each(['America/Los_Angeles', 'Asia/Tokyo', 'Africa/Cairo', 'UTC'])('cooldowns expire at the right UTC instant in session timezone %s', timezone => isolated([
    { name: 'still-cooling', student: true, public: true, cooldownMinutes: 5 },
    { name: 'ready', student: true, public: true, cooldownMinutes: -1 },
  ], async scoped => {
    const transport = jest.fn(async () => success);
    await completeAi(messages, {}, scoped, transport);
    expect(transport.mock.calls.map(call => call[1])).toEqual(['key-ready']);
  }, timezone));
  test('public and student requests select their own pool, even when another pool has an older connection', () => isolated(separate, async scoped => {
    const transport = jest.fn(async () => success);
    await completeAi(messages, { publicRequest: false }, scoped, transport);
    expect(transport.mock.calls[0][1]).toBe('key-student');
    await completeAi(messages, { publicRequest: true }, scoped, transport);
    expect(transport.mock.calls[1][1]).toBe('key-public');
  }));
  test('public failure never falls back to a healthy student-only key', () => isolated(separate, async scoped => {
    const transport = jest.fn(async () => ({ status: 503, headers: {}, data: {} }));
    await expect(completeAi(messages, { publicRequest: true }, scoped, transport)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(transport.mock.calls.map(call => call[1])).toEqual(['key-public']);
  }));
  test('student rate limits never fall back to a healthy public-only key', () => isolated(separate, async scoped => {
    const transport = jest.fn(async () => ({ status: 429, headers: { 'retry-after': '30' }, data: {} }));
    await expect(completeAi(messages, {}, scoped, transport)).rejects.toMatchObject({ code: 'AI_PROVIDER_RATE_LIMIT' });
    expect(transport.mock.calls.map(call => call[1])).toEqual(['key-student']);
  }));
  test('both audiences can use a shared connection without crossing into the opposite exclusive pool', () => isolated([
    { name: 'student', student: true, public: false }, { name: 'both', student: true, public: true }, { name: 'public', student: false, public: true },
  ], async scoped => {
    const transport = jest.fn().mockResolvedValueOnce({ status: 503, headers: {}, data: {} }).mockResolvedValueOnce(success);
    await expect(completeAi(messages, {}, scoped, transport)).resolves.toMatchObject({ content: 'OK' });
    expect(transport.mock.calls.map(call => call[1])).toEqual(['key-student', 'key-both']);
  }));
});
