import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma';
import { verifyToken, checkRole } from '../middleware/auth';
import { CERTIFICATE_MAX_BYTES, certificateScope, prepareCertificate, readCertificateBytes, validPushEndpoint } from '../lib/studentDeliveryPolicy';
import { pushEnabled, pushPublicKey } from '../services/studentNotifications';
import { isOriginAllowed, allowedOrigins } from '../shared';
import { serializableTransaction } from '../lib/serializableTransaction';

const router = Router();
const student = checkRole(['STUDENT']);
const issuer = checkRole(['SCHOOL_ADMIN', 'SUPER_ADMIN']);
const limiter = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CERTIFICATE_MAX_BYTES, files: 1, fields: 6, fieldSize: 16000 } }).single('file');
const summary = { id: true, studentId: true, title: true, message: true, fileName: true, mimeType: true, byteSize: true, sha256: true, createdAt: true, revokedAt: true, student: { select: { name: true, username: true } }, school: { select: { name: true } }, issuer: { select: { name: true } } } as const;
const noStore = (_req: any, res: any, next: any) => { res.setHeader('Cache-Control', 'private, no-store'); next(); };
router.use(['/api/notifications', '/api/push', '/api/certificates'], noStore);
router.use(['/api/notifications', '/api/push', '/api/certificates'], (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && !isOriginAllowed(req.headers.origin, allowedOrigins)) return res.status(403).json({ error: 'Origin not allowed' });
  next();
});
router.get('/api/push/config', verifyToken, student, (_req, res) => res.json({ enabled: pushEnabled(), publicKey: pushEnabled() ? pushPublicKey() : null }));
router.get('/api/push/devices', verifyToken, student, async (req: any, res: any) => {
  try { res.json({ devices: await prisma.pushSubscription.findMany({ where: { userId: req.user.id }, select: { endpoint: true }, take: 10 }) }); }
  catch { res.status(500).json({ error: 'Could not check device subscription' }); }
});
router.post('/api/push/subscriptions', verifyToken, student, limiter, async (req: any, res: any) => {
  try {
    const { endpoint, keys, language } = req.body;
    if (!validPushEndpoint(endpoint) || !keys || !/^[\w-]{87}$/.test(keys.p256dh || '') || !/^[\w-]{22}$/.test(keys.auth || '')) return res.status(400).json({ error: 'Invalid subscription' });
    if (!pushEnabled()) return res.status(503).json({ error: 'Push is not configured' });
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (existing && existing.userId !== req.user.id) return res.status(409).json({ error: 'Unsubscribe this browser before changing accounts' });
    if (!existing && await prisma.pushSubscription.count({ where: { userId: req.user.id } }) >= 10) return res.status(400).json({ error: 'Device limit reached' });
    const data = { p256dh: keys.p256dh, auth: keys.auth, language: language === 'en' ? 'en' : 'ar' };
    await prisma.pushSubscription.upsert({ where: { endpoint }, update: data, create: { ...data, endpoint, userId: req.user.id } });
    res.status(201).json({ success: true });
  } catch { res.status(500).json({ error: 'Subscription could not be saved' }); }
});
router.delete('/api/push/subscriptions', verifyToken, student, limiter, async (req: any, res: any) => {
  if (typeof req.body.endpoint !== 'string') return res.status(400).json({ error: 'Endpoint required' });
  try { await prisma.pushSubscription.deleteMany({ where: { userId: req.user.id, endpoint: req.body.endpoint } }); res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Could not unsubscribe' }); }
});
router.get('/api/notifications', verifyToken, student, async (req: any, res: any) => {
  try {
    const offset = Math.max(0, Math.min(100000, Number(req.query.offset) || 0));
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const categories: Record<string, string[]> = { learning: ['COURSE', 'LESSON'], assessments: ['EXAM', 'EXAM_OPEN'], certificates: ['CERTIFICATE'] };
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 150) : '';
    const where: any = { userId: req.user.id, ...(req.query.unread === '1' ? { readAt: null } : {}),
      ...(categories[category] ? { kind: { in: categories[category] } } : {}),
      ...(query ? { OR: ['titleAr', 'titleEn', 'body'].map(field => ({ [field]: { contains: query, mode: 'insensitive' } })) } : {}) };
    const [items, total, unread, inboxTotal] = await Promise.all([
      prisma.studentNotification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30, skip: offset }),
      prisma.studentNotification.count({ where }), prisma.studentNotification.count({ where: { userId: req.user.id, readAt: null } }),
      prisma.studentNotification.count({ where: { userId: req.user.id } }),
    ]);
    res.json({ items, total, unread, inboxTotal });
  } catch { res.status(500).json({ error: 'Could not load notifications' }); }
});
router.patch('/api/notifications/read', verifyToken, student, limiter, async (req: any, res: any) => {
  if (req.body.id !== undefined && typeof req.body.id !== 'string') return res.status(400).json({ error: 'Invalid notification' });
  try {
    const result = await prisma.studentNotification.updateMany({ where: { userId: req.user.id, readAt: null, ...(req.body.id ? { id: req.body.id } : {}) }, data: { readAt: new Date() } });
    const unread = await prisma.studentNotification.count({ where: { userId: req.user.id, readAt: null } });
    res.json({ success: true, updated: result.count, unread });
  }
  catch { res.status(500).json({ error: 'Could not update notifications' }); }
});

// Options and rosters come from active accounts; school admins cannot override their tenant.
const audienceSchool = (req: any) => req.user.role === 'SCHOOL_ADMIN' ? req.user.schoolId : (typeof req.query.schoolId === 'string' ? req.query.schoolId : null);
const audienceGrade = (value: string) => value === '__unassigned__' ? null : value === '__empty__' ? '' : value;
router.get('/api/certificates/audience', verifyToken, issuer, async (req: any, res: any) => {
  if (req.user.role === 'SCHOOL_ADMIN' && !req.user.schoolId) return res.sendStatus(403);
  try {
    const schools = await prisma.school.findMany({ where: { status: 'ACTIVE', ...(req.user.role === 'SCHOOL_ADMIN' ? { id: req.user.schoolId } : {}) }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    const schoolId = audienceSchool(req);
    if (schoolId && !schools.some(school => school.id === schoolId)) return res.sendStatus(404);
    const groups = schoolId ? await prisma.user.groupBy({ by: ['grade'], where: { schoolId, role: 'STUDENT', status: 'ACTIVE', deletedAt: null }, _count: { _all: true }, orderBy: { grade: 'asc' } }) : [];
    res.json({ schools, schoolId: schoolId || null, grades: groups.map(group => ({ value: group.grade === null ? '__unassigned__' : group.grade === '' ? '__empty__' : group.grade, count: group._count._all })) });
  } catch { res.status(500).json({ error: 'Could not load certificate audience' }); }
});
router.get('/api/certificates/recipients', verifyToken, issuer, async (req: any, res: any) => {
  if (req.user.role === 'SCHOOL_ADMIN' && !req.user.schoolId) return res.sendStatus(403);
  const schoolId = audienceSchool(req);
  const grade = typeof req.query.grade === 'string' ? req.query.grade : null;
  if (!schoolId || grade === null || grade.length > 160) return res.status(400).json({ error: 'Choose a school and grade' });
  try {
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length <= 100 ? req.query.cursor : '';
    const where = { role: 'STUDENT', status: 'ACTIVE', deletedAt: null, schoolId, school: { status: 'ACTIVE' }, grade: audienceGrade(grade) };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true, name: true, username: true, grade: true }, take: 201, orderBy: { id: 'asc' } }),
      prisma.user.count({ where }),
    ]);
    const items = rows.slice(0, 200);
    res.json({ items, total, nextCursor: rows.length > 200 ? items[items.length - 1].id : null });
  } catch { res.status(500).json({ error: 'Could not load students' }); }
});
router.get('/api/certificates', verifyToken, async (req: any, res: any) => {
  const where = certificateScope(req.user);
  if (!where) return res.sendStatus(403);
  try {
    const offset = Math.max(0, Math.min(100000, Number(req.query.offset) || 0));
    const [items, total] = await Promise.all([prisma.certificate.findMany({ where, select: summary, take: 24, skip: offset, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), prisma.certificate.count({ where })]);
    res.json({ items, total });
  } catch { res.status(500).json({ error: 'Could not load certificates' }); }
});
router.post('/api/certificates', verifyToken, issuer, limiter, (req: any, res: any, next: any) => upload(req, res, (error: any) => error ? res.status(400).json({ error: 'Upload one PDF, PNG, JPG or WebP file, up to 8 MB' }) : next()), async (req: any, res: any) => {
  try {
    const { studentId, studentIds, schoolId, grade, title, message } = req.body;
    if (!req.file || typeof title !== 'string' || !title.trim() || title.trim().length > 160 || (message !== undefined && (typeof message !== 'string' || message.length > 1000))) return res.status(400).json({ error: 'Invalid certificate details' });
    const bulk = studentIds !== undefined;
    let ids: string[] = [];
    if (bulk) {
      let parsed: unknown;
      try { parsed = JSON.parse(studentIds); } catch { return res.status(400).json({ error: 'Invalid recipients' }); }
      if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100 || parsed.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(parsed).size !== parsed.length || typeof schoolId !== 'string' || !schoolId || typeof grade !== 'string' || grade.length > 160) return res.status(400).json({ error: 'Choose 1–100 students from one school and grade' });
      if (req.user.role === 'SCHOOL_ADMIN' && schoolId !== req.user.schoolId) return res.sendStatus(403);
      ids = (parsed as string[]).sort();
    } else if (typeof studentId !== 'string' || !studentId) return res.status(400).json({ error: 'Student required' });
    const scope = { role: 'STUDENT', status: 'ACTIVE', deletedAt: null, schoolId: req.user.role === 'SCHOOL_ADMIN' ? (req.user.schoolId || '__none__') : { not: null } };
    // Keep the single-recipient contract for existing clients. New bulk clients must specify their exact audience.
    const singleRecipient = bulk ? null : await prisma.user.findFirst({ where: { ...scope, id: studentId }, select: { id: true, schoolId: true } });
    if (!bulk && !singleRecipient?.schoolId) return res.status(404).json({ error: 'Student not found in your school' });
    const file = await prepareCertificate(req.file.buffer, req.file.originalname).catch(() => null);
    if (!file) return res.status(400).json({ error: 'Invalid or unsafe file. Use a static PDF or PNG, JPG, WebP image (8 MB maximum).' });
    const result = await serializableTransaction(prisma, async tx => {
      const currentRecipient = bulk ? null : await tx.user.findFirst({ where: { ...scope, id: studentId, schoolId: singleRecipient!.schoolId!, school: { status: 'ACTIVE' } }, select: { id: true, schoolId: true } });
      const recipients = bulk ? await tx.user.findMany({ where: { ...scope, schoolId, school: { status: 'ACTIVE' }, grade: audienceGrade(grade), id: { in: ids } }, select: { id: true, schoolId: true }, orderBy: { id: 'asc' } }) : currentRecipient ? [currentRecipient] : [];
      // Fail the whole batch before writing if anyone moved school/grade or became inactive.
      if (recipients.length !== (bulk ? ids.length : 1)) throw new Error('AUDIENCE_CHANGED');
      const results = [];
      for (const recipient of recipients) {
      // Serialise identical uploads across tabs/processes, not just within this Node worker.
      // PostgreSQL releases this lock automatically on transaction commit or rollback.
      const lockKey = `certificate:${recipient.schoolId}:${recipient.id}:${file.sha256}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const existing = await tx.certificate.findFirst({ where: { schoolId: recipient.schoolId!, studentId: recipient.id, sha256: file.sha256, title: title.trim(), message: message?.trim() || null, revokedAt: null }, select: summary });
      if (existing) { results.push({ certificate: existing, duplicate: true }); continue; }
      const certificate = await tx.certificate.create({ data: { ...file, studentId: recipient.id, schoolId: recipient.schoolId!, issuerId: req.user.id, title: title.trim(), message: message?.trim() || null }, select: summary });
      const notification = await tx.studentNotification.create({ data: { userId: recipient.id, eventKey: `CERTIFICATE:${certificate.id}`, kind: 'CERTIFICATE', titleAr: 'شهادة جديدة من مدرستك', titleEn: 'A new certificate from your school', body: title.trim(), href: '/certificates' } });
      const subscriptions = await tx.pushSubscription.findMany({ where: { userId: recipient.id }, select: { id: true } });
      if (subscriptions.length) await tx.pushDelivery.createMany({ data: subscriptions.map(sub => ({ notificationId: notification.id, subscriptionId: sub.id })) });
      results.push({ certificate, duplicate: false });
      }
      return results;
    });
    const created = result.filter(item => !item.duplicate).length;
    if (bulk) return res.status(created ? 201 : 200).json({ created, duplicates: result.length - created, total: result.length });
    res.status(created ? 201 : 200).json({ ...result[0].certificate, duplicate: result[0].duplicate });
  } catch (error) {
    if (error instanceof Error && error.message === 'AUDIENCE_CHANGED') return res.status(409).json({ error: 'Some students no longer belong to the selected school and grade. Refresh the roster.' });
    if ((error as any)?.code === 'P2034') return res.status(409).json({ error: 'Another certificate request is being saved. Retry this request.' });
    res.status(500).json({ error: 'Certificate could not be saved' });
  }
});
router.get('/api/certificates/:id/file', verifyToken, async (req: any, res: any) => {
  const scope = certificateScope(req.user);
  if (!scope) return res.sendStatus(403);
  try {
    const file = await prisma.certificate.findFirst({ where: { ...scope, id: req.params.id, revokedAt: null }, select: { fileData: true, mimeType: true, fileName: true, byteSize: true, sha256: true } });
    if (!file) return res.sendStatus(404);
    const bytes = readCertificateBytes(file);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.byteSize);
    res.setHeader('Content-Disposition', `attachment; filename="certificate.${file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType === 'image/webp' ? 'webp' : 'png'}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(bytes);
  } catch { res.status(500).json({ error: 'Could not download certificate' }); }
});
router.delete('/api/certificates/:id', verifyToken, issuer, limiter, async (req: any, res: any) => {
  const scope = certificateScope(req.user);
  if (!scope) return res.sendStatus(403);
  try {
    const changed = await prisma.certificate.updateMany({ where: { ...scope, id: req.params.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!changed.count) return res.sendStatus(404);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Could not revoke certificate' }); }
});
export default router;
