'use strict';

require('ts-node/register/transpile-only');

const {
  cacheSet,
  cacheGet,
  cacheSetJSON,
  cacheGetJSON,
  cacheDelete,
  checkRateLimit,
  resetRateLimit,
} = require('../../../src/lib/redis');

describe('Unified Cache & Multi-Worker State Resilience', () => {
  const testKey = `test:key:${Date.now()}`;

  afterEach(async () => {
    await cacheDelete(testKey);
  });

  test('correctly writes and reads string values from cache store', async () => {
    await cacheSet(testKey, 'hello-world', 60);
    const value = await cacheGet(testKey);
    expect(value).toBe('hello-world');
  });

  test('correctly serializes and deserializes JSON payloads', async () => {
    const payload = { userId: '123', role: 'TEACHER', permissions: ['EXAM_READ', 'EXAM_WRITE'] };
    await cacheSetJSON(testKey, payload, 60);

    const retrieved = await cacheGetJSON(testKey);
    expect(retrieved).toEqual(payload);
  });

  test('deleting a key returns null on subsequent retrieval', async () => {
    await cacheSet(testKey, 'to-be-deleted', 60);
    await cacheDelete(testKey);

    const value = await cacheGet(testKey);
    expect(value).toBeNull();
  });

  test('enforces rate limits and flags exceeded attempts', async () => {
    const rateLimitKey = `ratelimit:test:${Date.now()}`;
    const maxAttempts = 3;
    const windowSecs = 10;

    const first = await checkRateLimit(rateLimitKey, maxAttempts, windowSecs);
    expect(first.count).toBe(1);
    expect(first.allowed).toBe(true);

    const second = await checkRateLimit(rateLimitKey, maxAttempts, windowSecs);
    expect(second.count).toBe(2);
    expect(second.allowed).toBe(true);

    const third = await checkRateLimit(rateLimitKey, maxAttempts, windowSecs);
    expect(third.count).toBe(3);
    expect(third.allowed).toBe(true);

    // 4th attempt exceeds maxAttempts of 3
    const fourth = await checkRateLimit(rateLimitKey, maxAttempts, windowSecs);
    expect(fourth.count).toBe(4);
    expect(fourth.allowed).toBe(false);

    // Reset rate limit
    await resetRateLimit(rateLimitKey);
    const afterReset = await checkRateLimit(rateLimitKey, maxAttempts, windowSecs);
    expect(afterReset.count).toBe(1);
    expect(afterReset.allowed).toBe(true);

    await resetRateLimit(rateLimitKey);
  });
});
