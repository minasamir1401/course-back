import Redis from 'ioredis';

/**
 * Unified Cache & Multi-Worker State Manager (Redis + Resilient Local Fallback)
 *
 * Solves the PM2 Cluster-Mode limitation where in-memory Maps are isolated
 * per-worker process. When REDIS_URL is configured, all workers share the
 * exact same rate limits, active user status, and statistics cache.
 *
 * If REDIS_URL is absent or Redis is unreachable, it automatically and silently
 * falls back to an in-memory bounded LRU cache so development and tests
 * run smoothly without requiring a live Redis server.
 */

const REDIS_URL = process.env.REDIS_URL;

// Bounded local fallback cache
interface LocalCacheEntry {
  value: string;
  expiresAt: number | null;
}
const localMemoryStore = new Map<string, LocalCacheEntry>();
const MAX_LOCAL_ENTRIES = 5000;

function cleanupExpiredLocalEntries() {
  const now = Date.now();
  for (const [key, entry] of localMemoryStore.entries()) {
    if (entry.expiresAt && now > entry.expiresAt) {
      localMemoryStore.delete(key);
    }
  }
}

// Periodic cleanup of local store every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredLocalEntries, 5 * 60 * 1000).unref();
}

let redisClient: Redis | null = null;
let isRedisConnected = false;

if (REDIS_URL) {
  try {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy(times) {
        // Exponential backoff capped at 30s
        return Math.min(times * 1000, 30000);
      }
    });

    redisClient.on('connect', () => {
      isRedisConnected = true;
      console.log('✅ [Redis] Connected successfully to shared cache store.');
    });

    redisClient.on('ready', () => {
      isRedisConnected = true;
    });

    redisClient.on('error', (err) => {
      if (isRedisConnected) {
        console.warn('⚠️ [Redis] Connection lost. Falling back to in-memory store:', err.message);
      }
      isRedisConnected = false;
    });

    redisClient.on('close', () => {
      isRedisConnected = false;
    });
  } catch (error: any) {
    console.warn('⚠️ [Redis] Failed to initialize client, using in-memory store:', error.message);
    redisClient = null;
    isRedisConnected = false;
  }
} else {
  // Graceful notification in development / standalone
  // In production with PM2, REDIS_URL is strongly recommended
  if (process.env.NODE_ENV === 'production' && process.env.NODE_APP_INSTANCE === '0') {
    console.warn('⚠️ [Cluster Notice] REDIS_URL not set in production. PM2 workers are using local memory stores.');
  }
}

export const isRedisActive = (): boolean => isRedisConnected && redisClient !== null;

/**
 * Get string value from Redis or local memory store
 */
export async function cacheGet(key: string): Promise<string | null> {
  if (isRedisConnected && redisClient) {
    try {
      return await redisClient.get(key);
    } catch {
      // Fall through to memory store on redis read failure
    }
  }

  const local = localMemoryStore.get(key);
  if (!local) return null;
  if (local.expiresAt && Date.now() > local.expiresAt) {
    localMemoryStore.delete(key);
    return null;
  }
  return local.value;
}

/**
 * Set string value with optional TTL (in seconds)
 */
export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  // Update local memory store
  if (localMemoryStore.size >= MAX_LOCAL_ENTRIES && !localMemoryStore.has(key)) {
    const firstKey = localMemoryStore.keys().next().value;
    if (firstKey !== undefined) localMemoryStore.delete(firstKey);
  }

  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  localMemoryStore.set(key, { value, expiresAt });

  if (isRedisConnected && redisClient) {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await redisClient.set(key, value, 'EX', ttlSeconds);
      } else {
        await redisClient.set(key, value);
      }
    } catch (err: any) {
      console.warn(`⚠️ [Redis] cacheSet error for key "${key}":`, err.message);
    }
  }
}

/**
 * Delete key from Redis and local memory store
 */
export async function cacheDelete(key: string): Promise<void> {
  localMemoryStore.delete(key);

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(key);
    } catch (err: any) {
      console.warn(`⚠️ [Redis] cacheDelete error for key "${key}":`, err.message);
    }
  }
}

/**
 * Helper to store JSON-serializable objects
 */
export async function cacheGetJSON<T = any>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Helper to set JSON-serializable objects
 */
export async function cacheSetJSON<T = any>(key: string, data: T, ttlSeconds?: number): Promise<void> {
  await cacheSet(key, JSON.stringify(data), ttlSeconds);
}

/**
 * Rate Limiting helper: increment count and enforce TTL window
 * Returns { count, allowed }
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<{ count: number; allowed: boolean }> {
  if (isRedisConnected && redisClient) {
    try {
      const current = await redisClient.incr(key);
      if (current === 1) {
        await redisClient.expire(key, windowSeconds);
      }
      return {
        count: current,
        allowed: current <= maxAttempts
      };
    } catch {
      // Fall through to memory on Redis error
    }
  }

  // Memory fallback rate limiter
  const now = Date.now();
  const entry = localMemoryStore.get(key);
  let count = 1;
  let expiresAt = now + windowSeconds * 1000;

  if (entry && (!entry.expiresAt || now < entry.expiresAt)) {
    count = (parseInt(entry.value, 10) || 0) + 1;
    expiresAt = entry.expiresAt || expiresAt;
  }

  localMemoryStore.set(key, { value: String(count), expiresAt });
  return {
    count,
    allowed: count <= maxAttempts
  };
}

/**
 * Reset rate limit counter
 */
export async function resetRateLimit(key: string): Promise<void> {
  await cacheDelete(key);
}

export default {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheGetJSON,
  cacheSetJSON,
  checkRateLimit,
  resetRateLimit,
  isRedisActive,
};
