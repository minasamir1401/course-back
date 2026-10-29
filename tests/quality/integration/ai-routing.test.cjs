require('dotenv/config');
require('ts-node/register/transpile-only');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { encryptAiKey, aiKeyFingerprint } = require('../../../src/lib/aiSecurity');
const { completeAi } = require('../../../src/services/aiRouting.service');

const canRun = process.env.RUN_AI_DB_TESTS === '1' && ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL || 'http://invalid').hostname);
(canRun ? describe : describe.skip)('AI routing across real PostgreSQL transactions', () => {
  const db = new PrismaClient(); const ids = Array.from({ length: 10 }, () => crypto.randomUUID());
  beforeAll(async () => {
    if (await db.aiProvider.count({ where: { enabled: true } })) throw new Error('Run AI integration in a local database with no enabled real providers.');
    await db.aiProvider.createMany({ data: ids.map((id, index) => {
      const key = `synthetic-ai-test-${id}`;
      return { id, name: `AI test ${index}`, kind: 'GROQ', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', encryptedKey: encryptAiKey(key), keyFingerprint: aiKeyFingerprint(key), allowPublic: index === 0 };
    }) });
  });
  afterAll(async () => { await db.aiProvider.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); });
  test('10 concurrent requests reserve 10 different keys with no artificial output token cap', async () => {
    const payloads = [];
    const transport = async (_base, key, body) => { payloads.push(body); expect(key).toMatch(/^synthetic-ai-test-/); return { status: 200, headers: {}, data: { choices: [{ message: { content: 'Test reply' } }], usage: { total_tokens: 20 } } }; };
    const replies = await Promise.all(ids.map(() => completeAi([{ role: 'user', content: 'Test only' }], {}, db, transport)));
    expect(new Set(replies.map(reply => reply.providerId)).size).toBe(10);
    for (const body of payloads) { expect(body.max_tokens).toBeUndefined(); expect(body.max_completion_tokens).toBeUndefined(); }
  });
  test('429 cools down one provider and fails over to a different key', async () => {
    let calls = 0;
    const reply = await completeAi([{ role: 'user', content: 'Test only' }], {}, db, async () => ++calls === 1 ? { status: 429, headers: { 'retry-after': '60' }, data: {} } : { status: 200, headers: {}, data: { choices: [{ message: { content: 'Recovered' } }] } });
    expect(reply.content).toBe('Recovered'); expect(calls).toBe(2);
    expect(await db.aiProvider.count({ where: { id: { in: ids }, cooldownUntil: { gt: new Date() } } })).toBe(1);
  });
  test('public requests only use explicitly allowed credentials', async () => {
    await db.aiProvider.updateMany({ where: { id: { in: ids } }, data: { cooldownUntil: null } });
    const reply = await completeAi([{ role: 'user', content: 'Public test' }], { publicRequest: true }, db, async () => ({ status: 200, headers: {}, data: { choices: [{ message: { content: 'Public reply' } }] } }));
    expect(reply.providerId).toBe(ids[0]);
  });
});
