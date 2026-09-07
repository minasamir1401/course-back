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

export const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  // An explicit session belongs to the current app/account. A leftover cookie
  // from another role must not silently turn a student request into an admin request.
  const authorization = req.headers.authorization;
  if (authorization && !/^Bearer\s+\S+$/i.test(authorization)) {
    return res.status(401).json({ error: 'Invalid Authorization header.' });
  }
  const bearerToken = authorization?.replace(/^Bearer\s+/i, '');
  // Web login stores this marker, not a JWT. Only the actual httpOnly cookie
  // authenticates it; all other explicit tokens retain priority over cookies.
  let token = bearerToken && bearerToken !== 'cookie_auth' ? bearerToken : req.cookies?.auth_token;

  // Priority 3: Query parameter (needed for direct downloads like backups via window.open)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    if (!decoded || typeof decoded.id !== 'string' || !decoded.id) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    // The scheduler signs this short-lived internal identity; it has no User row.
    let currentUser = decoded;
    if (!(decoded.id === 'SYSTEM' && decoded.role === 'SUPER_ADMIN')) {
      // Authorization must reflect school transfers, demotions and account removal
      // immediately. A cached active flag cannot validate stale JWT permissions.
      let user;
      try {
        user = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: { id: true, role: true, schoolId: true, grade: true, status: true, deletedAt: true }
        });
      } catch {
        return res.status(503).json({ error: 'Unable to verify session. Please try again.' });
      }
      if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
        return res.status(403).json({ error: 'Access denied. Account is inactive, suspended, deleted, or does not exist.' });
      }

      currentUser = {
        ...decoded,
        id: user.id || decoded.id,
        role: user.role || decoded.role,
        schoolId: user.schoolId !== undefined ? user.schoolId : decoded.schoolId,
        grade: user.grade !== undefined ? user.grade : decoded.grade
      };
    }

    // Bind each replay to the identity authenticated for this request. A session
    // preflight alone cannot protect against a cookie switch before the write.
    const offlineUserId = req.headers['x-offline-user-id'];
    const offlineSchoolId = req.headers['x-offline-school-id'];
    if (offlineUserId !== undefined || offlineSchoolId !== undefined) {
      if (typeof offlineUserId !== 'string' || typeof offlineSchoolId !== 'string'
        || offlineUserId !== currentUser.id || offlineSchoolId !== (currentUser.schoolId ?? '')) {
        return res.status(409).json({
          code: 'OFFLINE_SESSION_CHANGED',
          error: 'تغيّرت الجلسة أو المدرسة. يرجى تسجيل الدخول بحساب صاحب التغييرات المحفوظة.'
        });
      }
    }

    (req as any).user = currentUser;
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
