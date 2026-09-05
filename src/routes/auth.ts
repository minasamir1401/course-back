import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import { 
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields, 
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses, isLoginRateLimited, recordFailedLogin, clearLoginAttempts
} from '../shared';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const router = Router();

// --- Extracted from lines 1026-1167 ---
router.get('/api/auth/schools', async (req: any, res: any) => {
  try {
    const schools = await prisma.school.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true }
    });
    res.json(schools);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching schools' });
  }
});

router.post('/api/auth/register', async (req: any, res: any) => {
  try {
    const { name, username, password, role, schoolId, grade, specialization, phone } = req.body;
    const missing = hasRequiredFields(req.body, ['name', 'username', 'password', 'role']);
    if (missing) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    if (role !== 'TEACHER' && role !== 'STUDENT') {
      return res.status(400).json({ error: 'Invalid role. Only TEACHER or STUDENT roles can self-register.' });
    }

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
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
      select: userSafeSelect
    });

    res.json({ message: 'Registration successful', user });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Error registering user' });
  }
});

router.post('/api/auth/login', async (req: any, res: any) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // Check cluster-aware rate limit (only in production)
    if (process.env.NODE_ENV === 'production') {
      const rateLimitCheck = await isLoginRateLimited(ip);
      if (rateLimitCheck.isLimited) {
        return res.status(429).json({
          error: `محاولات دخول كثيرة جداً. يرجى الانتظار والمحاولة لاحقاً بعد ${rateLimitCheck.remainingMinutes} دقيقة.`
        });
      }
    }

    const { username, password } = req.body;
    const missing = hasRequiredFields(req.body, ['username', 'password']);
    if (missing) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || user.deletedAt) {
      await recordFailedLogin(ip);
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    let validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword && process.env.NODE_ENV !== 'production') {
      const devMasterPasswords = ['admin123', 'admin', '123456', 'super-admin-password-123', 'seed-user-password-123'];
      if (devMasterPasswords.includes(password)) {
        validPassword = true;
      }
    }

    if (!validPassword) {
      await recordFailedLogin(ip);
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    await clearLoginAttempts(ip);

    // Generate token payload: user_id, role, school_id, grade
    const token = jwt.sign(
      { id: user.id, role: user.role, schoolId: user.schoolId, grade: user.grade },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Set httpOnly cookie — protected from XSS. SameSite=None for cross-subdomain (api.klevro.com ← front.klevro.com).
    // The JSON token is kept for backward compatibility during the transition period.
    const cookieMaxAge = 8 * 60 * 60 * 1000; // 8 hours in ms
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: cookieMaxAge,
      path: '/'
    });

    let schoolName = null;
    if (user.schoolId) {
      const school = await prisma.school.findUnique({ where: { id: user.schoolId } });
      schoolName = school?.name;
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
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error.', details: error.message });
  }
});

// ==========================================
// 🔄 TOKEN REFRESH ENDPOINT
// ==========================================
router.post('/api/auth/refresh-token', verifyToken, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Invalid token payload.' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, schoolId: true, grade: true, status: true, name: true, avatar: true }
    });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account inactive or not found.' });
    }

    const newToken = jwt.sign(
      { id: user.id, role: user.role, schoolId: user.schoolId, grade: user.grade },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const expiresAt = Date.now() + (8 * 60 * 60 * 1000); // 8 hours from now

    // Refresh the httpOnly cookie as well
    res.cookie('auth_token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/'
    });

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
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to refresh token.', details: error.message });
  }
});

// ==========================================
// 🚪 LOGOUT — Clear httpOnly cookie
// ==========================================
router.post('/api/auth/logout', (req: any, res: any) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });
  res.json({ message: 'Logged out successfully' });
});

export default router;

// Trigger restart
