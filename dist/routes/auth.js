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
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const router = (0, express_1.Router)();
// --- Extracted from lines 1026-1167 ---
router.get('/api/auth/schools', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const schools = yield prisma_1.default.school.findMany({
            where: { status: 'ACTIVE' },
            select: { id: true, name: true }
        });
        res.json(schools);
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching schools' });
    }
}));
router.post('/api/auth/register', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, username, password, role, schoolId, grade, specialization, phone } = req.body;
        const missing = (0, shared_1.hasRequiredFields)(req.body, ['name', 'username', 'password', 'role']);
        if (missing) {
            return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
        }
        if (role !== 'TEACHER' && role !== 'STUDENT') {
            return res.status(400).json({ error: 'Invalid role. Only TEACHER or STUDENT roles can self-register.' });
        }
        // Check if username already exists
        const existingUser = yield prisma_1.default.user.findUnique({ where: { username } });
        if (existingUser) {
            return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً.' });
        }
        const hashedPassword = yield bcryptjs_1.default.hash(password, 10);
        const user = yield prisma_1.default.user.create({
            data: {
                name,
                username,
                password: hashedPassword,
                role,
                schoolId: schoolId || null,
                grade: grade || null,
                specialization: specialization || null,
                phone: phone || null,
                status: 'ACTIVE'
            },
            select: shared_1.userSafeSelect
        });
        res.json({ message: 'Registration successful', user });
    }
    catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Error registering user' });
    }
}));
router.post('/api/auth/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const existingAttempt = shared_1.loginAttempts.get(ip);
        if (existingAttempt) {
            if (now - existingAttempt.firstAttemptAt > shared_1.LOGIN_WINDOW_MS) {
                shared_1.loginAttempts.delete(ip);
            }
            else if (existingAttempt.count >= shared_1.LOGIN_MAX_ATTEMPTS) {
                return res.status(429).json({ error: 'محاولات دخول كثيرة جداً. يرجى الانتظار والمحاولة لاحقاً.' });
            }
        }
        const { username, password } = req.body;
        const missing = (0, shared_1.hasRequiredFields)(req.body, ['username', 'password']);
        if (missing) {
            return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
        }
        const user = yield prisma_1.default.user.findUnique({ where: { username } });
        if (!user || user.deletedAt) {
            const attempt = shared_1.loginAttempts.get(ip);
            if (!attempt || now - attempt.firstAttemptAt > shared_1.LOGIN_WINDOW_MS) {
                shared_1.loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
            }
            else {
                attempt.count += 1;
                shared_1.loginAttempts.set(ip, attempt);
            }
            return res.status(400).json({ error: 'Invalid username or password.' });
        }
        const validPassword = yield bcryptjs_1.default.compare(password, user.password);
        if (!validPassword) {
            const attempt = shared_1.loginAttempts.get(ip);
            if (!attempt || now - attempt.firstAttemptAt > shared_1.LOGIN_WINDOW_MS) {
                shared_1.loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
            }
            else {
                attempt.count += 1;
                shared_1.loginAttempts.set(ip, attempt);
            }
            return res.status(400).json({ error: 'Invalid username or password.' });
        }
        shared_1.loginAttempts.delete(ip);
        // Generate token payload: user_id, role, school_id, grade
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role, schoolId: user.schoolId, grade: user.grade }, shared_1.JWT_SECRET, { expiresIn: shared_1.JWT_EXPIRES_IN });
        let schoolName = null;
        if (user.schoolId) {
            const school = yield prisma_1.default.school.findUnique({ where: { id: user.schoolId } });
            schoolName = school === null || school === void 0 ? void 0 : school.name;
        }
        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                schoolId: user.schoolId,
                schoolName: schoolName,
                avatar: user.avatar,
                grade: user.grade,
                status: user.status
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error.', details: error.message });
    }
}));
// ==========================================
// 🔄 TOKEN REFRESH ENDPOINT
// ==========================================
router.post('/api/auth/refresh-token', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        if (!userId)
            return res.status(401).json({ error: 'Invalid token payload.' });
        const user = yield prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, schoolId: true, grade: true, status: true, name: true, avatar: true }
        });
        if (!user || user.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Account inactive or not found.' });
        }
        const newToken = jsonwebtoken_1.default.sign({ id: user.id, role: user.role, schoolId: user.schoolId, grade: user.grade }, shared_1.JWT_SECRET, { expiresIn: shared_1.JWT_EXPIRES_IN });
        const expiresAt = Date.now() + (8 * 60 * 60 * 1000); // 8 hours from now
        res.json({
            token: newToken,
            expiresAt,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                schoolId: user.schoolId,
                grade: user.grade,
                avatar: user.avatar
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to refresh token.', details: error.message });
    }
}));
// ==========================================
// 🌍 SUPER ADMIN ROUTES
// ==========================================
// Manage Schools
exports.default = router;
// Trigger restart
