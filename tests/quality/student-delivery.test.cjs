require('ts-node/register/transpile-only');
const express = require('express'); const request = require('supertest'); const sharp = require('sharp');
const mockDb = {
  user: { findFirst: jest.fn(), findMany: jest.fn(), groupBy: jest.fn(), count: jest.fn() },
  school: { findMany: jest.fn() },
  certificate: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  studentNotification: { findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  pushSubscription: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  pushDelivery: { createMany: jest.fn() },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(fn => fn(mockDb)),
};
jest.mock('../../src/lib/prisma', () => ({ __esModule: true, default: mockDb }));
jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));
jest.mock('../../src/middleware/auth', () => ({
  verifyToken: (req, res, next) => { if (!req.headers['x-role']) return res.sendStatus(401); req.user = { id: 'me', role: req.headers['x-role'], schoolId: 'own' }; next(); },
  checkRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403),
}));
jest.mock('../../src/shared', () => ({ allowedOrigins: ['http://localhost:3000'], isOriginAllowed: (origin, allowed) => allowed.includes(origin), buildStudentCourseWhere: user => ({ schoolId: user.schoolId }), examMatchesStudent: exam => exam.schoolId === 'own', getStudentGradeAndStage: grade => [grade], parseStringArray: value => { try { return JSON.parse(value); } catch { return [value]; } } }));
const { prepareCertificate, readCertificateBytes, validPushEndpoint } = require('../../src/lib/studentDeliveryPolicy');
const { scanStudentContent, deliverStudentPush } = require('../../src/services/studentNotifications');
const app = express(); app.use(express.json()); app.use(require('../../src/routes/studentDelivery').default);
beforeEach(() => { jest.clearAllMocks(); mockDb.pushSubscription.findMany.mockResolvedValue([]); mockDb.certificate.findFirst.mockResolvedValue(null); });

test('certificate files require a session and enforce student/school ownership on every download', async () => {
  await request(app).get('/api/certificates/other/file').expect(401);
  mockDb.certificate.findFirst.mockResolvedValue(null);
  await request(app).get('/api/certificates/other/file').set('x-role', 'STUDENT').expect(404);
  expect(mockDb.certificate.findFirst.mock.calls[0][0].where).toEqual({ id: 'other', studentId: 'me', revokedAt: null });
  await request(app).get('/api/certificates/other/file').set('x-role', 'SCHOOL_ADMIN').expect(404);
  expect(mockDb.certificate.findFirst.mock.calls[1][0].where).toEqual({ id: 'other', schoolId: 'own', revokedAt: null });
  await request(app).get('/api/certificates/other/file').set('x-role', 'TEACHER').expect(403);
});
test('download is no-store, sandboxed, and always an attachment; never returns a public upload URL', async () => {
  mockDb.certificate.findFirst.mockResolvedValue({ ...(await prepareCertificate(Buffer.from('%PDF-1.4\n%%EOF'), 'شهادة.pdf')) });
  const result = await request(app).get('/api/certificates/c/file').set('x-role', 'STUDENT').expect(200);
  expect(result.headers['cache-control']).toContain('no-store'); expect(result.headers['content-disposition']).toMatch(/^attachment;/); expect(result.headers['content-security-policy']).toContain('sandbox');
});
test('school cannot issue a certificate to another school and students cannot upload', async () => {
  const file = Buffer.from('%PDF-1.4\n%%EOF'); mockDb.user.findFirst.mockResolvedValue(null);
  await request(app).post('/api/certificates').set('x-role', 'STUDENT').field('studentId', 'other').field('title', 'Award').attach('file', file, 'award.pdf').expect(403);
  await request(app).post('/api/certificates').set('x-role', 'SCHOOL_ADMIN').field('studentId', 'other').field('title', 'Award').attach('file', file, 'award.pdf').expect(404);
  expect(mockDb.user.findFirst.mock.calls[0][0].where).toMatchObject({ schoolId: 'own', role: 'STUDENT', deletedAt: null, status: 'ACTIVE' }); expect(mockDb.certificate.create).not.toHaveBeenCalled();
});
test('upload, file bytes and student notification commit together', async () => {
  mockDb.user.findFirst.mockResolvedValue({ id: 'child', schoolId: 'own' }); mockDb.certificate.create.mockResolvedValue({ id: 'certificate', title: 'Award' }); mockDb.studentNotification.create.mockResolvedValue({ id: 'notice' }); mockDb.pushSubscription.findMany.mockResolvedValue([{ id: 'device' }]);
  await request(app).post('/api/certificates').set('x-role', 'SCHOOL_ADMIN').set('Origin', 'http://localhost:3000').field('studentId', 'child').field('title', 'Award').attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'award.pdf').expect(201);
  expect(mockDb.certificate.create.mock.calls[0][0].data).toMatchObject({ studentId: 'child', schoolId: 'own', issuerId: 'me', fileData: expect.any(String), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(mockDb.studentNotification.create.mock.calls[0][0].data).toMatchObject({ userId: 'child', href: '/certificates' }); expect(mockDb.pushDelivery.createMany).toHaveBeenCalled();
});

test('single issuance rechecks the recipient inside the transaction after file processing', async () => {
  mockDb.user.findFirst.mockResolvedValueOnce({ id: 'child', schoolId: 'own' }).mockResolvedValueOnce(null);
  await request(app).post('/api/certificates').set('x-role', 'SCHOOL_ADMIN').field('studentId', 'child').field('title', 'Award').attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'award.pdf').expect(409);
  expect(mockDb.user.findFirst.mock.calls[1][0].where).toMatchObject({ id: 'child', schoolId: 'own', school: { status: 'ACTIVE' }, status: 'ACTIVE', deletedAt: null });
  expect(mockDb.certificate.create).not.toHaveBeenCalled();
  expect(mockDb.studentNotification.create).not.toHaveBeenCalled();
});

test('serialization retry reruns the whole issuance and detects the committed duplicate', async () => {
  mockDb.user.findFirst.mockResolvedValue({ id: 'child', schoolId: 'own' });
  mockDb.certificate.findFirst.mockResolvedValue({ id: 'existing', title: 'Award' });
  mockDb.$transaction.mockRejectedValueOnce(Object.assign(new Error('write conflict'), { code: 'P2034' }));
  await request(app).post('/api/certificates').set('x-role', 'SCHOOL_ADMIN').field('studentId', 'child').field('title', 'Award').attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'award.pdf').expect(200);
  expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
  expect(mockDb.certificate.create).not.toHaveBeenCalled();
  expect(mockDb.studentNotification.create).not.toHaveBeenCalled();
});

test('serialization conflicts stop after bounded retries; unrelated failures never retry', async () => {
  const { serializableTransaction } = require('../../src/lib/serializableTransaction');
  const conflict = { $transaction: jest.fn().mockRejectedValue({ code: 'P2034' }) };
  await expect(serializableTransaction(conflict, async () => {})).rejects.toMatchObject({ code: 'P2034' });
  expect(conflict.$transaction).toHaveBeenCalledTimes(3);
  const failure = { $transaction: jest.fn().mockRejectedValue(new Error('database unavailable')) };
  await expect(serializableTransaction(failure, async () => {})).rejects.toThrow('database unavailable');
  expect(failure.$transaction).toHaveBeenCalledTimes(1);
});
test('upload rejects SVG, HTML, active PDFs, oversized uploads and cross-site writes', async () => {
  await expect(prepareCertificate(Buffer.from('<svg/>'), 'fake.png')).rejects.toThrow();
  await expect(prepareCertificate(Buffer.from('%PDF-1.4 /Open#41ction 12\n%%EOF'), 'unsafe.pdf')).rejects.toThrow();
  await expect(prepareCertificate(Buffer.alloc(8 * 1024 * 1024 + 1), 'big.pdf')).rejects.toThrow('FILE_SIZE');
  await request(app).post('/api/certificates').set('x-role', 'SCHOOL_ADMIN').set('Origin', 'https://evil.example').send({}).expect(403);
});
test('raster certificates are decoded and re-encoded, with a stable integrity digest', async () => {
  const raw = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#5028e8' } }).jpeg().toBuffer();
  const file = await prepareCertificate(raw, '../certificate.jpg');
  expect(['image/png', 'image/webp']).toContain(file.mimeType); expect(file.fileName).toMatch(/^certificate\.(png|webp)$/);
  expect(['png', 'webp']).toContain((await sharp(readCertificateBytes(file)).metadata()).format); expect(file.sha256).toHaveLength(64);
});

test('stored images use the smaller lossless encoding without altering decoded pixels', async () => {
  const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#ffffff' } }).composite([{ input: Buffer.from('<svg width="900" height="600"><rect x="25" y="25" width="850" height="550" fill="none" stroke="#5028e8" stroke-width="5"/><text x="160" y="300" font-size="42" fill="#15152b">Academic Achievement</text></svg>') }]).png().toBuffer();
  const file = await prepareCertificate(source, 'award.png');
  const png = await sharp(source).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const webp = await sharp(source).webp({ lossless: true, effort: 4 }).toBuffer();
  expect(file.byteSize).toBe(Math.min(png.length, webp.length));
  const expected = await sharp(source).ensureAlpha().raw().toBuffer();
  const actual = await sharp(readCertificateBytes(file)).ensureAlpha().raw().toBuffer();
  expect(actual.equals(expected)).toBe(true);
});

test('altered bytes, byte counts and digests never produce a certificate download', async () => {
  const original = await prepareCertificate(Buffer.from('%PDF-1.4\n%%EOF'), 'award.pdf');
  expect(readCertificateBytes(original).toString()).toBe('%PDF-1.4\n%%EOF');
  for (const change of [{ fileData: Buffer.from('corrupted bytes').toString('base64') }, { byteSize: original.byteSize + 1 }, { sha256: '0'.repeat(64) }, { fileData: original.fileData + '\n' }]) {
    const corrupt = { ...original, ...change };
    expect(() => readCertificateBytes(corrupt)).toThrow('CERTIFICATE_INTEGRITY');
    mockDb.certificate.findFirst.mockResolvedValue(corrupt);
    const result = await request(app).get('/api/certificates/c/file').set('x-role', 'STUDENT').expect(500);
    expect(result.headers['content-disposition']).toBeUndefined(); expect(result.text).not.toContain('corrupted bytes');
  }
});

test('repeated identical issuance reuses the existing row and sends no duplicate notice', async () => {
  mockDb.user.findFirst.mockResolvedValue({ id: 'child', schoolId: 'own' });
  mockDb.certificate.findFirst.mockResolvedValue({ id: 'existing', title: 'Award' });
  const result = await request(app).post('/api/certificates').set('x-role', 'SCHOOL_ADMIN').field('studentId', 'child').field('title', 'Award').attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'award.pdf').expect(200);
  expect(result.body).toMatchObject({ id: 'existing', duplicate: true });
  expect(mockDb.$executeRaw).toHaveBeenCalled(); expect(mockDb.certificate.create).not.toHaveBeenCalled(); expect(mockDb.studentNotification.create).not.toHaveBeenCalled();
  expect(mockDb.certificate.findFirst.mock.calls[0][0].where).toMatchObject({ studentId: 'child', schoolId: 'own', title: 'Award', message: null, revokedAt: null, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
});

test('audience options derive the school tenant and use only active student grade counts', async () => {
  mockDb.school.findMany.mockResolvedValue([{ id: 'own', name: 'Own school' }]);
  mockDb.user.groupBy.mockResolvedValue([{ grade: 'G1', _count: { _all: 42 } }, { grade: null, _count: { _all: 1 } }]);
  const result = await request(app).get('/api/certificates/audience?schoolId=foreign').set('x-role', 'SCHOOL_ADMIN').expect(200);
  expect(mockDb.school.findMany.mock.calls[0][0].where).toEqual({ id: 'own', status: 'ACTIVE' });
  expect(mockDb.user.groupBy.mock.calls[0][0].where).toEqual({ schoolId: 'own', role: 'STUDENT', status: 'ACTIVE', deletedAt: null });
  expect(result.body).toMatchObject({ schoolId: 'own', grades: [{ value: 'G1', count: 42 }, { value: '__unassigned__', count: 1 }] });
  expect(result.headers['cache-control']).toContain('no-store');
  await request(app).get('/api/certificates/audience').set('x-role', 'STUDENT').expect(403);
});

test('super admin selects a real school before grades; school and grade are required for rosters', async () => {
  mockDb.school.findMany.mockResolvedValue([{ id: 'other', name: 'Other school' }]);
  await request(app).get('/api/certificates/audience?schoolId=missing').set('x-role', 'SUPER_ADMIN').expect(404);
  await request(app).get('/api/certificates/recipients?grade=G1').set('x-role', 'SUPER_ADMIN').expect(400);
  await request(app).get('/api/certificates/recipients?schoolId=other').set('x-role', 'SUPER_ADMIN').expect(400);
  mockDb.user.findMany.mockResolvedValue([{ id: 'child', name: 'Child', username: 'child', grade: 'G1' }]); mockDb.user.count.mockResolvedValue(1);
  const result = await request(app).get('/api/certificates/recipients?schoolId=other&grade=G1').set('x-role', 'SUPER_ADMIN').expect(200);
  expect(result.body).toMatchObject({ total: 1, nextCursor: null });
  expect(mockDb.user.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: 'other', grade: 'G1', role: 'STUDENT', status: 'ACTIVE', deletedAt: null, school: { status: 'ACTIVE' } });
});

test('roster pagination reaches beyond the old 30 results without leaking other schools or file bytes', async () => {
  mockDb.user.findMany.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({ id: `id-${String(index).padStart(3, '0')}`, name: `Student ${index}`, username: `user${index}` })));
  mockDb.user.count.mockResolvedValue(260);
  const result = await request(app).get('/api/certificates/recipients?schoolId=foreign&grade=G1').set('x-role', 'SCHOOL_ADMIN').expect(200);
  expect(result.body.items).toHaveLength(200); expect(result.body.nextCursor).toBe('id-199'); expect(result.body.total).toBe(260);
  expect(mockDb.user.findMany.mock.calls[0][0].where.schoolId).toBe('own');
  await request(app).get('/api/certificates/recipients?grade=G1&cursor=id-199').set('x-role', 'SCHOOL_ADMIN').expect(200);
  expect(mockDb.user.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'id-199' });
  expect(mockDb.user.findMany.mock.calls[1][0].select).toEqual({ id: true, name: true, username: true, grade: true });
});

const bulkRequest = (role = 'SCHOOL_ADMIN', ids = ['one', 'two'], schoolId = 'own') => request(app).post('/api/certificates').set('x-role', role).field('schoolId', schoolId).field('grade', 'G1').field('studentIds', JSON.stringify(ids)).field('title', 'Group award').attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'award.pdf');
test('bulk issuance validates the entire school and grade before any writes', async () => {
  await bulkRequest('SCHOOL_ADMIN', ['one'], 'foreign').expect(403);
  await bulkRequest('TEACHER').expect(403);
  await bulkRequest('SCHOOL_ADMIN', ['one', 'one']).expect(400);
  await bulkRequest('SCHOOL_ADMIN', Array.from({ length: 101 }, (_, i) => String(i))).expect(400);
  mockDb.user.findMany.mockResolvedValue([{ id: 'one', schoolId: 'own' }]);
  await bulkRequest().expect(409);
  expect(mockDb.user.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ['one', 'two'] }, schoolId: 'own', grade: 'G1', school: { status: 'ACTIVE' } });
  expect(mockDb.certificate.create).not.toHaveBeenCalled(); expect(mockDb.studentNotification.create).not.toHaveBeenCalled();
});

test('bulk saves only selected students, skips duplicates, and queues individual private notifications atomically', async () => {
  mockDb.user.findMany.mockResolvedValue([{ id: 'one', schoolId: 'other' }, { id: 'two', schoolId: 'other' }]);
  mockDb.certificate.findFirst.mockResolvedValueOnce({ id: 'already-saved' }).mockResolvedValueOnce(null);
  mockDb.certificate.create.mockResolvedValue({ id: 'new-award' }); mockDb.studentNotification.create.mockResolvedValue({ id: 'notice' }); mockDb.pushSubscription.findMany.mockResolvedValue([{ id: 'device' }]);
  const result = await bulkRequest('SUPER_ADMIN', ['two', 'one'], 'other').expect(201);
  expect(result.body).toEqual({ created: 1, duplicates: 1, total: 2 });
  expect(mockDb.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'Serializable' });
  expect(mockDb.$executeRaw).toHaveBeenCalledTimes(2);
  expect(mockDb.certificate.create).toHaveBeenCalledTimes(1);
  expect(mockDb.certificate.create.mock.calls[0][0].data).toMatchObject({ studentId: 'two', schoolId: 'other', issuerId: 'me', title: 'Group award', fileData: expect.any(String) });
  expect(mockDb.studentNotification.create).toHaveBeenCalledTimes(1); expect(mockDb.studentNotification.create.mock.calls[0][0].data.userId).toBe('two');
  expect(mockDb.pushDelivery.createMany).toHaveBeenCalledTimes(1);
});
test('inbox and marking read always constrain the authenticated recipient', async () => {
  mockDb.studentNotification.findMany.mockResolvedValue([]); mockDb.studentNotification.count.mockResolvedValue(0);
  mockDb.studentNotification.updateMany.mockResolvedValue({ count: 0 });
  await request(app).get('/api/notifications?userId=victim').set('x-role', 'STUDENT').expect(200);
  expect(mockDb.studentNotification.findMany.mock.calls[0][0].where).toEqual({ userId: 'me' });
  await request(app).patch('/api/notifications/read').set('x-role', 'STUDENT').send({ id: 'victim-notice' }).expect(200);
  expect(mockDb.studentNotification.updateMany.mock.calls[0][0].where).toEqual({ userId: 'me', id: 'victim-notice', readAt: null });
});

test('notification filters apply to all pages while counts and ownership remain recipient scoped', async () => {
  mockDb.studentNotification.findMany.mockResolvedValue([]);
  mockDb.studentNotification.count.mockImplementation(async ({ where }) => where.OR ? 2 : where.readAt === null ? 4 : 10);
  const result = await request(app).get('/api/notifications?category=assessments&unread=1&q=matrix&offset=30&userId=victim').set('x-role', 'STUDENT').expect(200);
  expect(result.body).toMatchObject({ total: 2, unread: 4, inboxTotal: 10 });
  expect(mockDb.studentNotification.findMany.mock.calls[0][0]).toMatchObject({ take: 30, skip: 30, where: {
    userId: 'me', readAt: null, kind: { in: ['EXAM', 'EXAM_OPEN'] },
    OR: ['titleAr', 'titleEn', 'body'].map(field => ({ [field]: { contains: 'matrix', mode: 'insensitive' } })),
  } });
  expect(mockDb.studentNotification.count.mock.calls.every(([args]) => args.where.userId === 'me')).toBe(true);
});
test('push subscriptions reject SSRF endpoints and cannot be stolen by another account', async () => {
  for (const url of ['http://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/x', 'https://fcm.googleapis.com.evil.example/x', 'https://evil.example/x', 'https://user@fcm.googleapis.com/x']) expect(validPushEndpoint(url)).toBe(false);
  expect(validPushEndpoint('https://fcm.googleapis.com/fcm/send/token')).toBe(true);
  process.env.VAPID_PUBLIC_KEY = 'key'; process.env.VAPID_PRIVATE_KEY = 'key'; process.env.VAPID_SUBJECT = 'https://example.com';
  mockDb.pushSubscription.findUnique.mockResolvedValue({ userId: 'someone-else' });
  await request(app).post('/api/push/subscriptions').set('x-role', 'STUDENT').send({ endpoint: 'https://fcm.googleapis.com/fcm/send/token', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } }).expect(409);
  expect(mockDb.pushSubscription.upsert).not.toHaveBeenCalled();
});
function scanDb() {
  const saved = new Map(); const from = new Date('2026-10-20T10:00:00Z'); const release = new Date('2026-10-20T10:01:00Z');
  const db = {
    notificationCursor: { findUnique: jest.fn().mockResolvedValue({ value: from }), update: jest.fn(), upsert: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'child', schoolId: 'own', grade: 'G1', createdAt: new Date('2020-01-01') }]) },
    course: { findMany: jest.fn().mockResolvedValue([{ id: 'course', title: 'Course' }]) },
    lesson: { findMany: jest.fn().mockResolvedValue([{ id: 'lesson', title: 'Released', courseId: 'course', publishDate: release }, { id: 'future', title: 'Hidden future', courseId: 'course', publishDate: new Date('2027-01-01') }]) },
    exam: { findMany: jest.fn().mockResolvedValue([{ id: 'exam', title: 'Exam', schoolId: 'own', startDate: release, createdAt: from, updatedAt: from, modules: [] }, { id: 'wrong-school', title: 'Private', schoolId: 'other', startDate: release, modules: [] }]) },
    studentNotification: { upsert: jest.fn(async ({ where, create }) => { const key = JSON.stringify(where); if (!saved.has(key)) saved.set(key, { id: key, ...create }); return saved.get(key); }) },
    pushSubscription: { findMany: jest.fn().mockResolvedValue([]) }, pushDelivery: { createMany: jest.fn() },
  }; db.$transaction = fn => fn(db); return { db, saved };
}
test('scanner honors audience/release times and replays idempotently without revealing future lessons', async () => {
  const { db, saved } = scanDb(); const now = new Date('2026-10-20T10:02:00Z');
  await scanStudentContent(db, now); await scanStudentContent(db, now);
  expect(saved.size).toBe(3); expect([...saved.values()].map(n => n.body)).toEqual(['Course', 'Released', 'Exam']);
  expect(db.lesson.findMany.mock.calls[0][0].where).toMatchObject({ isVisible: true, deletedAt: null, course: { schoolId: 'own', deletedAt: null } }); expect(db.notificationCursor.update).toHaveBeenCalledTimes(2);
});
test('scheduler starts prospectively and a failed notification never advances the checkpoint', async () => {
  const { db } = scanDb(); db.notificationCursor.findUnique.mockResolvedValueOnce(null); await scanStudentContent(db); expect(db.course.findMany).not.toHaveBeenCalled();
  db.studentNotification.upsert.mockRejectedValue(new Error('database unavailable')); await expect(scanStudentContent(db, new Date('2026-10-20T10:02:00Z'))).rejects.toThrow(); expect(db.notificationCursor.update).not.toHaveBeenCalled();
});
test('push retries preserve undelivered messages and expired device endpoints are removed', async () => {
  const webpush = require('web-push');
  const job = { id: 'job', attempts: 0, notification: { id: 'notice', userId: 'child' }, subscription: { id: 'sub', userId: 'child', endpoint: 'https://fcm.googleapis.com/fcm/send/device', p256dh: 'key', auth: 'auth', language: 'ar', user: { status: 'ACTIVE', deletedAt: null } } };
  const db = { pushDelivery: { findMany: jest.fn().mockResolvedValue([job]), update: jest.fn() }, pushSubscription: { deleteMany: jest.fn() } };
  webpush.sendNotification.mockRejectedValueOnce({ statusCode: 503 }); await deliverStudentPush(db);
  expect(db.pushDelivery.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attempts: { increment: 1 }, nextAttemptAt: expect.any(Date) }) }));
  webpush.sendNotification.mockRejectedValueOnce({ statusCode: 410 }); await deliverStudentPush(db);
  expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 'sub' } });
  webpush.sendNotification.mockResolvedValueOnce({}); await deliverStudentPush(db);
  expect(db.pushDelivery.update).toHaveBeenLastCalledWith({ where: { id: 'job' }, data: { deliveredAt: expect.any(Date) } });
  const payload = JSON.parse(webpush.sendNotification.mock.calls[2][1]); expect(payload.url).toBe('/notifications'); expect(payload.body).not.toContain('child');
});
test('nested exam windows honor the latest parent opening time and grade audience', async () => {
  const { db, saved } = scanDb(); db.course.findMany.mockResolvedValue([]); db.lesson.findMany.mockResolvedValue([]);
  const old = new Date('2020-01-01'); const opened = new Date('2026-10-20T10:01:00Z'); const future = new Date('2027-01-01');
  db.exam.findMany.mockResolvedValue([{ id: 'exam', title: 'Exam', schoolId: 'own', startDate: old, createdAt: old, updatedAt: old, modules: [
    { id: 'parent', title: 'Parent', createdAt: old, publishDate: future, subExams: [] },
    { id: 'child', title: 'Child', parentModuleId: 'parent', createdAt: old, publishDate: opened, subExams: [{ id: 'sub', title: 'Sub', publishDate: opened }] },
    { id: 'other-grade', title: 'G2', gradeTarget: 'G2', createdAt: old, publishDate: opened, subExams: [] },
  ] }]);
  await scanStudentContent(db, new Date('2026-10-20T10:02:00Z')); expect(saved.size).toBe(0);
});
