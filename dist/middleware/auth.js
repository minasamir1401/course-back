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
exports.checkSchoolAccess = exports.checkRole = exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const JWT_SECRET = process.env.JWT_SECRET;
const INSECURE_JWT_SECRETS = new Set([
    'lms_super_secret_key_2026',
    'default_secret_key',
    'change-me',
    'secret',
]);
if (!JWT_SECRET || JWT_SECRET.length < 32 || INSECURE_JWT_SECRETS.has(JWT_SECRET)) {
    throw new Error('JWT_SECRET must be a unique random value of at least 32 characters');
}
// Bounded local cache for active user status checks to avoid database query bottlenecks
const userStatusCache = new Map();
const STATUS_CACHE_TTL = 30 * 1000; // 30 seconds cache TTL
const checkUserActiveStatus = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    if (userId === 'SYSTEM')
        return true;
    const now = Date.now();
    const cached = userStatusCache.get(userId);
    if (cached && (now - cached.timestamp < STATUS_CACHE_TTL)) {
        return cached.isActive;
    }
    // Bounded size eviction to prevent memory leak
    if (userStatusCache.size >= 2000) {
        const firstKey = userStatusCache.keys().next().value;
        if (firstKey !== undefined) {
            userStatusCache.delete(firstKey);
        }
    }
    const user = yield prisma_1.default.user.findUnique({
        where: { id: userId },
        select: { status: true }
    });
    const isActive = !!(user && user.status === 'ACTIVE');
    userStatusCache.set(userId, { isActive, timestamp: now });
    return isActive;
});
const verifyToken = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    let token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
    // Support query parameter token (needed for direct downloads like backups via window.open)
    if (!token && req.query.token) {
        token = req.query.token;
    }
    if (!token)
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const isActive = yield checkUserActiveStatus(decoded.id);
        if (!isActive) {
            return res.status(403).json({ error: 'Access denied. Account is inactive, suspended, or does not exist.' });
        }
        req.user = decoded;
        next();
    }
    catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.', code: 'TOKEN_EXPIRED' });
        }
        res.status(400).json({ error: 'Invalid token.' });
    }
});
exports.verifyToken = verifyToken;
const checkRole = (roles) => {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized. Please login again.' });
        }
        if (!roles.includes(user.role)) {
            console.log(`🚫 Access Denied. User role: ${user.role}, Required: ${roles}, Path: ${req.path}`);
            return res.status(403).json({
                error: `Forbidden. Role '${user.role}' is not authorized for this action.`,
                yourRole: user.role,
                requiredRoles: roles
            });
        }
        next();
    };
};
exports.checkRole = checkRole;
const checkSchoolAccess = (req, res, next) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ error: 'Unauthorized' });
    if (user.role === 'SUPER_ADMIN') {
        return next();
    }
    const targetSchoolId = req.params.schoolId || req.body.schoolId || req.query.schoolId;
    if (targetSchoolId && targetSchoolId !== user.schoolId) {
        return res.status(403).json({ error: 'Forbidden. Data belongs to another school.' });
    }
    // Force isolation if schoolId is missing but required by context
    if (!targetSchoolId && user.schoolId) {
        if (req.method === 'GET')
            req.query.schoolId = user.schoolId;
        else if (['POST', 'PUT', 'PATCH'].includes(req.method))
            req.body.schoolId = user.schoolId;
    }
    next();
};
exports.checkSchoolAccess = checkSchoolAccess;
