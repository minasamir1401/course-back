"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRedisActive = void 0;
exports.cacheGet = cacheGet;
exports.cacheSet = cacheSet;
exports.cacheDelete = cacheDelete;
exports.cacheGetJSON = cacheGetJSON;
exports.cacheSetJSON = cacheSetJSON;
exports.checkRateLimit = checkRateLimit;
exports.resetRateLimit = resetRateLimit;
const ioredis_1 = __importDefault(require("ioredis"));
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
const localMemoryStore = new Map();
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
let redisClient = null;
let isRedisConnected = false;
if (REDIS_URL) {
    try {
        redisClient = new ioredis_1.default(REDIS_URL, {
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
    }
    catch (error) {
        console.warn('⚠️ [Redis] Failed to initialize client, using in-memory store:', error.message);
        redisClient = null;
        isRedisConnected = false;
    }
}
else {
    // Graceful notification in development / standalone
    // In production with PM2, REDIS_URL is strongly recommended
    if (process.env.NODE_ENV === 'production' && process.env.NODE_APP_INSTANCE === '0') {
        console.warn('⚠️ [Cluster Notice] REDIS_URL not set in production. PM2 workers are using local memory stores.');
    }
}
const isRedisActive = () => isRedisConnected && redisClient !== null;
exports.isRedisActive = isRedisActive;
/**
 * Get string value from Redis or local memory store
 */
function cacheGet(key) {
    return __awaiter(this, void 0, void 0, function* () {
        if (isRedisConnected && redisClient) {
            try {
                return yield redisClient.get(key);
            }
            catch (_a) {
                // Fall through to memory store on redis read failure
            }
        }
        const local = localMemoryStore.get(key);
        if (!local)
            return null;
        if (local.expiresAt && Date.now() > local.expiresAt) {
            localMemoryStore.delete(key);
            return null;
        }
        return local.value;
    });
}
/**
 * Set string value with optional TTL (in seconds)
 */
function cacheSet(key, value, ttlSeconds) {
    return __awaiter(this, void 0, void 0, function* () {
        // Update local memory store
        if (localMemoryStore.size >= MAX_LOCAL_ENTRIES && !localMemoryStore.has(key)) {
            const firstKey = localMemoryStore.keys().next().value;
            if (firstKey !== undefined)
                localMemoryStore.delete(firstKey);
        }
        const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
        localMemoryStore.set(key, { value, expiresAt });
        if (isRedisConnected && redisClient) {
            try {
                if (ttlSeconds && ttlSeconds > 0) {
                    yield redisClient.set(key, value, 'EX', ttlSeconds);
                }
                else {
                    yield redisClient.set(key, value);
                }
            }
            catch (err) {
                console.warn(`⚠️ [Redis] cacheSet error for key "${key}":`, err.message);
            }
        }
    });
}
/**
 * Delete key from Redis and local memory store
 */
function cacheDelete(key) {
    return __awaiter(this, void 0, void 0, function* () {
        localMemoryStore.delete(key);
        if (isRedisConnected && redisClient) {
            try {
                yield redisClient.del(key);
            }
            catch (err) {
                console.warn(`⚠️ [Redis] cacheDelete error for key "${key}":`, err.message);
            }
        }
    });
}
/**
 * Helper to store JSON-serializable objects
 */
function cacheGetJSON(key) {
    return __awaiter(this, void 0, void 0, function* () {
        const raw = yield cacheGet(key);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch (_a) {
            return null;
        }
    });
}
/**
 * Helper to set JSON-serializable objects
 */
function cacheSetJSON(key, data, ttlSeconds) {
    return __awaiter(this, void 0, void 0, function* () {
        yield cacheSet(key, JSON.stringify(data), ttlSeconds);
    });
}
/**
 * Rate Limiting helper: increment count and enforce TTL window
 * Returns { count, allowed }
 */
function checkRateLimit(key, maxAttempts, windowSeconds) {
    return __awaiter(this, void 0, void 0, function* () {
        if (isRedisConnected && redisClient) {
            try {
                const current = yield redisClient.incr(key);
                if (current === 1) {
                    yield redisClient.expire(key, windowSeconds);
                }
                return {
                    count: current,
                    allowed: current <= maxAttempts
                };
            }
            catch (_a) {
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
    });
}
/**
 * Reset rate limit counter
 */
function resetRateLimit(key) {
    return __awaiter(this, void 0, void 0, function* () {
        yield cacheDelete(key);
    });
}
exports.default = {
    cacheGet,
    cacheSet,
    cacheDelete,
    cacheGetJSON,
    cacheSetJSON,
    checkRateLimit,
    resetRateLimit,
    isRedisActive: exports.isRedisActive,
};
