import { Response } from 'express';
import jwt from 'jsonwebtoken';

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
});

export function setSessionCookies(res: Response, token: string, secret: string): number {
  const payload = jwt.decode(token) as jwt.JwtPayload;
  const expiresAt = payload.exp! * 1000;
  res.cookie('auth_token', token, {
    ...sessionCookieOptions(), maxAge: Math.max(0, expiresAt - Date.now()),
  });
  // Separate, signed refresh credential: never accepted for regular API requests.
  const refreshToken = jwt.sign({
    id: payload.id, purpose: 'session_refresh',
    ...(payload.isImpersonated ? { isImpersonated: true, adminId: payload.adminId } : {}),
  }, secret, { expiresIn: SESSION_MAX_AGE_MS / 1000 });
  res.cookie('auth_refresh', refreshToken, {
    ...sessionCookieOptions(), maxAge: SESSION_MAX_AGE_MS,
  });
  return expiresAt;
}
