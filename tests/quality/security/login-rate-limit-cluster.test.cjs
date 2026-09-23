process.env.JWT_SECRET = 'login-rate-limit-regression-secret-for-tests-only';
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';

jest.mock('../../../src/lib/prisma', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/lib/redis', () => ({
  cacheGetJSON: jest.fn(),
  cacheSetJSON: jest.fn(),
  cacheDelete: jest.fn(),
  isRedisActive: jest.fn(() => false),
  getSharedLoginAttempts: jest.fn(),
  recordSharedLoginFailure: jest.fn(),
  clearSharedLoginAttempts: jest.fn(),
}));

const redis = require('../../../src/lib/redis');
const {
  isLoginRateLimited,
  recordFailedLogin,
  clearLoginAttempts,
  loginAttempts,
} = require('../../../src/shared');

const original = {
  redisUrl: process.env.REDIS_URL,
  instance: process.env.NODE_APP_INSTANCE,
  singleWorker: process.env.LOGIN_RATE_LIMIT_SINGLE_WORKER,
};

afterAll(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  for (const [key, value] of Object.entries({
    REDIS_URL: original.redisUrl,
    NODE_APP_INSTANCE: original.instance,
    LOGIN_RATE_LIMIT_SINGLE_WORKER: original.singleWorker,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  loginAttempts.clear();
  jest.clearAllMocks();
  process.env.NODE_APP_INSTANCE = '0';
  delete process.env.LOGIN_RATE_LIMIT_SINGLE_WORKER;
});

test('cluster refuses login checks when Redis is configured but unavailable', async () => {
  process.env.REDIS_URL = 'redis://unavailable';
  redis.getSharedLoginAttempts.mockRejectedValue(new Error('Shared login rate limit is unavailable'));
  await expect(isLoginRateLimited('203.0.113.1')).rejects.toThrow('Shared login rate limit is unavailable');
  expect(loginAttempts.size).toBe(0);
});

test('shared store counts failures and clears successful login attempts', async () => {
  process.env.REDIS_URL = 'redis://available';
  redis.getSharedLoginAttempts.mockResolvedValue({ count: 10, remainingMs: 120000 });
  const result = await isLoginRateLimited('203.0.113.2');
  expect(result).toEqual({ isLimited: true, remainingMinutes: 2 });
  await recordFailedLogin('203.0.113.2');
  await clearLoginAttempts('203.0.113.2');
  expect(redis.recordSharedLoginFailure).toHaveBeenCalledWith('ratelimit:login:v2:203.0.113.2', 900000);
  expect(redis.clearSharedLoginAttempts).toHaveBeenCalledWith('ratelimit:login:v2:203.0.113.2');
});

test('multi-worker production without Redis refuses local counting', async () => {
  delete process.env.REDIS_URL;
  await expect(isLoginRateLimited('203.0.113.3')).rejects.toThrow('Shared login rate limit is unavailable');
});

test('explicit single-worker production keeps the local lockout', async () => {
  delete process.env.REDIS_URL;
  process.env.LOGIN_RATE_LIMIT_SINGLE_WORKER = '1';
  for (let i = 0; i < 10; i++) await recordFailedLogin('203.0.113.4');
  expect((await isLoginRateLimited('203.0.113.4')).isLimited).toBe(true);
});
