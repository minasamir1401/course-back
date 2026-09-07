process.env.JWT_SECRET = 'auth-security-regression-secret-64-characters-for-tests-only-12345';

jest.mock('../../../src/lib/prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn(), create: jest.fn() }, school: { findUnique: jest.fn() } },
}));
jest.mock('../../../src/lib/redis', () => ({
  isRedisActive: jest.fn().mockReturnValue(false),
  cacheGetJSON: jest.fn().mockResolvedValue(null),
  cacheSetJSON: jest.fn().mockResolvedValue(undefined),
  resetRateLimit: jest.fn().mockResolvedValue(undefined),
  checkRateLimit: jest.fn().mockResolvedValue({ isLimited: false }),
}));

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../../../src/lib/prisma').default;
const router = require('../../../src/routes/auth').default;
const { verifyToken, checkRole, checkSchoolAccess } = require('../../../src/middleware/auth');

function response() {
  return {
    statusCode: 200, body: undefined, headers: {}, cookies: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    cookie(name, value) { this.cookies[name] = value; return this; },
  };
}
function user(overrides = {}) {
  return { id: 'user-1', name: 'Test User', username: 'test-user', role: 'TEACHER',
    schoolId: 'school-current', grade: 'current-grade', password: bcrypt.hashSync('correct-password', 4),
    status: 'ACTIVE', deletedAt: null, avatar: null, ...overrides };
}
function token(payload = {}) {
  return jwt.sign({ id: 'user-1', role: 'TEACHER', schoolId: 'school-old', grade: 'old-grade', ...payload }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
function request(overrides = {}) {
  return { headers: {}, cookies: {}, body: {}, query: {}, params: {}, method: 'GET', path: '/', ip: '127.0.0.1', socket: {}, ...overrides };
}
async function route(method, path, req) {
  const res = response();
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer) return res.status(404).json({ error: 'Not found' });
  for (const handler of layer.route.stack) {
    let continued = false;
    await handler.handle(req, res, () => { continued = true; });
    if (!continued) break;
  }
  return res;
}
async function authenticate(overrides = {}) {
  const req = request({ headers: { authorization: `Bearer ${token()}` }, ...overrides });
  const res = response();
  const next = jest.fn();
  await verifyToken(req, res, next);
  return { req, res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockReset().mockResolvedValue(user());
  prisma.user.create.mockReset().mockImplementation(async ({ data, select }) => {
    const created = { id: 'created-user', ...data };
    return Object.fromEntries(Object.keys(select).filter((key) => select[key] && key in created).map((key) => [key, created[key]]));
  });
  prisma.school.findUnique.mockResolvedValue({ name: 'Test School' });
});

describe('public registration authorization', () => {
  test.each(['school-target', null])('blocks self-created active teachers for school %s before persisting a user', async (schoolId) => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await route('post', '/api/auth/register', request({ body: {
      name: 'External Teacher', username: 'external', password: 'a-password', role: 'TEACHER', schoolId,
    } }));
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/المعلم|المعلّم/);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('preserves student signup without accepting privilege fields or returning a password', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await route('post', '/api/auth/register', request({ body: {
      name: 'Student', username: 'student', password: 'a-password', role: 'STUDENT', schoolId: 'school-target',
      status: 'SUPER_ADMIN', isImpersonated: true,
    } }));
    expect(res.statusCode).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'STUDENT', status: 'ACTIVE', schoolId: 'school-target' });
    expect(res.body.user.password).toBeUndefined();
    const persisted = prisma.user.create.mock.calls[0][0].data;
    expect(persisted.isImpersonated).toBeUndefined();
    expect(await bcrypt.compare('a-password', persisted.password)).toBe(true);
  });

  test.each(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PARENT'])('rejects public %s signup', async (role) => {
    const res = await route('post', '/api/auth/register', request({ body: { name: 'User', username: 'user', password: 'password', role } }));
    expect(res.statusCode).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('existing administrator-created teachers can still log in', async () => {
    const res = await route('post', '/api/auth/login', request({ body: { username: 'test-user', password: 'correct-password' } }));
    expect(res.statusCode).toBe(200);
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ id: 'user-1', role: 'TEACHER' });
  });
});

describe('current database authorization context', () => {
  test('enforces demotion instead of a stale signed administrator role', async () => {
    prisma.user.findUnique.mockResolvedValue(user({ role: 'STUDENT' }));
    const { req, res, next } = await authenticate({ headers: { authorization: `Bearer ${token({ role: 'SUPER_ADMIN' })}` } });
    expect(next).toHaveBeenCalledTimes(1);
    const authorized = jest.fn();
    checkRole(['SUPER_ADMIN'])(req, res, authorized);
    expect(res.statusCode).toBe(403);
    expect(authorized).not.toHaveBeenCalled();
  });

  test('school transfer immediately changes authorization and current grade', async () => {
    const { req, res, next } = await authenticate({ params: { schoolId: 'school-old' } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ schoolId: 'school-current', grade: 'current-grade' });
    const authorized = jest.fn();
    checkSchoolAccess(req, res, authorized);
    expect(res.statusCode).toBe(403);
    expect(authorized).not.toHaveBeenCalled();
  });

  test.each([
    ['deleted', { deletedAt: new Date('2026-01-01') }],
    ['inactive', { status: 'INACTIVE' }],
    ['suspended', { status: 'SUSPENDED' }],
  ])('rejects a newly %s user immediately after a valid request', async (_label, changes) => {
    expect((await authenticate()).next).toHaveBeenCalledTimes(1);
    prisma.user.findUnique.mockResolvedValue(user(changes));
    const { res, next } = await authenticate();
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects missing accounts', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const { res, next } = await authenticate();
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('does not authorize if the database is unavailable', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('database unavailable'));
    const { res, next } = await authenticate();
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a signed payload without a valid user identifier', async () => {
    const { res, next } = await authenticate({ headers: { authorization: `Bearer ${token({ id: null })}` } });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('preserves signed impersonation metadata while refreshing target permissions', async () => {
    const { req, next } = await authenticate({ headers: { authorization: `Bearer ${token({ isImpersonated: true, adminId: 'admin-1' })}` } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ isImpersonated: true, adminId: 'admin-1', schoolId: 'school-current' });
  });

  test('preserves the signed internal SYSTEM backup identity', async () => {
    const { req, next } = await authenticate({ headers: { authorization: `Bearer ${token({ id: 'SYSTEM', role: 'SUPER_ADMIN' })}` } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 'SYSTEM', role: 'SUPER_ADMIN' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('verified session for offline replay', () => {
  test('returns only current identity and forbids caching', async () => {
    const res = await route('get', '/api/auth/session', request({ headers: { authorization: `Bearer ${token()}` } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ user: { id: 'user-1', role: 'TEACHER', schoolId: 'school-current' } });
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('requires a valid session', async () => {
    const res = await route('get', '/api/auth/session', request());
    expect(res.statusCode).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('explicit bearer identity takes precedence over a different cookie account', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) => user({ id: where.id }));
    const res = await route('get', '/api/auth/session', request({
      headers: { authorization: `Bearer ${token({ id: 'bearer-user' })}` },
      cookies: { auth_token: token({ id: 'cookie-user' }) },
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body.user.id).toBe('bearer-user');
  });

  test('cookie_auth marker resolves the actual cookie identity', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) => user({ id: where.id }));
    const res = await route('get', '/api/auth/session', request({
      headers: { authorization: 'Bearer cookie_auth' }, cookies: { auth_token: token({ id: 'cookie-user' }) },
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body.user.id).toBe('cookie-user');
  });
});

describe('offline owner check on the authenticated write', () => {
  test('blocks a cookie switched after a successful preflight before the mutation runs', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) => user({ id: where.id }));
    const preflight = await route('get', '/api/auth/session', request({ cookies: { auth_token: token({ id: 'owner-1' }) } }));
    expect(preflight.body.user.id).toBe('owner-1');
    const { res, next } = await authenticate({ method: 'POST', headers: {
      'x-offline-user-id': preflight.body.user.id,
      'x-offline-school-id': preflight.body.user.schoolId,
    }, cookies: { auth_token: token({ id: 'owner-2' }) } });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('OFFLINE_SESSION_CHANGED');
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ['stale school', { 'x-offline-user-id': 'user-1', 'x-offline-school-id': 'school-old' }],
    ['missing school header', { 'x-offline-user-id': 'user-1' }],
    ['missing user header', { 'x-offline-school-id': 'school-current' }],
    ['empty user header', { 'x-offline-user-id': '', 'x-offline-school-id': 'school-current' }],
    ['array user header', { 'x-offline-user-id': ['user-1'], 'x-offline-school-id': 'school-current' }],
    ['array school header', { 'x-offline-user-id': 'user-1', 'x-offline-school-id': ['school-current'] }],
    ['null school header', { 'x-offline-user-id': 'user-1', 'x-offline-school-id': null }],
  ])('rejects %s before the write handler', async (_label, ownerHeaders) => {
    const { res, next } = await authenticate({ method: 'PUT', headers: {
      authorization: `Bearer ${token()}`, ...ownerHeaders,
    } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'OFFLINE_SESSION_CHANGED', error: expect.any(String) });
    expect(next).not.toHaveBeenCalled();
  });

  test('allows matching owner and school with explicit bearer precedence over another cookie', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }) => user({ id: where.id }));
    const { req, next } = await authenticate({ method: 'POST', headers: {
      authorization: `Bearer ${token()}`, 'x-offline-user-id': 'user-1', 'x-offline-school-id': 'school-current',
    }, cookies: { auth_token: token({ id: 'another-user' }) } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe('user-1');
  });

  test('normalizes a schoolless account to an explicitly empty school header', async () => {
    prisma.user.findUnique.mockResolvedValue(user({ schoolId: null }));
    const { next } = await authenticate({ method: 'PATCH', headers: {
      authorization: `Bearer ${token()}`, 'x-offline-user-id': 'user-1', 'x-offline-school-id': '',
    } });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('cannot bypass owner validation with the internal SYSTEM identity', async () => {
    const { res, next } = await authenticate({ method: 'POST', headers: {
      authorization: `Bearer ${token({ id: 'SYSTEM', role: 'SUPER_ADMIN' })}`,
      'x-offline-user-id': 'user-1', 'x-offline-school-id': '',
    } });
    expect(res.statusCode).toBe(409);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('password verification in development', () => {
  const previousEnvironment = process.env.NODE_ENV;
  beforeEach(() => { process.env.NODE_ENV = 'development'; });
  afterEach(() => {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  });

  test.each(['admin123', 'admin', '123456', 'super-admin-password-123', 'seed-user-password-123'])(
    'rejects former master password %s when it does not match the account hash', async (password) => {
      const res = await route('post', '/api/auth/login', request({ body: { username: 'test-user', password } }));
      expect(res.statusCode).toBe(400);
      expect(res.body.token).toBeUndefined();
      expect(res.cookies.auth_token).toBeUndefined();
    },
  );

  test('still accepts the actual password in development', async () => {
    const res = await route('post', '/api/auth/login', request({ body: { username: 'test-user', password: 'correct-password' } }));
    expect(res.statusCode).toBe(200);
    expect(jwt.verify(res.body.token, process.env.JWT_SECRET).id).toBe('user-1');
  });
});
