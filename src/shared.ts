import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import multer from 'multer';
import type { SignOptions } from 'jsonwebtoken';
import prisma from './lib/prisma';
import {
  cacheGetJSON,
  cacheSetJSON,
  cacheDelete,
  checkRateLimit,
  resetRateLimit,
  isRedisActive,
} from './lib/redis';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️ WARNING: JWT_SECRET environment variable is missing!');
}
export const JWT_SECRET = process.env.JWT_SECRET as string;
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '4h') as SignOptions['expiresIn'];

// ==========================================
// 📁 FILE UPLOAD CONFIGURATION (multer)
// ==========================================
export const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const ALLOWED_MIME_TYPES = new Set([
  // Images (raster only for XSS prevention)
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  // Documents & Data
  'application/pdf',
  'application/json',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/vnd.ms-powerpoint', // ppt
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  // Archives
  'application/zip', 'application/x-zip-compressed',
  // Video
  'video/mp4', 'video/webm', 'video/ogg'
]);

const multerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const mimeMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
      'application/pdf': '.pdf', 'application/json': '.json', 'text/csv': '.csv',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'application/vnd.ms-powerpoint': '.ppt',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.ms-excel': '.xls',
      'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
      'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogg'
    };
    const ext = mimeMap[file.mimetype] || path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, uniqueName);
  }
});

export const multerUpload = multer({
  storage: multerStorage,
  // 150 MB max limit prevents heap memory exhaustion (OOM) and protects VPS disk space
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  }
});

export const ALLOWED_VIDEO_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com'
]);

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;
export const loginAttempts = new Map<string, { count: number; firstAttemptAt: number }>();
const originalLoginAttemptsSet = loginAttempts.set.bind(loginAttempts);
loginAttempts.set = function(key, value) {
  if (loginAttempts.size >= 5000 && !loginAttempts.has(key)) {
    const firstKey = loginAttempts.keys().next().value;
    if (firstKey) loginAttempts.delete(firstKey);
  }
  return originalLoginAttemptsSet(key, value);
};

// ⚠️ CLUSTER-MODE LIMITATION:
// loginAttempts, statsCache (below), and userStatusCache (auth.ts) are in-process Maps.
// In PM2 cluster mode (pm2 -i max), each worker holds a SEPARATE copy of these Maps.
// This means:
//   - Rate limiting (loginAttempts) is per-worker, not per-IP — effective limit = MAX_ATTEMPTS × workers
//   - Stats cache (statsCache) may serve stale data across workers independently
//   - User status cache (auth.ts) may be inconsistent between workers
// TODO: Replace with a shared store (Redis/Valkey) to fix cross-worker state.
// See: https://redis.io/docs/latest/develop/clients/nodejs/

// Cleanup old login attempts every hour to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of loginAttempts.entries()) {
    if (now - val.firstAttemptAt > LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }
  
  // Enforce max size to prevent memory exhaustion / DDoS
  while (loginAttempts.size > 5000) {
    const firstKey = loginAttempts.keys().next().value;
    if (firstKey) loginAttempts.delete(firstKey);
  }
}, 60 * 60 * 1000).unref();

export const buildAllowedOrigins = (): string[] => {
  const fromEnv = process.env.ALLOWED_ORIGINS || '';
  return fromEnv
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const allowedOrigins = buildAllowedOrigins();

export const isOriginAllowed = (origin: string, allowedList: string[]): boolean => {
  if (allowedList.length === 0) return false;
  try {
    const cleanOrigin = origin.replace(/^https?:\/\//, '').replace(/\/$/, '').split(':')[0].toLowerCase();
    return allowedList.some(allowed => {
      const cleanAllowed = allowed.replace(/^https?:\/\//, '').replace(/\/$/, '').split(':')[0].toLowerCase();
      return cleanOrigin === cleanAllowed || origin.toLowerCase() === allowed.toLowerCase();
    });
  } catch {
    return false;
  }
};

const DATA_IMAGE_URI_REGEX = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;

const extensionFromImageMime = (mimeSubtype: string): string => {
  const normalized = mimeSubtype.toLowerCase();
  if (normalized === 'jpeg' || normalized === 'jpg') return 'jpg';
  // 🔒 SVG intentionally removed: SVG can contain arbitrary JS (XSS vector)
  if (normalized === 'png' || normalized === 'webp' || normalized === 'gif') return normalized;
  return 'bin'; // Unknown / unsafe types: save as binary (won't be served as image)
};

export const replaceEmbeddedDataImages = (input: string): string => {
  if (!input || typeof input !== 'string' || !input.includes('data:image/')) return input;

  const baseUrl = (process.env.BASE_URL || 'https://api.klevro.tech').replace(/\/+$/, '');

  return input.replace(DATA_IMAGE_URI_REGEX, (fullMatch, mimeSubtype, base64Data) => {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) return '';

      const ext = extensionFromImageMime(mimeSubtype);
      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      const filename = `embedded-${hash}.${ext}`;
      const destination = path.join(UPLOADS_DIR, filename);
      if (!fs.existsSync(destination)) {
        fs.writeFileSync(destination, buffer);
      }

      return `/uploads/${filename}`;
    } catch (err: any) {
      console.warn(`⚠️ Failed to externalize embedded image: ${err.message}`);
      return '';
    }
  });
};

export const externalizeEmbeddedDataImages = (value: any): any => {
  if (typeof value === 'string') {
    if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
      try {
        return JSON.stringify(externalizeEmbeddedDataImages(JSON.parse(value)));
      } catch {
        // Not JSON; continue as plain text/HTML.
      }
    }
    return replaceEmbeddedDataImages(value);
  }
  if (Array.isArray(value)) return value.map(externalizeEmbeddedDataImages);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = externalizeEmbeddedDataImages(nested);
    }
    return out;
  }
  return value;
};

export const sanitizeHtml = (input: any): string => {
  if (!input) return "";
  if (typeof input !== 'string') {
    if (typeof input === 'object') {
      try {
        return sanitizeHtml(JSON.stringify(input));
      } catch {
        return String(input);
      }
    }
    return String(input);
  }
  let sanitized = input;
  if (sanitized.includes('&lt;') || sanitized.includes('&gt;')) {
    sanitized = sanitized
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, '&');
  }
  sanitized = sanitized.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  sanitized = sanitized.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  sanitized = sanitized.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
  sanitized = sanitized.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/data:text\/html/gi, '');
  return replaceEmbeddedDataImages(sanitized);
};

export const sanitizeDeep = (value: any): any => {
  if (typeof value === 'string') {
    // If the string is a JSON array or object, parse it safely before sanitizing.
    // IMPORTANT: Return the parsed object/array directly (NOT re-stringified with JSON.stringify)
    // This preserves emoji (4-byte UTF-8) and special Unicode characters correctly,
    // since Prisma's Json type will handle serialization itself without corrupting them.
    if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
      try {
        const parsed = JSON.parse(value);
        return sanitizeDeep(parsed); // Return object/array — NOT JSON.stringify(...)
      } catch (e) {
        // Not valid JSON, fallback to sanitizeHtml
      }
    }
    return sanitizeHtml(value);
  }
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = sanitizeDeep(nested);
    }
    return out;
  }
  return value;
};

export const isSafeYoutubeUrl = (urlStr: string): boolean => {
  if (!urlStr) return false;
  try {
    let formatted = urlStr.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    const parsed = new URL(formatted);
    const host = parsed.hostname.toLowerCase();
    const allowed = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
    return allowed.includes(host);
  } catch {
    return false;
  }
};

export const isSafeVimeoUrl = (urlStr: string): boolean => {
  if (!urlStr) return false;
  try {
    let formatted = urlStr.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    const parsed = new URL(formatted);
    const host = parsed.hostname.toLowerCase();
    const allowed = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];
    return allowed.includes(host);
  } catch {
    return false;
  }
};

export const isAllowedVideoUrl = (rawUrl: string): boolean => {
  if (!rawUrl) return true;
  return isSafeYoutubeUrl(rawUrl) || isSafeVimeoUrl(rawUrl);
};

export function getYoutubeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    if (!isSafeYoutubeUrl(url)) return resolve(0);
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location;
        if (!isSafeYoutubeUrl(redirectUrl)) {
          return resolve(0);
        }
        return getYoutubeDuration(redirectUrl).then(resolve);
      }
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 5 * 1024 * 1024) { // 5MB limit
          res.destroy();
        }
      });
      res.on('end', () => {
        const match = data.match(/"lengthSeconds":"(\d+)"/);
        resolve(match ? parseInt(match[1]) : 0);
      });
    });

    req.setTimeout(2500, () => {
      req.destroy();
      resolve(0);
    });

    req.on('error', () => resolve(0));
  });
}

export function getVimeoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    if (!isSafeVimeoUrl(url)) return resolve(0);
    const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
    const req = https.get(oembedUrl, (res) => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 5 * 1024 * 1024) { // 5MB limit
          res.destroy();
        }
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.duration || 0);
        } catch {
          resolve(0);
        }
      });
    });

    req.setTimeout(2500, () => {
      req.destroy();
      resolve(0);
    });

    req.on('error', () => resolve(0));
  });
}

export function getVideoDuration(url: string): Promise<number> {
  if (!url) return Promise.resolve(0);
  if (url.includes('vimeo')) return getVimeoDuration(url);
  if (url.includes('youtube') || url.includes('youtu.be')) return getYoutubeDuration(url);
  return Promise.resolve(0);
}

export type DiagnosticLogLevel = 'info' | 'warn' | 'error';
export type DiagnosticLogEntry = {
  id: number;
  level: DiagnosticLogLevel;
  message: string;
  timestamp: string;
};

export const DIAGNOSTIC_LOG_LIMIT = 300;
export const diagnosticLogs: DiagnosticLogEntry[] = [];
let diagnosticLogId = 0;

export const serializeLogPart = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const pushDiagnosticLog = (level: DiagnosticLogLevel, parts: any[]) => {
  const message = parts.map(serializeLogPart).join(' ');
  diagnosticLogs.push({
    id: ++diagnosticLogId,
    level,
    message,
    timestamp: new Date().toISOString()
  });
  if (diagnosticLogs.length > DIAGNOSTIC_LOG_LIMIT) diagnosticLogs.shift();
};

export const SCHOOL_MANAGED_ROLES = ['STUDENT', 'TEACHER', 'PARENT'];
export const ALL_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'SUPERVISOR'];

export const userSafeSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  role: true,
  grade: true,
  schoolId: true,
  phone: true,
  status: true,
  avatar: true,
  gender: true,
  address: true,
  specialization: true,
  classroomId: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
  school: { select: { name: true, subdomain: true } },
  parent: { select: { id: true, name: true, phone: true } },
  classroom: { select: { id: true, name: true } }
};

export const sanitizeUser = (user: any) => {
  if (!user) return user;
  const { password, plainPassword, ...safeUser } = user;
  return safeUser;
};

export function extractAndSaveBase64Images(input: any): any {
  if (!input) return input;
  
  if (typeof input === 'string') {
    // 🔒 SECURITY: svg+xml intentionally excluded — SVG can contain arbitrary JS (XSS).
    const base64Regex = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/g;
    return input.replace(base64Regex, (_match: string, mimeType: string, base64Data: string) => {
      try {
        const ext = mimeType.replace('+', '').replace('xml', ''); // safe fallback (not used for SVG)
        const buffer = Buffer.from(base64Data, 'base64');
        const hash = crypto.createHash('md5').update(buffer).digest('hex');
        const filename = `img_${hash}.${mimeType}`;
        const filePath = path.join(UPLOADS_DIR, filename);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, buffer);
        }
        return `/uploads/${filename}`;
      } catch (err) {
        return _match;
      }
    });
  }

  if (typeof input === 'object') {
    try {
      const jsonStr = JSON.stringify(input);
      const updatedStr = extractAndSaveBase64Images(jsonStr);
      return JSON.parse(updatedStr);
    } catch {
      return input;
    }
  }

  return input;
}

export const sanitizeExam = (exam: any) => {
  if (!exam) return exam;
  const { password, ...safeExam } = exam;
  return safeExam;
};

export const hasRequiredFields = (body: any, fields: string[]) => {
  const missing = fields.filter(field => body[field] === undefined || body[field] === null || body[field] === '');
  return missing.length === 0 ? null : missing;
};

export const parseStringArray = (value: any): string[] => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
      } catch { }
    }
    if (trimmed.includes(',')) {
      return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [trimmed];
  }
  return [String(value).trim()].filter(Boolean);
};

export const arraysMatch = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const clean = (s: any) => String(s ?? '').trim().toLowerCase();
  const normalizedLeft = [...left].map(clean).sort();
  const normalizedRight = [...right].map(clean).sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

export const normalizeTrueFalse = (val: string): string => {
  const v = String(val ?? '').trim().toLowerCase();
  if (v === 'true' || v === 'صح' || v === 'صواب' || v === '1' || v === 'صحيح') return 'TRUE';
  if (v === 'false' || v === 'خطأ' || v === 'خطا' || v === 'غلط' || v === '0' || v === 'غير صحيح') return 'FALSE';
  return v.toUpperCase();
};

export const stripHtmlAndNormalize = (str: any) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\s\u00A0]+/g, ' ')
    .trim()
    .toLowerCase();
};

export const isOptionMatch = (targetVal: any, optText: string, optIndex: number = -1) => {
  if (targetVal === null || targetVal === undefined || optText === null || optText === undefined) return false;
  const rawTarget = String(targetVal).trim();
  const normTarget = stripHtmlAndNormalize(rawTarget);
  const normOpt = stripHtmlAndNormalize(optText);

  if (!normTarget || !normOpt) return false;

  // 1. Direct exact normalized string match
  if (normTarget === normOpt) return true;

  // 2. True / False / Correct / Incorrect normalization check
  const tfTarget = normalizeTrueFalse(rawTarget);
  const tfOpt = normalizeTrueFalse(optText);
  const isTfKeywords = ['true', 'false', 'صح', 'خطأ', 'correct', 'incorrect'];
  
  if (isTfKeywords.includes(normTarget) || isTfKeywords.includes(normOpt)) {
    return tfTarget === tfOpt;
  }

  // 3. Option letter/index check (e.g. target is "A", "B", "C", "D" or "0", "1", "2", "3" or "أ", "ب", "ج", "د")
  if (optIndex >= 0) {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const arLetters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
    const targetClean = rawTarget.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '');
    if (targetClean === letters[optIndex] || targetClean === arLetters[optIndex] || targetClean === String(optIndex)) return true;
  }

  // 4. Multi-word string containment (only for long strings with multiple words)
  if (normTarget.length > 6 && normOpt.length > 6) {
    const targetWords = normTarget.split(/\s+/).filter(Boolean);
    const optWords = normOpt.split(/\s+/).filter(Boolean);
    if (targetWords.length >= 3 && optWords.length >= 3) {
      if (normTarget.includes(normOpt) || normOpt.includes(normTarget)) return true;
    }
  }

  return false;
};

export const isAnswerCorrect = (question: any, selectedAnswer: any) => {
  if (!selectedAnswer && selectedAnswer !== 0) return false;

  if (['TEXT', 'EXPLANATION', 'VIDEO', 'IMAGE', 'CONTENT'].includes(question.type) || ['TEXT', 'EXPLANATION', 'VIDEO', 'IMAGE', 'CONTENT'].includes(question.label)) {
    return true;
  }

  const cleanStr = (s: any) => String(s ?? '').trim().toLowerCase().replace(/"/g, '');

  const parseVal = (v: any) => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { return JSON.parse(t); } catch { return v; }
    }
    return v;
  };

  const correctParsed = parseVal(question.correctAnswer);
  const studentParsed = parseVal(selectedAnswer);

  if (question.type === 'TRUE_FALSE') {
    return normalizeTrueFalse(String(studentParsed)) === normalizeTrueFalse(String(correctParsed));
  }

  if (question.type === 'MULTI_SELECT') {
    return arraysMatch(parseStringArray(question.correctAnswer), parseStringArray(selectedAnswer));
  }

  if (question.type === 'MEMORY_GAME') {
    try {
      const opts = typeof question.options === 'string' ? JSON.parse(question.options) : (question.options || {});
      const correct = typeof question.correctAnswer === 'string' ? JSON.parse(question.correctAnswer) : (question.correctAnswer || []);
      const pairsArr = Array.isArray(opts.pairs) ? opts.pairs : (Array.isArray(opts) ? opts : (Array.isArray(correct) ? correct : []));
      const totalPairs = pairsArr.length;
      const matchedArr = Array.isArray(studentParsed) ? studentParsed : parseStringArray(selectedAnswer);
      if (totalPairs === 0) return matchedArr.length > 0;
      return matchedArr.length >= totalPairs;
    } catch { return false; }
  }

  if (['CROSSWORD', 'COLOR_MATCH', 'IMAGE_LABEL'].includes(question.type)) {
    if (typeof correctParsed === 'object' && !Array.isArray(correctParsed) && correctParsed !== null &&
        typeof studentParsed === 'object' && !Array.isArray(studentParsed) && studentParsed !== null) {
      const correctKeys = Object.keys(correctParsed);
      if (correctKeys.length === 0) return false;
      return correctKeys.every(k => cleanStr(correctParsed[k]) === cleanStr(studentParsed[k]));
    }
    return false;
  }

  if (question.type === 'VIDEO_CHECKPOINT') {
    try {
      const correctMap = typeof correctParsed === 'object' ? correctParsed : {};
      const studentCheckpoints = (typeof studentParsed === 'object' && studentParsed?.answeredCheckpoints)
        ? studentParsed.answeredCheckpoints
        : studentParsed;
      const timeKeys = Object.keys(correctMap);
      if (timeKeys.length === 0) return false;
      return timeKeys.every(k => cleanStr(correctMap[k]) === cleanStr(studentCheckpoints?.[k]));
    } catch { return false; }
  }

  if (question.type === 'FLASH_CARD') {
    return cleanStr(studentParsed) === cleanStr(correctParsed);
  }

  if (question.type === 'WORD_SEARCH') {
    return arraysMatch(parseStringArray(question.correctAnswer), parseStringArray(selectedAnswer));
  }

  // Handle MCQ or options-based questions
  let optionsArr: any[] = [];
  try {
    optionsArr = typeof question.options === 'string'
      ? JSON.parse(question.options || '[]')
      : (Array.isArray(question.options) ? question.options : []);
  } catch { optionsArr = []; }

  if (Array.isArray(optionsArr) && optionsArr.length > 0) {
    for (let i = 0; i < optionsArr.length; i++) {
      const opt = optionsArr[i];
      const matchesStudent = isOptionMatch(selectedAnswer, opt, i);
      const matchesCorrect = isOptionMatch(question.correctAnswer, opt, i);
      if (matchesStudent && matchesCorrect) return true;
    }
  }

  if (Array.isArray(correctParsed) && Array.isArray(studentParsed)) {
    return correctParsed.length === studentParsed.length &&
      correctParsed.every((val: any, i: number) => cleanStr(val) === cleanStr(studentParsed[i]));
  }

  if (typeof correctParsed === 'object' && !Array.isArray(correctParsed) && correctParsed !== null &&
      typeof studentParsed === 'object' && !Array.isArray(studentParsed) && studentParsed !== null) {
    const correctKeys = Object.keys(correctParsed);
    const studentKeys = Object.keys(studentParsed);
    if (correctKeys.length !== studentKeys.length) return false;
    return correctKeys.every(k => cleanStr(correctParsed[k]) === cleanStr(studentParsed[k]));
  }

  return cleanStr(selectedAnswer) === cleanStr(question.correctAnswer) || stripHtmlAndNormalize(selectedAnswer) === stripHtmlAndNormalize(question.correctAnswer);
};

export const GRADE_STAGE_MAP: Record<string, string> = {
  "الصف الأول الابتدائي": "Elementary",
  "الصف الثاني الابتدائي": "Elementary",
  "الصف الثالث الابتدائي": "Elementary",
  "الصف الرابع الابتدائي": "Elementary",
  "الصف الخامس الابتدائي": "Elementary",
  "الصف السادس الابتدائي": "Elementary",
  "الصف الأول الإعدادي": "Middle School",
  "الصف الثاني الإعدادي": "Middle School",
  "الصف الثالث الإعدادي": "Middle School",
  "الصف الأول الثانوي": "High School",
  "الصف الثاني الثانوي": "High School",
  "الصف الثالث الثانوي": "High School",

  "Grade 1 Elementary": "Elementary",
  "Grade 2 Elementary": "Elementary",
  "Grade 3 Elementary": "Elementary",
  "Grade 4 Elementary": "Elementary",
  "Grade 5 Elementary": "Elementary",
  "Grade 6 Elementary": "Elementary",
  "Grade 1 Middle School": "Middle School",
  "Grade 2 Middle School": "Middle School",
  "Grade 3 Middle School": "Middle School",
  "Grade 1 High School": "High School",
  "Grade 2 High School": "High School",
  "Grade 3 High School": "High School"
};

export const GRADE_TRANSLATION_MAP: Record<string, string> = {
  "Grade 1 Elementary": "الصف الأول الابتدائي",
  "Grade 2 Elementary": "الصف الثاني الابتدائي",
  "Grade 3 Elementary": "الصف الثالث الابتدائي",
  "Grade 4 Elementary": "الصف الرابع الابتدائي",
  "Grade 5 Elementary": "الصف الخامس الابتدائي",
  "Grade 6 Elementary": "الصف السادس الابتدائي",
  "Grade 1 Middle School": "الصف الأول الإعدادي",
  "Grade 2 Middle School": "الصف الثاني الإعدادي",
  "Grade 3 Middle School": "الصف الثالث الإعدادي",
  "Grade 1 High School": "الصف الأول الثانوي",
  "Grade 2 High School": "الصف الثاني الثانوي",
  "Grade 3 High School": "الصف الثالث الثانوي",

  "الصف الأول الابتدائي": "Grade 1 Elementary",
  "الصف الثاني الابتدائي": "Grade 2 Elementary",
  "الصف الثالث الابتدائي": "Grade 3 Elementary",
  "الصف الرابع الابتدائي": "Grade 4 Elementary",
  "الصف الخامس الابتدائي": "Grade 5 Elementary",
  "الصف السادس الابتدائي": "Grade 6 Elementary",
  "الصف الأول الإعدادي": "Grade 1 Middle School",
  "الصف الثاني الإعدادي": "Grade 2 Middle School",
  "الصف الثالث الإعدادي": "Grade 3 Middle School",
  "الصف الأول الثانوي": "Grade 1 High School",
  "الصف الثاني الثانوي": "Grade 2 High School",
  "الصف الثالث الثانوي": "Grade 3 High School"
};

export const getStudentGradeAndStage = (studentGrade: string | null | undefined): string[] => {
  if (!studentGrade) return [];
  const results: string[] = [studentGrade];
  const translated = GRADE_TRANSLATION_MAP[studentGrade];
  if (translated) results.push(translated);
  const stage = GRADE_STAGE_MAP[studentGrade] || (translated ? GRADE_STAGE_MAP[translated] : null);
  if (stage) results.push(stage);
  return Array.from(new Set(results));
};

export const examMatchesStudent = (exam: any, user: any) => {
  if (user && ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user.role)) return true;

  const gradeTargets = parseStringArray(exam.grades);
  if (exam.grade) gradeTargets.push(exam.grade);
  const uniqueGradeTargets = Array.from(new Set(gradeTargets));

  const studentGrades = getStudentGradeAndStage(user.grade);
  if (uniqueGradeTargets.length > 0 && !studentGrades.some(g => uniqueGradeTargets.includes(g))) {
    return false;
  }

  // If the exam is assigned to specific schools, the student MUST belong to one of those schools
  const hasAssignedSchools = Boolean(exam.schoolId || (exam.schools && exam.schools.length > 0));
  if (hasAssignedSchools) {
    const belongsToAssignedSchool = exam.schools?.some((school: any) => school.id === user.schoolId);
    const isOwnerSchool = exam.schoolId === user.schoolId;
    return Boolean(isOwnerSchool || belongsToAssignedSchool);
  }

  // Central exams (no specific school assignment) are accessible to all students
  if (exam.isCentral) return true;

  return false;
};

export const buildStudentCourseWhere = (student: any) => {
  const courseWhere: any = {};
  const studentGrades = getStudentGradeAndStage(student.grade);

  const orConditions: any[] = [{ grade: null }];
  for (const g of studentGrades) {
    orConditions.push({ grade: g });
    orConditions.push({ grades: { contains: `"${g}"` } });
  }

  const gradeFilter = student.grade ? { OR: orConditions } : {};

  if (student.schoolId) {
    courseWhere.AND = [
      {
        OR: [
          { isCentral: true },
          { schoolId: student.schoolId },
          { schools: { some: { id: student.schoolId } } }
        ]
      },
      gradeFilter
    ].filter(filter => Object.keys(filter).length > 0);
  } else {
    courseWhere.AND = [
      { isCentral: true },
      gradeFilter
    ].filter(filter => Object.keys(filter).length > 0);
  }

  return courseWhere.AND?.length ? courseWhere : {};
};

export async function ensurePerformanceIndexes() {
  if (process.env.SKIP_PERFORMANCE_INDEXES === 'true') return;

  // In PM2 cluster mode, only Worker #0 executes DDL index operations
  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
    console.log(`[DB Index Setup] PM2 worker #${process.env.NODE_APP_INSTANCE} — skipping index check (worker #0 handles DDL).`);
    return;
  }

  const isPostgres = process.env.DATABASE_URL?.startsWith('postgres') || process.env.DATABASE_URL?.startsWith('postgresql');
  let advisoryLockAcquired = false;

  try {
    if (isPostgres) {
      try {
        const lockResult: any = await prisma.$queryRawUnsafe('SELECT pg_try_advisory_lock(74839201) as locked;');
        advisoryLockAcquired = Boolean(lockResult?.[0]?.locked);
        if (!advisoryLockAcquired) {
          console.log('[DB Index Setup] Another instance is already maintaining indexes. Skipping.');
          return;
        }

        // Clean any invalid indexes leftover from past deadlocks
        const invalidIndexes: any = await prisma.$queryRawUnsafe(`
          SELECT c.relname as index_name
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE i.indisvalid = false AND n.nspname = 'public';
        `);
        if (Array.isArray(invalidIndexes) && invalidIndexes.length > 0) {
          for (const row of invalidIndexes) {
            console.warn(`[DB Index Setup] Dropping invalid index: "${row.index_name}"`);
            try {
              await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${row.index_name}"`);
            } catch (dropErr: any) {
              console.warn(`[DB Index Setup] Failed to drop invalid index "${row.index_name}": ${dropErr.message}`);
            }
          }
        }
      } catch (lockErr: any) {
        console.warn(`[DB Index Setup] Advisory lock/cleanup notice: ${lockErr.message}`);
      }
      try {
        await prisma.$executeRawUnsafe('ALTER TABLE "ExamModule" ADD COLUMN IF NOT EXISTS "parentModuleId" TEXT;');
      } catch (colErr: any) {
        console.warn(`[DB Schema Setup] Notice adding parentModuleId: ${colErr.message}`);
      }
    }

    const statements = [
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Course_isCentral_grade_idx" ON "Course" ("isCentral", "grade")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Course_schoolId_grade_idx" ON "Course" ("schoolId", "grade")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Course_subject_idx" ON "Course" ("subject")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "LessonProgress_userId_isCompleted_idx" ON "LessonProgress" ("userId", "isCompleted")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "LessonProgress_lessonId_idx" ON "LessonProgress" ("lessonId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "CourseProgress_userId_idx" ON "CourseProgress" ("userId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "CourseProgress_courseId_idx" ON "CourseProgress" ("courseId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "StudentEnrollment_courseId_idx" ON "StudentEnrollment" ("courseId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "TeacherCourse_courseId_idx" ON "TeacherCourse" ("courseId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Exam_createdAt_idx" ON "Exam" ("createdAt")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Exam_schoolId_createdAt_idx" ON "Exam" ("schoolId", "createdAt")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Exam_isCentral_createdAt_idx" ON "Exam" ("isCentral", "createdAt")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "ExamSubmission_userId_createdAt_idx" ON "ExamSubmission" ("userId", "createdAt")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "ExamSubmission_examId_userId_idx" ON "ExamSubmission" ("examId", "userId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Question_examId_idx" ON "Question" ("examId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Question_examId_deletedAt_idx" ON "Question" ("examId", "deletedAt")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Question_subExamId_idx" ON "Question" ("subExamId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Question_subExamId_deletedAt_idx" ON "Question" ("subExamId", "deletedAt")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Question_moduleId_idx" ON "Question" ("moduleId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Question_deletedAt_idx" ON "Question" ("deletedAt")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "ExamModule_examId_idx" ON "ExamModule" ("examId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "ExamModule_parentModuleId_idx" ON "ExamModule" ("parentModuleId")',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "SubExam_moduleId_idx" ON "SubExam" ("moduleId")'
    ];

    for (const statement of statements) {
      try {
        const query = isPostgres ? statement : statement.replace(' CONCURRENTLY', '');
        await prisma.$executeRawUnsafe(query);
      } catch (idxErr: any) {
        console.warn(`[DB Index Setup] Non-fatal notice: ${idxErr.message}`);
      }
    }
  } finally {
    if (isPostgres && advisoryLockAcquired) {
      try {
        await prisma.$executeRawUnsafe(`
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1 FROM pg_locks
              WHERE locktype = 'advisory'
                AND (objid = 74839201 OR classid = 74839201)
                AND pid = pg_backend_pid()
            ) THEN
              PERFORM pg_advisory_unlock(74839201);
            END IF;
          END $$;
        `);
      } catch {}
    }
  }
}

export async function normalizeLegacyCourses() {
  const courses = await prisma.course.findMany({
    select: { id: true, grade: true, grades: true, isCentral: true }
  });

  for (const course of courses) {
    const updates: any = {};
    const gradeTargets = parseStringArray(course.grades);
    if (!course.grade && gradeTargets.length > 0) {
      updates.grade = gradeTargets[0];
    }
    if (course.grade && !course.grades) {
      updates.grades = JSON.stringify([course.grade]);
    }

    if (Object.keys(updates).length > 0) {
      await prisma.course.update({ where: { id: course.id }, data: updates });
    }

    await prisma.lesson.updateMany({
      where: { courseId: course.id, isCentral: { not: course.isCentral } },
      data: { isCentral: course.isCentral }
    });
  }
}

// Stats Cache to improve performance (mirrored with Redis for cluster mode)
export const statsCache = new Map<string, { data: any, timestamp: number }>();
export const CACHE_TTL = 300 * 1000; // 5 minutes cache

export const setCache = (key: string, data: any) => {
  if (statsCache.size >= 1000) {
    const firstKey = statsCache.keys().next().value;
    if (firstKey !== undefined) {
      statsCache.delete(firstKey);
    }
  }
  const entry = { data, timestamp: Date.now() };
  statsCache.set(key, entry);

  // Sync to Redis cluster asynchronously with TTL (5 mins)
  cacheSetJSON(`stats:${key}`, entry, Math.floor(CACHE_TTL / 1000)).catch(() => {});
};

export const getCache = (key: string) => {
  const cached = statsCache.get(key);
  if (cached) {
    // 🔒 LRU Cache implementation: Move accessed key to the end of the Map
    statsCache.delete(key);
    statsCache.set(key, cached);
    return cached;
  }
  return undefined;
};

/**
 * Async cache getter that checks Redis before falling back to local memory.
 */
export const getCacheAsync = async (key: string): Promise<{ data: any; timestamp: number } | undefined> => {
  try {
    const fromRedis = await cacheGetJSON<{ data: any; timestamp: number }>(`stats:${key}`);
    if (fromRedis && fromRedis.data !== undefined) {
      statsCache.set(key, fromRedis);
      return fromRedis;
    }
  } catch {
    // Fall back to local memory
  }
  return getCache(key);
};

/**
 * Cluster-aware Rate Limiting for Login
 */
export const isLoginRateLimited = async (ip: string): Promise<{ isLimited: boolean; remainingMinutes: number }> => {
  const redisKey = `ratelimit:login:${ip}`;
  const now = Date.now();

  // 1. Check local memory
  const localAttempt = loginAttempts.get(ip);
  if (localAttempt && localAttempt.count >= LOGIN_MAX_ATTEMPTS && (now - localAttempt.firstAttemptAt < LOGIN_WINDOW_MS)) {
    const remainingMs = LOGIN_WINDOW_MS - (now - localAttempt.firstAttemptAt);
    return { isLimited: true, remainingMinutes: Math.ceil(remainingMs / 60000) };
  }

  // 2. Check Redis if active
  if (isRedisActive()) {
    try {
      const redisStatus = await cacheGetJSON<{ count: number; firstAttemptAt: number }>(redisKey);
      if (redisStatus && redisStatus.count >= LOGIN_MAX_ATTEMPTS && (now - redisStatus.firstAttemptAt < LOGIN_WINDOW_MS)) {
        const remainingMs = LOGIN_WINDOW_MS - (now - redisStatus.firstAttemptAt);
        return { isLimited: true, remainingMinutes: Math.ceil(remainingMs / 60000) };
      }
    } catch {
      // Non-fatal
    }
  }

  return { isLimited: false, remainingMinutes: 0 };
};

export const recordFailedLogin = async (ip: string): Promise<void> => {
  const now = Date.now();
  const redisKey = `ratelimit:login:${ip}`;

  // 1. Update local memory
  const localAttempt = loginAttempts.get(ip);
  let newCount = 1;
  let firstAttemptAt = now;

  if (localAttempt && now - localAttempt.firstAttemptAt <= LOGIN_WINDOW_MS) {
    newCount = localAttempt.count + 1;
    firstAttemptAt = localAttempt.firstAttemptAt;
  }
  loginAttempts.set(ip, { count: newCount, firstAttemptAt });

  // 2. Update Redis
  if (isRedisActive()) {
    const windowSecs = Math.floor(LOGIN_WINDOW_MS / 1000);
    await cacheSetJSON(redisKey, { count: newCount, firstAttemptAt }, windowSecs).catch(() => {});
  }
};

export const clearLoginAttempts = async (ip: string): Promise<void> => {
  loginAttempts.delete(ip);
  if (isRedisActive()) {
    await cacheDelete(`ratelimit:login:${ip}`).catch(() => {});
  }
};

// Simple In-Memory Mutex to prevent double-click submissions (Idempotency)
const locks = new Set<string>();

export const acquireLock = (key: string): boolean => {
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
};

export const releaseLock = (key: string): void => {
  locks.delete(key);
};
