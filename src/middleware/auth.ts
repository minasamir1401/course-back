import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

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
const userStatusCache = new Map<string, { isActive: boolean, timestamp: number }>();
const STATUS_CACHE_TTL = 30 * 1000; // 30 seconds cache TTL

const checkUserActiveStatus = async (userId: string): Promise<boolean> => {
  if (userId === 'SYSTEM') return true;

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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true }
  });

  const isActive = !!(user && user.status === 'ACTIVE');
  userStatusCache.set(userId, { isActive, timestamp: now });
  return isActive;
};

export const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  // Priority 1: httpOnly cookie (most secure — not accessible to JavaScript)
  let token = req.cookies?.auth_token;

  // Priority 2: Authorization header (backward-compatible — legacy clients / mobile)
  if (!token) {
    token = req.headers.authorization?.split(' ')[1];
  }

  // Priority 3: Query parameter (needed for direct downloads like backups via window.open)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const isActive = await checkUserActiveStatus(decoded.id);
    if (!isActive) {
      return res.status(403).json({ error: 'Access denied. Account is inactive, suspended, or does not exist.' });
    }

    (req as any).user = decoded;
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.', code: 'TOKEN_EXPIRED' });
    }
    res.status(400).json({ error: 'Invalid token.' });
  }
};

export const checkRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
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

export const checkSchoolAccess = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (user.role === 'SUPER_ADMIN') {
    return next();
  }
  
  const targetSchoolId = req.params.schoolId || req.body.schoolId || req.query.schoolId;
  
  if (targetSchoolId && targetSchoolId !== user.schoolId) {
    return res.status(403).json({ error: 'Forbidden. Data belongs to another school.' });
  }

  // Force isolation if schoolId is missing but required by context
  if (!targetSchoolId && user.schoolId) {
    if (req.method === 'GET') req.query.schoolId = user.schoolId;
    else if (['POST', 'PUT', 'PATCH'].includes(req.method)) req.body.schoolId = user.schoolId;
  }
  
  next();
};
