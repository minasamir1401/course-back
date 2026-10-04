"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionCookieOptions = exports.SESSION_MAX_AGE_MS = void 0;
exports.setSessionCookies = setSessionCookies;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
exports.SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const sessionCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
    path: '/',
});
exports.sessionCookieOptions = sessionCookieOptions;
function setSessionCookies(res, token, secret) {
    const payload = jsonwebtoken_1.default.decode(token);
    const expiresAt = payload.exp * 1000;
    res.cookie('auth_token', token, Object.assign(Object.assign({}, (0, exports.sessionCookieOptions)()), { maxAge: Math.max(0, expiresAt - Date.now()) }));
    // Separate, signed refresh credential: never accepted for regular API requests.
    const refreshToken = jsonwebtoken_1.default.sign(Object.assign({ id: payload.id, purpose: 'session_refresh' }, (payload.isImpersonated ? { isImpersonated: true, adminId: payload.adminId } : {})), secret, { expiresIn: exports.SESSION_MAX_AGE_MS / 1000 });
    res.cookie('auth_refresh', refreshToken, Object.assign(Object.assign({}, (0, exports.sessionCookieOptions)()), { maxAge: exports.SESSION_MAX_AGE_MS }));
    return expiresAt;
}
