require('dotenv/config');
require('ts-node/register/transpile-only');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { claimAiProvider } = require('../../../src/services/aiRouting.service');
const { encryptAiKey } = require('../../../src/lib/aiSecurity');

const local = process.env.RUN_AI_DB_TESTS === '1' && ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL || 'http://invalid').hostname);
(local ? test : test.skip)('an additional Gemini key joins sequential rotation, respects audience and skips unavailable connections', async () => {
  const db = new PrismaClient();
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
  const rollback = new Error('Rollback isolated AI routing fixtures');
  try {
    await expect(db.$transaction(async tx => {
      // Exclude every real connection. All fixture writes are rolled back.
      const excluded = (await tx.aiProvider.findMany({ select: { id: true } })).map(row => row.id);
      await tx.aiProvider.createMany({ data: ids.map((id, index) => ({ id, name: 'Rotation test ' + id,
        kind: 'GEMINI', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-flash-lite',
        encryptedKey: encryptAiKey('synthetic-rotation-' + id), keyFingerprint: 'synthetic-' + id,
        allowStudent: index !== 2, allowPublic: index === 2,
        ...(index === 0 ? { lastAssignedAt: new Date('2026-01-01T00:00:00Z') } : {}),
      })) });
      const isolated = { $transaction: operation => operation(tx) };
      const sequence = [];
      for (let i = 0; i < 6; i++) sequence.push((await claimAiProvider(isolated, excluded, false)).id);
      expect(sequence).toEqual([ids[1], ids[0], ids[1], ids[0], ids[1], ids[0]]);
      await tx.aiProvider.update({ where: { id: ids[1] }, data: { cooldownUntil: new Date(Date.now() + 60000) } });
      expect((await claimAiProvider(isolated, excluded, false)).id).toBe(ids[0]);
      await tx.aiProvider.update({ where: { id: ids[0] }, data: { enabled: false } });
      expect(await claimAiProvider(isolated, excluded, false)).toBeNull();
      expect((await claimAiProvider(isolated, excluded, true)).id).toBe(ids[2]);
      throw rollback;
    }, { timeout: 15000 })).rejects.toBe(rollback);
    expect(await db.aiProvider.count({ where: { id: { in: ids } } })).toBe(0);
  } finally { await db.$disconnect(); }
});
