require('dotenv/config');
require('ts-node/register/transpile-only');
jest.mock('../../../src/middleware/auth', () => ({
  verifyToken: (req, res, next) => { if (!req.headers['x-test-role']) return res.sendStatus(401); req.user = { id: 'group-test', role: req.headers['x-test-role'] }; next(); },
  checkRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
}));
jest.mock('../../../src/lib/redis', () => ({ checkRateLimit: jest.fn(async () => ({ allowed: true })) }));
const crypto = require('node:crypto');
const db = require('../../../src/lib/prisma').default;
const routing = require('../../../src/services/aiRouting.service');
const { encryptAiKey, decryptAiKey, aiKeyFingerprint } = require('../../../src/lib/aiSecurity');
const express = require('express');
const request = require('supertest');
const app = express(); app.use(express.json()); app.use(require('../../../src/routes/ai').default);
const local = process.env.RUN_AI_DB_TESTS === '1' && ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL || 'http://invalid').hostname);
(local ? describe : describe.skip)('multiple encrypted credentials in one editable AI connection', () => {
  const id = crypto.randomUUID();
  const primary = 'synthetic-primary-' + id;
  const extras = ['synthetic-second-' + id, 'synthetic-third-' + id];
  let catalogue;
  const patch = body => request(app).patch('/api/ai/admin/providers/' + id).set('x-test-role', 'SUPER_ADMIN').send(body);
  beforeAll(async () => {
    await db.aiProvider.create({ data: { id, name: 'AI grouped fixture', kind: 'GEMINI', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-flash-lite', encryptedKey: encryptAiKey(primary), keyFingerprint: aiKeyFingerprint(primary), allowPublic: true, allowStudent: true } });
    catalogue = jest.spyOn(routing, 'requestAiModels').mockResolvedValue({ status: 200, data: { data: [{ id: 'gemini-2.5-flash' }] } });
  });
  afterAll(async () => { catalogue?.mockRestore(); await db.aiProvider.deleteMany({ where: { id } }); await db.$disconnect(); });
  test('only super admin can append keys', async () => {
    await request(app).patch('/api/ai/admin/providers/' + id).send({ additionalKeys: extras }).expect(401);
    for (const role of ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN']) await request(app).patch('/api/ai/admin/providers/' + id).set('x-test-role', role).send({ additionalKeys: extras }).expect(403);
    expect(catalogue).not.toHaveBeenCalled();
  });
  test('saving edits and two additional keys is atomic, encrypted and visible on reread', async () => {
    const before = await db.aiProvider.findUnique({ where: { id } });
    const result = await patch({ name: 'Updated group', model: 'gemini-2.5-flash', additionalKeys: extras }).expect(200);
    expect(result.body.provider).toMatchObject({ id, name: 'Updated group', parentId: null });
    expect(JSON.stringify(result.body)).not.toMatch(/encryptedKey|keyFingerprint|synthetic-/);
    const root = await db.aiProvider.findUnique({ where: { id } });
    expect(root.encryptedKey).toBe(before.encryptedKey);
    const children = await db.aiProvider.findMany({ where: { parentId: id } });
    expect(children).toHaveLength(2);
    expect(children.map(child => decryptAiKey(child.encryptedKey)).sort()).toEqual(extras.slice().sort());
    for (const child of children) expect(child).toMatchObject({ model: root.model, baseUrl: root.baseUrl, kind: root.kind, allowPublic: true, allowStudent: true });
    const settings = await request(app).get('/api/ai/admin/settings').set('x-test-role', 'SUPER_ADMIN').expect(200);
    expect(settings.body.providers.filter(item => item.parentId === id)).toHaveLength(2);
    expect(JSON.stringify(settings.body)).not.toMatch(/encryptedKey|keyFingerprint|synthetic-/);
  });
  test('duplicate or unavailable new credentials cannot partially save the group', async () => {
    await patch({ name: 'Must roll back', additionalKeys: ['synthetic-new-' + id, extras[0]] }).expect(409);
    expect((await db.aiProvider.findUnique({ where: { id } })).name).toBe('Updated group');
    expect(await db.aiProvider.count({ where: { parentId: id } })).toBe(2);
    await patch({ name: 'Unavailable', model: 'not-in-catalogue', additionalKeys: ['synthetic-unavailable-' + id] }).expect(400);
    expect((await db.aiProvider.findUnique({ where: { id } })).name).toBe('Updated group');
  });
  test('adding a key on a later edit retains all earlier credentials and stable key labels', async () => {
    const key = 'synthetic-fourth-' + id;
    await patch({ additionalKeys: [key] }).expect(200);
    const saved = await db.aiProvider.findMany({ where: { parentId: id }, orderBy: { name: 'asc' } });
    expect(saved.map(item => item.name)).toEqual(['Key 2', 'Key 3', 'Key 4']);
    expect(saved.map(item => decryptAiKey(item.encryptedKey)).sort()).toEqual([...extras, key].sort());
    // Remove only this synthetic row so the following three-key rotation test stays focused.
    await db.aiProvider.deleteMany({ where: { parentId: id, keyFingerprint: aiKeyFingerprint(key) } });
  });
  test('six sequential requests rotate across the three credentials of the same connection', async () => {
    const members = await db.aiProvider.findMany({ where: { OR: [{ id }, { parentId: id }] }, select: { id: true } });
    const allowed = members.map(item => item.id);
    const excluded = (await db.aiProvider.findMany({ select: { id: true } })).map(item => item.id).filter(key => !allowed.includes(key));
    const used = [];
    for (let i = 0; i < 6; i++) used.push((await routing.claimAiProvider(db, excluded, false)).id);
    for (const key of allowed) expect(used.filter(value => value === key)).toHaveLength(2);
  });
  test('audience and enable changes apply to every member and URL changes protect saved credentials', async () => {
    await patch({ enabled: false, allowPublic: false, allowStudent: true }).expect(200);
    const members = await db.aiProvider.findMany({ where: { OR: [{ id }, { parentId: id }] } });
    for (const key of members) expect(key).toMatchObject({ enabled: false, allowPublic: false, allowStudent: true });
    await patch({ baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'synthetic-new-primary' }).expect(400);
    expect((await db.aiProvider.findUnique({ where: { id } })).baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });
});
