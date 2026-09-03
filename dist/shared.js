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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseLock = exports.acquireLock = exports.getCache = exports.setCache = exports.CACHE_TTL = exports.statsCache = exports.buildStudentCourseWhere = exports.examMatchesStudent = exports.getStudentGradeAndStage = exports.GRADE_TRANSLATION_MAP = exports.GRADE_STAGE_MAP = exports.isAnswerCorrect = exports.isOptionMatch = exports.stripHtmlAndNormalize = exports.normalizeTrueFalse = exports.arraysMatch = exports.parseStringArray = exports.hasRequiredFields = exports.sanitizeExam = exports.sanitizeUser = exports.userSafeSelect = exports.ALL_ROLES = exports.SCHOOL_MANAGED_ROLES = exports.pushDiagnosticLog = exports.serializeLogPart = exports.diagnosticLogs = exports.DIAGNOSTIC_LOG_LIMIT = exports.isAllowedVideoUrl = exports.isSafeVimeoUrl = exports.isSafeYoutubeUrl = exports.sanitizeDeep = exports.sanitizeHtml = exports.externalizeEmbeddedDataImages = exports.replaceEmbeddedDataImages = exports.isOriginAllowed = exports.allowedOrigins = exports.buildAllowedOrigins = exports.loginAttempts = exports.LOGIN_MAX_ATTEMPTS = exports.LOGIN_WINDOW_MS = exports.ALLOWED_VIDEO_HOSTS = exports.multerUpload = exports.ALLOWED_MIME_TYPES = exports.UPLOADS_DIR = exports.JWT_EXPIRES_IN = exports.JWT_SECRET = void 0;
exports.getYoutubeDuration = getYoutubeDuration;
exports.getVimeoDuration = getVimeoDuration;
exports.getVideoDuration = getVideoDuration;
exports.extractAndSaveBase64Images = extractAndSaveBase64Images;
exports.ensurePerformanceIndexes = ensurePerformanceIndexes;
exports.normalizeLegacyCourses = normalizeLegacyCourses;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const crypto_1 = __importDefault(require("crypto"));
const multer_1 = __importDefault(require("multer"));
const prisma_1 = __importDefault(require("./lib/prisma"));
if (!process.env.JWT_SECRET) {
    console.warn('⚠️ WARNING: JWT_SECRET environment variable is missing!');
}
exports.JWT_SECRET = process.env.JWT_SECRET;
exports.JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '4h');
// ==========================================
// 📁 FILE UPLOAD CONFIGURATION (multer)
// ==========================================
exports.UPLOADS_DIR = path_1.default.join(process.cwd(), 'uploads');
if (!fs_1.default.existsSync(exports.UPLOADS_DIR))
    fs_1.default.mkdirSync(exports.UPLOADS_DIR, { recursive: true });
exports.ALLOWED_MIME_TYPES = new Set([
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
const multerStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, exports.UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const mimeMap = {
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
        const ext = mimeMap[file.mimetype] || path_1.default.extname(file.originalname).toLowerCase();
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
        cb(null, uniqueName);
    }
});
exports.multerUpload = (0, multer_1.default)({
    storage: multerStorage,
    limits: { fileSize: 1000 * 1024 * 1024 }, // 1 GB limit
    fileFilter: (_req, file, cb) => {
        if (exports.ALLOWED_MIME_TYPES.has(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error(`File type not allowed: ${file.mimetype}`));
        }
    }
});
exports.ALLOWED_VIDEO_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'vimeo.com',
    'www.vimeo.com',
    'player.vimeo.com'
]);
exports.LOGIN_WINDOW_MS = 15 * 60 * 1000;
exports.LOGIN_MAX_ATTEMPTS = 10;
exports.loginAttempts = new Map();
const originalLoginAttemptsSet = exports.loginAttempts.set.bind(exports.loginAttempts);
exports.loginAttempts.set = function (key, value) {
    if (exports.loginAttempts.size >= 5000 && !exports.loginAttempts.has(key)) {
        const firstKey = exports.loginAttempts.keys().next().value;
        if (firstKey)
            exports.loginAttempts.delete(firstKey);
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
    for (const [key, val] of exports.loginAttempts.entries()) {
        if (now - val.firstAttemptAt > exports.LOGIN_WINDOW_MS) {
            exports.loginAttempts.delete(key);
        }
    }
    // Enforce max size to prevent memory exhaustion / DDoS
    while (exports.loginAttempts.size > 5000) {
        const firstKey = exports.loginAttempts.keys().next().value;
        if (firstKey)
            exports.loginAttempts.delete(firstKey);
    }
}, 60 * 60 * 1000).unref();
const buildAllowedOrigins = () => {
    const fromEnv = process.env.ALLOWED_ORIGINS || '';
    return fromEnv
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};
exports.buildAllowedOrigins = buildAllowedOrigins;
exports.allowedOrigins = (0, exports.buildAllowedOrigins)();
const isOriginAllowed = (origin, allowedList) => {
    if (allowedList.length === 0)
        return false;
    try {
        const cleanOrigin = origin.replace(/^https?:\/\//, '').replace(/\/$/, '').split(':')[0].toLowerCase();
        return allowedList.some(allowed => {
            const cleanAllowed = allowed.replace(/^https?:\/\//, '').replace(/\/$/, '').split(':')[0].toLowerCase();
            return cleanOrigin === cleanAllowed || origin.toLowerCase() === allowed.toLowerCase();
        });
    }
    catch (_a) {
        return false;
    }
};
exports.isOriginAllowed = isOriginAllowed;
const DATA_IMAGE_URI_REGEX = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
const extensionFromImageMime = (mimeSubtype) => {
    const normalized = mimeSubtype.toLowerCase();
    if (normalized === 'jpeg' || normalized === 'jpg')
        return 'jpg';
    // 🔒 SVG intentionally removed: SVG can contain arbitrary JS (XSS vector)
    if (normalized === 'png' || normalized === 'webp' || normalized === 'gif')
        return normalized;
    return 'bin'; // Unknown / unsafe types: save as binary (won't be served as image)
};
const replaceEmbeddedDataImages = (input) => {
    if (!input || typeof input !== 'string' || !input.includes('data:image/'))
        return input;
    const baseUrl = (process.env.BASE_URL || 'https://api.klevro.tech').replace(/\/+$/, '');
    return input.replace(DATA_IMAGE_URI_REGEX, (fullMatch, mimeSubtype, base64Data) => {
        try {
            const buffer = Buffer.from(base64Data, 'base64');
            if (buffer.length === 0)
                return '';
            const ext = extensionFromImageMime(mimeSubtype);
            const hash = crypto_1.default.createHash('md5').update(buffer).digest('hex');
            const filename = `embedded-${hash}.${ext}`;
            const destination = path_1.default.join(exports.UPLOADS_DIR, filename);
            if (!fs_1.default.existsSync(destination)) {
                fs_1.default.writeFileSync(destination, buffer);
            }
            return `/uploads/${filename}`;
        }
        catch (err) {
            console.warn(`⚠️ Failed to externalize embedded image: ${err.message}`);
            return '';
        }
    });
};
exports.replaceEmbeddedDataImages = replaceEmbeddedDataImages;
const externalizeEmbeddedDataImages = (value) => {
    if (typeof value === 'string') {
        if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
            try {
                return JSON.stringify((0, exports.externalizeEmbeddedDataImages)(JSON.parse(value)));
            }
            catch (_a) {
                // Not JSON; continue as plain text/HTML.
            }
        }
        return (0, exports.replaceEmbeddedDataImages)(value);
    }
    if (Array.isArray(value))
        return value.map(exports.externalizeEmbeddedDataImages);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, nested] of Object.entries(value)) {
            out[key] = (0, exports.externalizeEmbeddedDataImages)(nested);
        }
        return out;
    }
    return value;
};
exports.externalizeEmbeddedDataImages = externalizeEmbeddedDataImages;
const sanitizeHtml = (input) => {
    if (!input)
        return "";
    if (typeof input !== 'string') {
        if (typeof input === 'object') {
            try {
                return (0, exports.sanitizeHtml)(JSON.stringify(input));
            }
            catch (_a) {
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
    return (0, exports.replaceEmbeddedDataImages)(sanitized);
};
exports.sanitizeHtml = sanitizeHtml;
const sanitizeDeep = (value) => {
    if (typeof value === 'string') {
        // If the string is a JSON array or object, parse it safely before sanitizing.
        // IMPORTANT: Return the parsed object/array directly (NOT re-stringified with JSON.stringify)
        // This preserves emoji (4-byte UTF-8) and special Unicode characters correctly,
        // since Prisma's Json type will handle serialization itself without corrupting them.
        if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
            try {
                const parsed = JSON.parse(value);
                return (0, exports.sanitizeDeep)(parsed); // Return object/array — NOT JSON.stringify(...)
            }
            catch (e) {
                // Not valid JSON, fallback to sanitizeHtml
            }
        }
        return (0, exports.sanitizeHtml)(value);
    }
    if (Array.isArray(value))
        return value.map(exports.sanitizeDeep);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, nested] of Object.entries(value)) {
            out[key] = (0, exports.sanitizeDeep)(nested);
        }
        return out;
    }
    return value;
};
exports.sanitizeDeep = sanitizeDeep;
const isSafeYoutubeUrl = (urlStr) => {
    if (!urlStr)
        return false;
    try {
        let formatted = urlStr.trim();
        if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
            formatted = 'https://' + formatted;
        }
        const parsed = new URL(formatted);
        const host = parsed.hostname.toLowerCase();
        const allowed = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
        return allowed.includes(host);
    }
    catch (_a) {
        return false;
    }
};
exports.isSafeYoutubeUrl = isSafeYoutubeUrl;
const isSafeVimeoUrl = (urlStr) => {
    if (!urlStr)
        return false;
    try {
        let formatted = urlStr.trim();
        if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
            formatted = 'https://' + formatted;
        }
        const parsed = new URL(formatted);
        const host = parsed.hostname.toLowerCase();
        const allowed = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];
        return allowed.includes(host);
    }
    catch (_a) {
        return false;
    }
};
exports.isSafeVimeoUrl = isSafeVimeoUrl;
const isAllowedVideoUrl = (rawUrl) => {
    if (!rawUrl)
        return true;
    return (0, exports.isSafeYoutubeUrl)(rawUrl) || (0, exports.isSafeVimeoUrl)(rawUrl);
};
exports.isAllowedVideoUrl = isAllowedVideoUrl;
function getYoutubeDuration(url) {
    return new Promise((resolve) => {
        if (!(0, exports.isSafeYoutubeUrl)(url))
            return resolve(0);
        const req = https_1.default.get(url, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = res.headers.location;
                if (!(0, exports.isSafeYoutubeUrl)(redirectUrl)) {
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
function getVimeoDuration(url) {
    return new Promise((resolve) => {
        if (!(0, exports.isSafeVimeoUrl)(url))
            return resolve(0);
        const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
        const req = https_1.default.get(oembedUrl, (res) => {
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
                }
                catch (_a) {
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
function getVideoDuration(url) {
    if (!url)
        return Promise.resolve(0);
    if (url.includes('vimeo'))
        return getVimeoDuration(url);
    if (url.includes('youtube') || url.includes('youtu.be'))
        return getYoutubeDuration(url);
    return Promise.resolve(0);
}
exports.DIAGNOSTIC_LOG_LIMIT = 300;
exports.diagnosticLogs = [];
let diagnosticLogId = 0;
const serializeLogPart = (value) => {
    if (typeof value === 'string')
        return value;
    if (value instanceof Error)
        return `${value.name}: ${value.message}\n${value.stack || ''}`.trim();
    try {
        return JSON.stringify(value);
    }
    catch (_a) {
        return String(value);
    }
};
exports.serializeLogPart = serializeLogPart;
const pushDiagnosticLog = (level, parts) => {
    const message = parts.map(exports.serializeLogPart).join(' ');
    exports.diagnosticLogs.push({
        id: ++diagnosticLogId,
        level,
        message,
        timestamp: new Date().toISOString()
    });
    if (exports.diagnosticLogs.length > exports.DIAGNOSTIC_LOG_LIMIT)
        exports.diagnosticLogs.shift();
};
exports.pushDiagnosticLog = pushDiagnosticLog;
exports.SCHOOL_MANAGED_ROLES = ['STUDENT', 'TEACHER', 'PARENT'];
exports.ALL_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'SUPERVISOR'];
exports.userSafeSelect = {
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
const sanitizeUser = (user) => {
    if (!user)
        return user;
    const { password, plainPassword } = user, safeUser = __rest(user, ["password", "plainPassword"]);
    return safeUser;
};
exports.sanitizeUser = sanitizeUser;
function extractAndSaveBase64Images(input) {
    if (!input)
        return input;
    if (typeof input === 'string') {
        // 🔒 SECURITY: svg+xml intentionally excluded — SVG can contain arbitrary JS (XSS).
        const base64Regex = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/g;
        return input.replace(base64Regex, (_match, mimeType, base64Data) => {
            try {
                const ext = mimeType.replace('+', '').replace('xml', ''); // safe fallback (not used for SVG)
                const buffer = Buffer.from(base64Data, 'base64');
                const hash = crypto_1.default.createHash('md5').update(buffer).digest('hex');
                const filename = `img_${hash}.${mimeType}`;
                const filePath = path_1.default.join(exports.UPLOADS_DIR, filename);
                if (!fs_1.default.existsSync(filePath)) {
                    fs_1.default.writeFileSync(filePath, buffer);
                }
                return `/uploads/${filename}`;
            }
            catch (err) {
                return _match;
            }
        });
    }
    if (typeof input === 'object') {
        try {
            const jsonStr = JSON.stringify(input);
            const updatedStr = extractAndSaveBase64Images(jsonStr);
            return JSON.parse(updatedStr);
        }
        catch (_a) {
            return input;
        }
    }
    return input;
}
const sanitizeExam = (exam) => {
    if (!exam)
        return exam;
    const { password } = exam, safeExam = __rest(exam, ["password"]);
    return safeExam;
};
exports.sanitizeExam = sanitizeExam;
const hasRequiredFields = (body, fields) => {
    const missing = fields.filter(field => body[field] === undefined || body[field] === null || body[field] === '');
    return missing.length === 0 ? null : missing;
};
exports.hasRequiredFields = hasRequiredFields;
const parseStringArray = (value) => {
    if (value === null || value === undefined)
        return [];
    if (Array.isArray(value))
        return value.map(v => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed)
            return [];
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed))
                    return parsed.map(v => String(v).trim()).filter(Boolean);
            }
            catch (_a) { }
        }
        if (trimmed.includes(',')) {
            return trimmed.split(',').map(s => s.trim()).filter(Boolean);
        }
        return [trimmed];
    }
    return [String(value).trim()].filter(Boolean);
};
exports.parseStringArray = parseStringArray;
const arraysMatch = (left, right) => {
    if (left.length !== right.length)
        return false;
    const clean = (s) => String(s !== null && s !== void 0 ? s : '').trim().toLowerCase();
    const normalizedLeft = [...left].map(clean).sort();
    const normalizedRight = [...right].map(clean).sort();
    return normalizedLeft.every((value, index) => value === normalizedRight[index]);
};
exports.arraysMatch = arraysMatch;
const normalizeTrueFalse = (val) => {
    const v = String(val !== null && val !== void 0 ? val : '').trim().toLowerCase();
    if (v === 'true' || v === 'صح' || v === 'صواب' || v === '1' || v === 'صحيح')
        return 'TRUE';
    if (v === 'false' || v === 'خطأ' || v === 'خطا' || v === 'غلط' || v === '0' || v === 'غير صحيح')
        return 'FALSE';
    return v.toUpperCase();
};
exports.normalizeTrueFalse = normalizeTrueFalse;
const stripHtmlAndNormalize = (str) => {
    if (str === null || str === undefined)
        return '';
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
exports.stripHtmlAndNormalize = stripHtmlAndNormalize;
const isOptionMatch = (targetVal, optText, optIndex = -1) => {
    if (targetVal === null || targetVal === undefined || optText === null || optText === undefined)
        return false;
    const rawTarget = String(targetVal).trim();
    const normTarget = (0, exports.stripHtmlAndNormalize)(rawTarget);
    const normOpt = (0, exports.stripHtmlAndNormalize)(optText);
    if (!normTarget || !normOpt)
        return false;
    // 1. Direct exact normalized string match
    if (normTarget === normOpt)
        return true;
    // 2. True / False / Correct / Incorrect normalization check
    const tfTarget = (0, exports.normalizeTrueFalse)(rawTarget);
    const tfOpt = (0, exports.normalizeTrueFalse)(optText);
    const isTfKeywords = ['true', 'false', 'صح', 'خطأ', 'correct', 'incorrect'];
    if (isTfKeywords.includes(normTarget) || isTfKeywords.includes(normOpt)) {
        return tfTarget === tfOpt;
    }
    // 3. Option letter/index check (e.g. target is "A", "B", "C", "D" or "0", "1", "2", "3" or "أ", "ب", "ج", "د")
    if (optIndex >= 0) {
        const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const arLetters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
        const targetClean = rawTarget.toLowerCase().replace(/[^a-z0-9\u0621-\u064A]/g, '');
        if (targetClean === letters[optIndex] || targetClean === arLetters[optIndex] || targetClean === String(optIndex))
            return true;
    }
    // 4. Multi-word string containment (only for long strings with multiple words)
    if (normTarget.length > 6 && normOpt.length > 6) {
        const targetWords = normTarget.split(/\s+/).filter(Boolean);
        const optWords = normOpt.split(/\s+/).filter(Boolean);
        if (targetWords.length >= 3 && optWords.length >= 3) {
            if (normTarget.includes(normOpt) || normOpt.includes(normTarget))
                return true;
        }
    }
    return false;
};
exports.isOptionMatch = isOptionMatch;
const isAnswerCorrect = (question, selectedAnswer) => {
    if (!selectedAnswer && selectedAnswer !== 0)
        return false;
    if (['TEXT', 'EXPLANATION', 'VIDEO', 'IMAGE', 'CONTENT'].includes(question.type) || ['TEXT', 'EXPLANATION', 'VIDEO', 'IMAGE', 'CONTENT'].includes(question.label)) {
        return true;
    }
    const cleanStr = (s) => String(s !== null && s !== void 0 ? s : '').trim().toLowerCase().replace(/"/g, '');
    const parseVal = (v) => {
        if (typeof v !== 'string')
            return v;
        const t = v.trim();
        if (t.startsWith('{') || t.startsWith('[')) {
            try {
                return JSON.parse(t);
            }
            catch (_a) {
                return v;
            }
        }
        return v;
    };
    const correctParsed = parseVal(question.correctAnswer);
    const studentParsed = parseVal(selectedAnswer);
    if (question.type === 'TRUE_FALSE') {
        return (0, exports.normalizeTrueFalse)(String(studentParsed)) === (0, exports.normalizeTrueFalse)(String(correctParsed));
    }
    if (question.type === 'MULTI_SELECT') {
        return (0, exports.arraysMatch)((0, exports.parseStringArray)(question.correctAnswer), (0, exports.parseStringArray)(selectedAnswer));
    }
    if (question.type === 'MEMORY_GAME') {
        try {
            const opts = typeof question.options === 'string' ? JSON.parse(question.options) : (question.options || {});
            const correct = typeof question.correctAnswer === 'string' ? JSON.parse(question.correctAnswer) : (question.correctAnswer || []);
            const pairsArr = Array.isArray(opts.pairs) ? opts.pairs : (Array.isArray(opts) ? opts : (Array.isArray(correct) ? correct : []));
            const totalPairs = pairsArr.length;
            const matchedArr = Array.isArray(studentParsed) ? studentParsed : (0, exports.parseStringArray)(selectedAnswer);
            if (totalPairs === 0)
                return matchedArr.length > 0;
            return matchedArr.length >= totalPairs;
        }
        catch (_a) {
            return false;
        }
    }
    if (['CROSSWORD', 'COLOR_MATCH', 'IMAGE_LABEL'].includes(question.type)) {
        if (typeof correctParsed === 'object' && !Array.isArray(correctParsed) && correctParsed !== null &&
            typeof studentParsed === 'object' && !Array.isArray(studentParsed) && studentParsed !== null) {
            const correctKeys = Object.keys(correctParsed);
            if (correctKeys.length === 0)
                return false;
            return correctKeys.every(k => cleanStr(correctParsed[k]) === cleanStr(studentParsed[k]));
        }
        return false;
    }
    if (question.type === 'VIDEO_CHECKPOINT') {
        try {
            const correctMap = typeof correctParsed === 'object' ? correctParsed : {};
            const studentCheckpoints = (typeof studentParsed === 'object' && (studentParsed === null || studentParsed === void 0 ? void 0 : studentParsed.answeredCheckpoints))
                ? studentParsed.answeredCheckpoints
                : studentParsed;
            const timeKeys = Object.keys(correctMap);
            if (timeKeys.length === 0)
                return false;
            return timeKeys.every(k => cleanStr(correctMap[k]) === cleanStr(studentCheckpoints === null || studentCheckpoints === void 0 ? void 0 : studentCheckpoints[k]));
        }
        catch (_b) {
            return false;
        }
    }
    if (question.type === 'FLASH_CARD') {
        return cleanStr(studentParsed) === cleanStr(correctParsed);
    }
    if (question.type === 'WORD_SEARCH') {
        return (0, exports.arraysMatch)((0, exports.parseStringArray)(question.correctAnswer), (0, exports.parseStringArray)(selectedAnswer));
    }
    // Handle MCQ or options-based questions
    let optionsArr = [];
    try {
        optionsArr = typeof question.options === 'string'
            ? JSON.parse(question.options || '[]')
            : (Array.isArray(question.options) ? question.options : []);
    }
    catch (_c) {
        optionsArr = [];
    }
    if (Array.isArray(optionsArr) && optionsArr.length > 0) {
        for (let i = 0; i < optionsArr.length; i++) {
            const opt = optionsArr[i];
            const matchesStudent = (0, exports.isOptionMatch)(selectedAnswer, opt, i);
            const matchesCorrect = (0, exports.isOptionMatch)(question.correctAnswer, opt, i);
            if (matchesStudent && matchesCorrect)
                return true;
        }
    }
    if (Array.isArray(correctParsed) && Array.isArray(studentParsed)) {
        return correctParsed.length === studentParsed.length &&
            correctParsed.every((val, i) => cleanStr(val) === cleanStr(studentParsed[i]));
    }
    if (typeof correctParsed === 'object' && !Array.isArray(correctParsed) && correctParsed !== null &&
        typeof studentParsed === 'object' && !Array.isArray(studentParsed) && studentParsed !== null) {
        const correctKeys = Object.keys(correctParsed);
        const studentKeys = Object.keys(studentParsed);
        if (correctKeys.length !== studentKeys.length)
            return false;
        return correctKeys.every(k => cleanStr(correctParsed[k]) === cleanStr(studentParsed[k]));
    }
    return cleanStr(selectedAnswer) === cleanStr(question.correctAnswer) || (0, exports.stripHtmlAndNormalize)(selectedAnswer) === (0, exports.stripHtmlAndNormalize)(question.correctAnswer);
};
exports.isAnswerCorrect = isAnswerCorrect;
exports.GRADE_STAGE_MAP = {
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
exports.GRADE_TRANSLATION_MAP = {
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
const getStudentGradeAndStage = (studentGrade) => {
    if (!studentGrade)
        return [];
    const results = [studentGrade];
    const translated = exports.GRADE_TRANSLATION_MAP[studentGrade];
    if (translated)
        results.push(translated);
    const stage = exports.GRADE_STAGE_MAP[studentGrade] || (translated ? exports.GRADE_STAGE_MAP[translated] : null);
    if (stage)
        results.push(stage);
    return Array.from(new Set(results));
};
exports.getStudentGradeAndStage = getStudentGradeAndStage;
const examMatchesStudent = (exam, user) => {
    var _a;
    if (user && ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user.role))
        return true;
    const gradeTargets = (0, exports.parseStringArray)(exam.grades);
    if (exam.grade)
        gradeTargets.push(exam.grade);
    const uniqueGradeTargets = Array.from(new Set(gradeTargets));
    const studentGrades = (0, exports.getStudentGradeAndStage)(user.grade);
    if (uniqueGradeTargets.length > 0 && !studentGrades.some(g => uniqueGradeTargets.includes(g))) {
        return false;
    }
    if (exam.isCentral)
        return true;
    const belongsToAssignedSchool = (_a = exam.schools) === null || _a === void 0 ? void 0 : _a.some((school) => school.id === user.schoolId);
    const isOwnerSchool = exam.schoolId === user.schoolId;
    return Boolean(isOwnerSchool || belongsToAssignedSchool);
};
exports.examMatchesStudent = examMatchesStudent;
const buildStudentCourseWhere = (student) => {
    var _a;
    const courseWhere = {};
    const studentGrades = (0, exports.getStudentGradeAndStage)(student.grade);
    const orConditions = [{ grade: null }];
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
    }
    else {
        courseWhere.AND = [
            { isCentral: true },
            gradeFilter
        ].filter(filter => Object.keys(filter).length > 0);
    }
    return ((_a = courseWhere.AND) === null || _a === void 0 ? void 0 : _a.length) ? courseWhere : {};
};
exports.buildStudentCourseWhere = buildStudentCourseWhere;
function ensurePerformanceIndexes() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (process.env.SKIP_PERFORMANCE_INDEXES === 'true')
            return;
        const isPostgres = ((_a = process.env.DATABASE_URL) === null || _a === void 0 ? void 0 : _a.startsWith('postgres')) || ((_b = process.env.DATABASE_URL) === null || _b === void 0 ? void 0 : _b.startsWith('postgresql'));
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
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS "SubExam_moduleId_idx" ON "SubExam" ("moduleId")'
        ];
        for (const statement of statements) {
            try {
                const query = isPostgres ? statement : statement.replace(' CONCURRENTLY', '');
                yield prisma_1.default.$executeRawUnsafe(query);
            }
            catch (idxErr) {
                console.warn(`[DB Index Setup] Non-fatal notice: ${idxErr.message}`);
            }
        }
    });
}
function normalizeLegacyCourses() {
    return __awaiter(this, void 0, void 0, function* () {
        const courses = yield prisma_1.default.course.findMany({
            select: { id: true, grade: true, grades: true, isCentral: true }
        });
        for (const course of courses) {
            const updates = {};
            const gradeTargets = (0, exports.parseStringArray)(course.grades);
            if (!course.grade && gradeTargets.length > 0) {
                updates.grade = gradeTargets[0];
            }
            if (course.grade && !course.grades) {
                updates.grades = JSON.stringify([course.grade]);
            }
            if (Object.keys(updates).length > 0) {
                yield prisma_1.default.course.update({ where: { id: course.id }, data: updates });
            }
            yield prisma_1.default.lesson.updateMany({
                where: { courseId: course.id, isCentral: { not: course.isCentral } },
                data: { isCentral: course.isCentral }
            });
        }
    });
}
// Stats Cache to improve performance
exports.statsCache = new Map();
exports.CACHE_TTL = 300 * 1000; // 5 minutes cache
const setCache = (key, data) => {
    if (exports.statsCache.size >= 1000) {
        const firstKey = exports.statsCache.keys().next().value;
        if (firstKey !== undefined) {
            exports.statsCache.delete(firstKey);
        }
    }
    exports.statsCache.set(key, { data, timestamp: Date.now() });
};
exports.setCache = setCache;
const getCache = (key) => {
    const cached = exports.statsCache.get(key);
    if (cached) {
        // 🔒 LRU Cache implementation: Move accessed key to the end of the Map
        exports.statsCache.delete(key);
        exports.statsCache.set(key, cached);
        return cached;
    }
    return undefined;
};
exports.getCache = getCache;
// Simple In-Memory Mutex to prevent double-click submissions (Idempotency)
const locks = new Set();
const acquireLock = (key) => {
    if (locks.has(key))
        return false;
    locks.add(key);
    return true;
};
exports.acquireLock = acquireLock;
const releaseLock = (key) => {
    locks.delete(key);
};
exports.releaseLock = releaseLock;
