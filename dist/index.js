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
require("dotenv/config");
// Backend API for LMS - Modularized entrypoint
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("./lib/prisma"));
const shared_1 = require("./shared");
const backups_1 = require("./routes/backups");
const cronService_1 = require("./services/cronService");
const clean_question_marks_1 = require("./scripts/clean-question-marks");
const auth_1 = require("./middleware/auth");
const runtimeSecurity_1 = require("./lib/runtimeSecurity");
// Import Route Modules
const auth_2 = __importDefault(require("./routes/auth"));
const schools_1 = __importDefault(require("./routes/schools"));
const backups_2 = __importDefault(require("./routes/backups"));
const courses_1 = __importDefault(require("./routes/courses"));
const exams_1 = __importDefault(require("./routes/exams"));
const progress_1 = __importDefault(require("./routes/progress"));
const skillsHub_1 = __importDefault(require("./routes/skillsHub"));
const reports_1 = __importDefault(require("./routes/reports"));
const imports_1 = __importDefault(require("./routes/imports"));
const system_1 = __importDefault(require("./routes/system"));
const deduplicate_1 = __importDefault(require("./routes/deduplicate"));
const app = (0, express_1.default)();
app.set('trust proxy', 1); // Trust local proxies
app.disable('x-powered-by');
const PORT = Number(process.env.PORT) || 5000;
// Override Console to push diagnostic logs
const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};
console.log = (...parts) => {
    (0, shared_1.pushDiagnosticLog)('info', parts);
    originalConsole.log(...parts);
};
console.warn = (...parts) => {
    (0, shared_1.pushDiagnosticLog)('warn', parts);
    originalConsole.warn(...parts);
};
console.error = (...parts) => {
    (0, shared_1.pushDiagnosticLog)('error', parts);
    originalConsole.error(...parts);
};
// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});
// Diagnostic API Request Logger
app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        if (!req.url.startsWith('/api'))
            return;
        const duration = Date.now() - startedAt;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        (0, shared_1.pushDiagnosticLog)(level, [
            `${req.method} ${req.originalUrl}`,
            `${res.statusCode}`,
            `${duration}ms`
        ]);
    });
    next();
});
// Rate Limiting
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', apiLimiter);
// Security & Optimization Middlewares
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: {
        directives: {
            frameAncestors: ["'none'"],
        },
    },
}));
app.use((0, compression_1.default)());
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if ((0, shared_1.isOriginAllowed)(origin, shared_1.allowedOrigins)) {
            return callback(null, true);
        }
        return callback(new Error('CORS origin is not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express_1.default.json({ limit: '100mb' }));
app.use(express_1.default.urlencoded({ limit: '100mb', extended: true }));
app.use((0, cookie_parser_1.default)());
// Serve Uploaded Files with Cache-Control
app.use('/uploads', (req, res, next) => {
    const fileExt = path_1.default.extname(req.path).toLowerCase();
    if (['.png', '.jpg', '.jpeg'].includes(fileExt) && req.accepts('image/webp')) {
        // req.path starts with '/' e.g., '/image.png'
        const webpFilename = req.path.substring(0, req.path.lastIndexOf('.')) + '.webp';
        const webpPath = path_1.default.join(process.cwd(), 'uploads', webpFilename);
        fs_1.default.stat(webpPath, (err, stat) => {
            if (!err && stat.isFile()) {
                // rewrite the url for express.static
                req.url = webpFilename;
            }
            next();
        });
    }
    else {
        next();
    }
});
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads'), {
    maxAge: '30d',
    immutable: true
}));
// Mount Clean Router Modules
app.use(auth_2.default);
app.use(schools_1.default);
app.use(backups_2.default);
app.use(courses_1.default);
app.use(exams_1.default);
app.use(progress_1.default);
app.use(skillsHub_1.default);
app.use(reports_1.default);
app.use(imports_1.default);
app.use(system_1.default);
app.use('/api/deduplicate', deduplicate_1.default);
// Global error handling middleware (must be registered after all route handlers)
app.use((err, req, res, next) => {
    var _a, _b;
    // If headers have already been sent to the client, delegate to the default Express error handler
    if (res.headersSent) {
        return next(err);
    }
    // 1. Client Abort / Connection Closed Prematurely
    if (err.type === 'aborted' ||
        err.code === 'ECONNABORTED' ||
        ((_a = err.message) === null || _a === void 0 ? void 0 : _a.includes('aborted')) ||
        ((_b = err.message) === null || _b === void 0 ? void 0 : _b.includes('connection closed'))) {
        console.warn(`âš ï¸ Request aborted by client: ${req.method} ${req.url} - ${err.message}`);
        return res.status(400).json({
            error: 'Bad Request',
            message: 'Request was aborted or connection was closed prematurely by the client.'
        });
    }
    // 2. JSON Parsing Syntax Error (e.g. invalid JSON sent to express.json())
    if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
        console.warn(`âš ï¸ JSON syntax error from ${req.ip}: ${err.message}`);
        return res.status(400).json({
            error: 'Bad Request',
            message: 'Invalid JSON payload format.'
        });
    }
    // 3. Payload Too Large (e.g. body exceeds the size limit)
    if (err.status === 413 || err.type === 'entity.too.large') {
        console.warn(`âš ï¸ Payload too large from ${req.ip}: ${req.method} ${req.url}`);
        return res.status(413).json({
            error: 'Payload Too Large',
            message: 'The request payload exceeds the allowed size limit.'
        });
    }
    // 4. Default handler for other unhandled errors
    console.error(`âŒ Unhandled Error [${req.method} ${req.url}]:`, err);
    return res.status(err.status || 500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message
    });
});
// Process-level precautions
process.on('uncaughtException', (error) => {
    console.error('ðŸ”¥ CRITICAL: Uncaught Exception:', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('âš ï¸ Unhandled Promise Rejection at:', promise, 'reason:', reason);
});
// Startup data maintenance that is safe to run in production.
function initializeStartupData() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // ðŸ”’ [TOMBSTONE FIX]: Prevented auto-centralization of courses missing schoolId on startup
            // to avoid hiding courses that were temporarily unlinked from a school.
            yield (0, shared_1.normalizeLegacyCourses)();
            // ðŸ”’ SECURITY FIX: Only create superadmin if it does NOT already exist.
            // NEVER use upsert({ update: { password } }) â€” that resets the password on every deploy,
            // undoing any manual password change made in production.
            const existingSuperAdmin = yield prisma_1.default.user.findFirst({
                where: { role: 'SUPER_ADMIN', username: 'superadmin' }
            });
            if (!existingSuperAdmin) {
                const adminPassword = (0, runtimeSecurity_1.requireInitialAdminPassword)(process.env.SUPER_ADMIN_INITIAL_PASSWORD, process.env.NODE_ENV);
                const hashedPassword = yield bcryptjs_1.default.hash(adminPassword, 10);
                yield prisma_1.default.user.create({
                    data: {
                        username: 'superadmin',
                        password: hashedPassword,
                        name: 'Mina Adly (Super Admin)',
                        role: 'SUPER_ADMIN'
                    }
                });
                console.log('âœ… Super admin account created for the first time.');
            }
            else {
                console.log('âœ… Super admin already exists â€” password preserved as-is.');
            }
            const shouldSeedDummyData = process.env.SEED_DUMMY_DATA === 'true';
            const schoolCount = yield prisma_1.default.school.count();
            const courseCount = yield prisma_1.default.course.count();
            const examCount = yield prisma_1.default.exam.count();
            console.log(`Ã°Å¸â€œÅ  Current Database Stats - Schools: ${schoolCount}, Courses: ${courseCount}, Exams: ${examCount}`);
            if (schoolCount === 0 && shouldSeedDummyData) {
                console.log('Ã°Å¸Å’Â± Database is empty of schools. Initiating automatic school data seeding...');
                const schoolsData = [
                    { name: 'Ã™â€¦Ã˜Â¯Ã˜Â±Ã˜Â³Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â±Ã™Ë†Ã˜Â§Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â®Ã˜Â§Ã˜ÂµÃ˜Â© - Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã™â€¡Ã˜Â±Ã˜Â©', subdomain: 'alrowad', themeColor: '#4f46e5' },
                    { name: 'Ã™â€¦Ã˜Â¯Ã˜Â±Ã˜Â³Ã˜Â© Ã˜Â§Ã™â€žÃ™â€ Ã™Å Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã™â€žÃ™Å Ã˜Â© - Ã˜Â§Ã™â€žÃ˜Â´Ã™Å Ã˜Â® Ã˜Â²Ã˜Â§Ã™Å Ã˜Â¯', subdomain: 'nile', themeColor: '#059669' },
                    { name: 'Ã™â€¦Ã˜Â¯Ã˜Â±Ã˜Â³Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã™â€ Ã˜Â§Ã˜Â±Ã˜Â© Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Âª - Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â³Ã™Æ’Ã™â€ Ã˜Â¯Ã˜Â±Ã™Å Ã˜Â©', subdomain: 'almanara', themeColor: '#dc2626' },
                    { name: 'Ã™â€¦Ã˜Â¯Ã˜Â±Ã˜Â³Ã˜Â© Ã˜Â¨Ã™Ë†Ã˜Â±Ã˜Â³Ã˜Â¹Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â«Ã˜Â©', subdomain: 'portsaid', themeColor: '#2563eb' }
                ];
                for (const s of schoolsData) {
                    const school = yield prisma_1.default.school.create({ data: s });
                    // Each seed user gets a unique random password Ã¢â‚¬â€ no shared static Password@123
                    yield prisma_1.default.user.create({ data: { username: `${s.subdomain}_admin`, password: yield bcryptjs_1.default.hash(crypto_1.default.randomBytes(10).toString('hex'), 10), name: `Ã˜Â£/ Ã™â€¦Ã˜Â­Ã™â€¦Ã˜Â¯ Ã˜Â£Ã˜Â­Ã™â€¦Ã˜Â¯ - Ã™â€¦Ã˜Â¯Ã™Å Ã˜Â± ${s.name}`, role: 'SCHOOL_ADMIN', schoolId: school.id } });
                    const teacherNames = ['Ã˜Â£Ã˜Â­Ã™â€¦Ã˜Â¯ Ã™â€¦Ã˜Â­Ã™â€¦Ã™Ë†Ã˜Â¯', 'Ã˜Â³Ã˜Â§Ã˜Â±Ã˜Â© Ã˜Â­Ã˜Â³Ã™â€ ', 'Ã˜Â¥Ã˜Â¨Ã˜Â±Ã˜Â§Ã™â€¡Ã™Å Ã™â€¦ Ã˜Â¹Ã™â€žÃ™Å ', 'Ã™â€¦Ã˜Â±Ã™Å Ã™â€¦ Ã™Å Ã™Ë†Ã˜Â³Ã™Â'];
                    for (let i = 0; i < teacherNames.length; i++) {
                        yield prisma_1.default.user.create({ data: { username: `${s.subdomain}_teacher_${i + 1}`, password: yield bcryptjs_1.default.hash(crypto_1.default.randomBytes(10).toString('hex'), 10), name: `Ã˜Â£/ ${teacherNames[i]}`, role: 'TEACHER', schoolId: school.id } });
                    }
                    const studentNames = ['Ã™Å Ã˜Â§Ã˜Â³Ã™Å Ã™â€  Ã˜Â®Ã˜Â§Ã™â€žÃ˜Â¯', 'Ã˜Â¬Ã™â€ Ã™â€° Ã˜Â¹Ã™â€¦Ã˜Â±Ã™Ë†', 'Ã˜Â¹Ã™â€¦Ã˜Â± Ã˜Â¥Ã™Å Ã™â€¡Ã˜Â§Ã˜Â¨', 'Ã™â€žÃ™Å Ã™â€žÃ™â€° Ã™â€¦Ã˜ÂµÃ˜Â·Ã™ÂÃ™â€°', 'Ã˜Â­Ã™â€¦Ã˜Â²Ã˜Â© Ã™â€¡Ã˜Â§Ã™â€ Ã™Å ', 'Ã™â€ Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â¯Ã™Å Ã™â€ ', 'Ã™ÂÃ˜Â±Ã™Å Ã˜Â¯Ã˜Â© Ã™â€¦Ã˜Â­Ã™â€¦Ã˜Â¯'];
                    const grades = ['Ã˜Â§Ã™â€žÃ˜ÂµÃ™Â Ã˜Â§Ã™â€žÃ˜Â£Ã™Ë†Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â«Ã˜Â§Ã™â€ Ã™Ë†Ã™Å ', 'Ã˜Â§Ã™â€žÃ˜ÂµÃ™Â Ã˜Â§Ã™â€žÃ˜Â«Ã˜Â§Ã™â€ Ã™Å  Ã˜Â§Ã™â€žÃ˜Â«Ã˜Â§Ã™â€ Ã™Ë†Ã™Å ', 'Ã˜Â§Ã™â€žÃ˜ÂµÃ™Â Ã˜Â§Ã™â€žÃ˜Â«Ã˜Â§Ã™â€žÃ˜Â« Ã˜Â§Ã™â€žÃ˜Â«Ã˜Â§Ã™â€ Ã™Ë†Ã™Å '];
                    for (let i = 0; i < studentNames.length; i++) {
                        yield prisma_1.default.user.create({ data: { username: `${s.subdomain}_student_${i + 1}`, password: yield bcryptjs_1.default.hash(crypto_1.default.randomBytes(10).toString('hex'), 10), name: studentNames[i], role: 'STUDENT', schoolId: school.id, grade: grades[i % grades.length] } });
                    }
                }
                console.log('Ã¢Å“â€¦ 4 Schools, Admins, Teachers, and Students seeded successfully.');
            }
            if (courseCount === 0 && shouldSeedDummyData) {
                console.log('Ã°Å¸Å’Â± Database is empty of courses. Initiating automatic course data seeding...');
                const coursesData = [
                    {
                        title: 'Physics - Grade 10',
                        description: 'Detailed explanation of Grade 10 Physics.',
                        subject: 'Physics',
                        grade: 'Grade 10',
                        coverImage: 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?q=80&w=400',
                        lessons: [
                            { title: 'Physical Measurement', order: 1, content: 'Intro to physics.', slides: JSON.stringify([{ id: 1, title: 'Physical Measurement', content: 'Intro' }]), questions: JSON.stringify([]), assignments: JSON.stringify([]) },
                            { title: 'Motion and Speed', order: 2, content: 'Speed and acceleration.', slides: JSON.stringify([{ id: 2, title: 'Motion', content: 'Speed' }]), questions: JSON.stringify([]), assignments: JSON.stringify([]) }
                        ]
                    },
                    {
                        title: 'Chemistry - Grade 10',
                        description: 'Chemistry Grade 10 Semester 1.',
                        subject: 'Chemistry',
                        grade: 'Grade 10',
                        coverImage: 'https://images.unsplash.com/photo-1532187643603-ba119ca4109e?q=80&w=400',
                        lessons: [
                            { title: 'Chemistry and Nanotech', order: 1, content: 'Nanotech.', slides: JSON.stringify([{ id: 1, title: 'Nanotech', content: 'Intro' }]), questions: JSON.stringify([]), assignments: JSON.stringify([]) }
                        ]
                    },
                    {
                        title: 'Arabic - Grade 10',
                        description: 'Full Arabic curriculum.',
                        subject: 'Arabic',
                        grade: 'Grade 10',
                        coverImage: 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?q=80&w=400',
                        lessons: [
                            { title: 'Grammar', order: 1, content: 'Verbs.', slides: JSON.stringify([{ id: 1, title: 'Grammar', content: 'Arabic Grammar' }]), questions: JSON.stringify([]), assignments: JSON.stringify([]) }
                        ]
                    }
                ];
                for (const c of coursesData) {
                    const { lessons } = c, courseFields = __rest(c, ["lessons"]);
                    const course = yield prisma_1.default.course.create({ data: Object.assign(Object.assign({}, courseFields), { isCentral: true, grades: JSON.stringify([c.grade]) }) });
                    for (const l of lessons) {
                        yield prisma_1.default.lesson.create({ data: Object.assign(Object.assign({}, l), { courseId: course.id, isCentral: true, isVisible: true }) });
                    }
                }
                console.log('Ã¢Å“â€¦ 3 Central Courses and Lessons seeded successfully.');
            }
            if (examCount === 0 && shouldSeedDummyData) {
                console.log('Ã°Å¸Å’Â± Database is empty of exams. Initiating automatic exam data seeding...');
                const subjectsList = ['Ã˜Â§Ã™â€žÃ™ÂÃ™Å Ã˜Â²Ã™Å Ã˜Â§Ã˜Â¡', 'Ã˜Â§Ã™â€žÃ™Æ’Ã™Å Ã™â€¦Ã™Å Ã˜Â§Ã˜Â¡', 'Ã˜Â§Ã™â€žÃ™â€žÃ˜ÂºÃ˜Â© Ã˜Â§Ã™â€žÃ˜Â¹Ã˜Â±Ã˜Â¨Ã™Å Ã˜Â©'];
                const gradeTarget = 'Ã˜Â§Ã™â€žÃ˜ÂµÃ™Â Ã˜Â§Ã™â€žÃ˜Â£Ã™Ë†Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â«Ã˜Â§Ã™â€ Ã™Ë†Ã™Å ';
                for (let i = 0; i < subjectsList.length; i++) {
                    const subject = subjectsList[i];
                    yield prisma_1.default.exam.create({ data: { title: `Ã˜Â§Ã™â€¦Ã˜ÂªÃ˜Â­Ã˜Â§Ã™â€  Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â£Ã™Ë†Ã™â€ž - ${subject}`, description: `Ã˜Â§Ã™â€¦Ã˜ÂªÃ˜Â­Ã˜Â§Ã™â€  Ã˜ÂªÃ˜Â¬Ã˜Â±Ã™Å Ã˜Â¨Ã™Å  Ã™â€žÃ˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦ Ã™â€¦Ã˜Â³Ã˜ÂªÃ™Ë†Ã™â€° Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã™ÂÃ™Å  Ã™â€¦Ã˜Â§Ã˜Â¯Ã˜Â© ${subject}.`, category: subject, grade: gradeTarget, duration: 45, passingScore: 50, type: 'Exam', status: 'PUBLISHED', isCentral: true, resultVisibility: 'SHOW_ALL', showAnswers: true, questions: { create: [{ text: `Ã™â€¦Ã˜Â§ Ã™â€¡Ã™Å  Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â­Ã˜Â¯Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â³Ã˜Â§Ã˜Â³Ã™Å Ã˜Â© Ã™â€žÃ™â€šÃ™Å Ã˜Â§Ã˜Â³ Ã˜Â§Ã™â€žÃ™Æ’Ã™â€¦Ã™Å Ã˜Â© Ã˜Â§Ã™â€žÃ™ÂÃ™Å Ã˜Â²Ã™Å Ã˜Â§Ã˜Â¦Ã™Å Ã˜Â© Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™â€ Ã˜Â¸Ã˜Â§Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã™â€žÃ™Å  Ã™â€žÃ˜Â¯Ã˜Â±Ã˜Â³ ${subject}Ã˜Å¸`, type: 'MCQ', options: JSON.stringify(['Ã˜Â§Ã™â€žÃ˜Â®Ã™Å Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â£Ã™Ë†Ã™â€ž', 'Ã˜Â§Ã™â€žÃ˜Â®Ã™Å Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â«Ã˜Â§Ã™â€ Ã™Å ', 'Ã˜Â§Ã™â€žÃ˜Â®Ã™Å Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â«Ã˜Â§Ã™â€žÃ˜Â«', 'Ã˜Â§Ã™â€žÃ˜Â®Ã™Å Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â§Ã˜Â¨Ã˜Â¹']), correctAnswer: 'Ã˜Â§Ã™â€žÃ˜Â®Ã™Å Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â£Ã™Ë†Ã™â€ž', points: 5, skill: 'Ã˜Â§Ã™â€žÃ™ÂÃ™â€¡Ã™â€¦ Ã™Ë†Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â°Ã™Æ’Ã˜Â±', cognitive: 'Understanding', learningOutcome: 'Ã™â€¦Ã˜Â¹Ã˜Â±Ã™ÂÃ˜Â© Ã˜Â£Ã˜Â³Ã˜Â§Ã˜Â³Ã™Å Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€žÃ™â€¦Ã™Å Ã˜Â©', level: 'Medium', order: 1 }, { text: `Ã™â€¡Ã™â€ž Ã˜ÂªÃ˜Â¹Ã˜ÂªÃ˜Â¨Ã˜Â± Ã™â€¡Ã˜Â°Ã™â€¡ Ã˜Â§Ã™â€žÃ™â€¦Ã™ÂÃ˜Â§Ã™â€¡Ã™Å Ã™â€¦ Ã˜ÂµÃ˜Â­Ã™Å Ã˜Â­Ã˜Â© Ã˜Â¹Ã™â€žÃ™â€¦Ã™Å Ã˜Â§Ã™â€¹ Ã˜Â¨Ã˜Â®Ã˜ÂµÃ™Ë†Ã˜Âµ ${subject}Ã˜Å¸`, type: 'TRUE_FALSE', options: JSON.stringify(['Ã˜ÂµÃ˜Â­', 'Ã˜Â®Ã˜Â·Ã˜Â£']), correctAnswer: 'Ã˜ÂµÃ˜Â­', points: 5, skill: 'Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™â€žÃ™Å Ã™â€ž', cognitive: 'Analyzing', learningOutcome: 'Ã˜ÂªÃ˜Â­Ã™â€žÃ™Å Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¨Ã™Å Ã˜Â§Ã™â€ Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â±Ã™Ë†Ã˜Â¶Ã˜Â©', level: 'Easy', order: 2 }] } } });
                }
                console.log('Ã¢Å“â€¦ 3 Central Exams and Questions seeded successfully.');
            }
        }
        catch (error) {
            if (error.code === 'P2002') {
                console.log('âœ… Startup data seeding completed by another cluster instance (P2002).');
            }
            else {
                console.error('âŒ Startup data seeding failed:', error);
            }
        }
    });
}
// Background scheduler to run backups every 1 hour (Egypt time UTC+2)
function startBackupScheduler() {
    const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    const getEgyptTime = () => {
        return new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour12: false });
    };
    const scheduleRepeating = () => {
        console.log(`[Backup Scheduler] â° Next simulated button backup in 1 hour | توقيت مصر الحالي: ${getEgyptTime()}`);
        setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`[Backup Scheduler] ðŸ‘† Simulating click on "إنشاء نسخة جديدة" button | توقيت مصر: ${getEgyptTime()}`);
                // Generate an internal superadmin token to authorize the request
                const jwt = require('jsonwebtoken');
                const token = jwt.sign({ id: 'SYSTEM', role: 'SUPER_ADMIN' }, process.env.JWT_SECRET, { expiresIn: '5m' });
                // Make the EXACT SAME HTTP POST request that the frontend button makes
                const res = yield fetch(`http://localhost:${process.env.PORT || 5000}/api/admin/backup/create`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const json = yield res.json();
                    console.log(`[Backup Scheduler] âœ… Button Backup created automatically: ${json.filename}`);
                }
                else {
                    console.error(`[Backup Scheduler] âŒ Button backup failed with status: ${res.status}`);
                }
            }
            catch (error) {
                console.error('[Backup Scheduler] Button simulation failed:', error.message);
            }
            scheduleRepeating();
        }), BACKUP_INTERVAL_MS);
    };
    scheduleRepeating();
}
// Auto-Recover Empty Courses
function recoverEmptyCourses() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('[Auto-Recovery] Checking for unexpectedly empty courses...');
        try {
            // 1. Get all courses with 0 lessons
            const emptyCourses = yield prisma_1.default.course.findMany({
                where: {
                    lessons: {
                        none: {}
                    }
                },
                select: { id: true, title: true }
            });
            if (emptyCourses.length === 0) {
                console.log('[Auto-Recovery] No empty courses found. All good.');
                return;
            }
            console.log(`[Auto-Recovery] Found ${emptyCourses.length} empty course(s). Checking backups...`);
            // 2. Find latest backup
            const searchDirs = [backups_1.BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
            const backupFiles = [];
            for (const dir of searchDirs) {
                try {
                    if (fs_1.default.existsSync(dir) && fs_1.default.statSync(dir).isDirectory()) {
                        const entries = fs_1.default.readdirSync(dir);
                        for (const file of entries) {
                            if (file.endsWith('.json') && (file.startsWith('backup-') || file.startsWith('backup_'))) {
                                const full = path_1.default.join(dir, file);
                                if (!backupFiles.includes(full))
                                    backupFiles.push(full);
                            }
                        }
                    }
                }
                catch ( /* skip */_a) { /* skip */ }
            }
            if (backupFiles.length === 0) {
                console.log('[Auto-Recovery] No backup files found to recover from.');
                return;
            }
            backupFiles.sort((a, b) => path_1.default.basename(b).localeCompare(path_1.default.basename(a)));
            // We only check the most recent 5 backups to avoid ancient restorations
            const recentBackups = backupFiles.slice(0, 5);
            let restoredCoursesCount = 0;
            for (const emptyCourse of emptyCourses) {
                let restored = false;
                for (const bFile of recentBackups) {
                    if (restored)
                        break;
                    try {
                        const content = fs_1.default.readFileSync(bFile, 'utf-8');
                        const backupObj = JSON.parse(content);
                        const data = backupObj.data || backupObj;
                        const backupLessons = Array.isArray(data.lesson) ? data.lesson : [];
                        // Find lessons belonging to this course in the backup
                        const courseLessons = backupLessons.filter((l) => l.courseId === emptyCourse.id);
                        if (courseLessons.length > 0) {
                            console.log(`[Auto-Recovery] Course '${emptyCourse.title}' was empty. Found ${courseLessons.length} lessons in backup ${path_1.default.basename(bFile)}. Restoring...`);
                            yield prisma_1.default.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                                var _a, _b;
                                for (const lesson of courseLessons) {
                                    const lessonData = Object.assign(Object.assign({}, lesson), { createdAt: new Date(lesson.createdAt), updatedAt: new Date(lesson.updatedAt), publishDate: lesson.publishDate ? new Date(lesson.publishDate) : null, cutOffDate: lesson.cutOffDate ? new Date(lesson.cutOffDate) : null });
                                    yield tx.lesson.upsert({
                                        where: { id: lesson.id },
                                        update: lessonData,
                                        create: lessonData
                                    });
                                    const lessonBlocks = Array.isArray(data.lessonBlock) ? data.lessonBlock.filter((b) => b.lessonId === lesson.id) : [];
                                    for (const block of lessonBlocks) {
                                        const blockData = {
                                            lessonId: block.lessonId,
                                            type: block.type,
                                            content: (_a = block.content) !== null && _a !== void 0 ? _a : null,
                                            order: (_b = block.order) !== null && _b !== void 0 ? _b : 0,
                                            createdAt: block.createdAt ? new Date(block.createdAt) : new Date(),
                                            updatedAt: block.updatedAt ? new Date(block.updatedAt) : new Date()
                                        };
                                        yield tx.lessonBlock.upsert({
                                            where: { id: block.id },
                                            update: blockData,
                                            create: Object.assign({ id: block.id }, blockData)
                                        });
                                    }
                                }
                            }), { timeout: 60000 });
                            console.log(`[Auto-Recovery] Successfully restored ${courseLessons.length} lessons for '${emptyCourse.title}'.`);
                            restored = true;
                            restoredCoursesCount++;
                        }
                    }
                    catch (err) {
                        // Silently ignore malformed backups, we check the next one
                    }
                }
            }
            if (restoredCoursesCount > 0) {
                console.log(`[Auto-Recovery] Completed. Restored data for ${restoredCoursesCount} course(s).`);
            }
            else {
                console.log(`[Auto-Recovery] Checked backups but found no previous data for the empty courses.`);
            }
        }
        catch (error) {
            console.error('[Auto-Recovery] Error during auto-recovery process:', error.message);
        }
    });
}
// SAT-MATH SCHOOL RECOVERY
function recoverSATMathSchool() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const SAT_PATTERNS = ['SAT-MATH', 'SAT_MATH', 'SAT-Math', 'sat-math', 'sat_math'];
        console.log('[SAT Recovery] Checking for SAT-MATH school in database...');
        try {
            const existingSchool = yield prisma_1.default.school.findFirst({
                where: {
                    OR: [
                        { name: { contains: 'SAT-MATH' } },
                        { name: { contains: 'SAT_MATH' } },
                        { name: { contains: 'SAT-Math' } },
                        { name: { contains: 'sat-math' } },
                        { name: { contains: 'sat_math' } }
                    ]
                }
            });
            if (existingSchool) {
                console.log(`[SAT Recovery] SAT-MATH school found in DB: "${existingSchool.name}" (id: ${existingSchool.id}). No recovery needed.`);
                return;
            }
            console.log('[SAT Recovery] SAT-MATH school NOT found in DB. Searching backup files...');
            const searchDirs = [backups_1.BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
            const backupFiles = [];
            for (const dir of searchDirs) {
                try {
                    if (fs_1.default.existsSync(dir) && fs_1.default.statSync(dir).isDirectory()) {
                        const entries = fs_1.default.readdirSync(dir);
                        for (const file of entries) {
                            if (file.endsWith('.json') && (file.startsWith('backup-') || file.startsWith('backup_') || file.includes('backup'))) {
                                const full = path_1.default.join(dir, file);
                                if (!backupFiles.includes(full))
                                    backupFiles.push(full);
                            }
                        }
                    }
                }
                catch ( /* skip */_d) { /* skip */ }
            }
            backupFiles.sort((a, b) => path_1.default.basename(b).localeCompare(path_1.default.basename(a)));
            console.log(`[SAT Recovery] Found ${backupFiles.length} backup file(s) to scan.`);
            for (const bFile of backupFiles) {
                try {
                    const content = fs_1.default.readFileSync(bFile, 'utf-8');
                    const backupObj = JSON.parse(content);
                    const data = backupObj.data || backupObj;
                    const schools = Array.isArray(data.school) ? data.school : [];
                    const satSchool = schools.find((s) => SAT_PATTERNS.some(p => typeof s.name === 'string' && s.name.toLowerCase().includes(p.toLowerCase())));
                    if (!satSchool)
                        continue;
                    console.log(`[SAT Recovery] Found SAT-MATH school in backup: ${path_1.default.basename(bFile)}`);
                    const doubleCheck = yield prisma_1.default.school.findUnique({ where: { id: satSchool.id } });
                    if (doubleCheck)
                        return;
                    yield prisma_1.default.school.create({
                        data: {
                            id: satSchool.id,
                            name: satSchool.name,
                            subdomain: (_a = satSchool.subdomain) !== null && _a !== void 0 ? _a : undefined,
                            themeColor: (_b = satSchool.themeColor) !== null && _b !== void 0 ? _b : null,
                            status: (_c = satSchool.status) !== null && _c !== void 0 ? _c : 'ACTIVE',
                            createdAt: satSchool.createdAt ? new Date(satSchool.createdAt) : new Date(),
                            updatedAt: satSchool.updatedAt ? new Date(satSchool.updatedAt) : new Date()
                        }
                    });
                    console.log(`[SAT Recovery] School "${satSchool.name}" restored to DB.`);
                    const schoolUsers = Array.isArray(data.user)
                        ? data.user.filter((u) => u.schoolId === satSchool.id)
                        : [];
                    let restoredUsers = 0;
                    for (const u of schoolUsers) {
                        try {
                            const exists = yield prisma_1.default.user.findUnique({ where: { id: u.id } });
                            if (!exists) {
                                yield prisma_1.default.user.create({
                                    data: Object.assign(Object.assign({}, u), { createdAt: new Date(u.createdAt), updatedAt: new Date(u.updatedAt) })
                                });
                                restoredUsers++;
                            }
                        }
                        catch (ue) {
                            console.warn(`   Could not restore user ${u.id}: ${ue.message}`);
                        }
                    }
                    if (restoredUsers > 0)
                        console.log(`[SAT Recovery] Restored ${restoredUsers} user(s).`);
                }
                catch (e) {
                    console.error(`   Error scanning backup ${path_1.default.basename(bFile)}:`, e.message);
                }
            }
        }
        catch (error) {
            console.error('[SAT Recovery] Error during recovery process:', error.message);
        }
    });
}
// Auto-Recover specific missing lesson
function autoRecoverSpecificLesson() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const LESSON_TITLE = "Adding , subtracting, multiplying and dividing whole numbers";
        console.log(`[Auto-Recovery] Checking for missing lesson: "${LESSON_TITLE}"`);
        try {
            const existingLesson = yield prisma_1.default.lesson.findFirst({
                where: {
                    title: {
                        contains: "whole numbers",
                        mode: 'insensitive'
                    }
                }
            });
            if (existingLesson && existingLesson.title.includes('subtracting')) {
                console.log(`[Auto-Recovery] Lesson already exists in DB (ID: ${existingLesson.id}). No recovery needed.`);
                return;
            }
            console.log(`[Auto-Recovery] Lesson not found in DB. Searching backups...`);
            // 1. Check local backups first
            const searchDirs = [backups_1.BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
            const backupFiles = [];
            for (const dir of searchDirs) {
                try {
                    if (fs_1.default.existsSync(dir) && fs_1.default.statSync(dir).isDirectory()) {
                        const entries = fs_1.default.readdirSync(dir);
                        for (const file of entries) {
                            if (file.endsWith('.json') && (file.startsWith('backup-') || file.startsWith('backup_'))) {
                                const full = path_1.default.join(dir, file);
                                if (!backupFiles.includes(full))
                                    backupFiles.push(full);
                            }
                        }
                    }
                }
                catch ( /* skip */_b) { /* skip */ }
            }
            let targetLesson = null;
            backupFiles.sort((a, b) => path_1.default.basename(b).localeCompare(path_1.default.basename(a)));
            for (const bFile of backupFiles) {
                if (targetLesson)
                    break;
                try {
                    const content = fs_1.default.readFileSync(bFile, 'utf-8');
                    const backupObj = JSON.parse(content);
                    const data = backupObj.data || backupObj;
                    const backupLessons = Array.isArray(data.lesson) ? data.lesson : [];
                    const found = backupLessons.find((l) => l.title === LESSON_TITLE || (l.title && l.title.includes('subtracting, multiplying') && l.title.includes('whole numbers')));
                    if (found) {
                        console.log(`[Auto-Recovery] Found lesson in local backup: ${path_1.default.basename(bFile)}`);
                        targetLesson = found;
                    }
                }
                catch (err) { }
            }
            // 2. If not found locally, check Cloud Backups
            if (!targetLesson) {
                console.log(`[Auto-Recovery] Not found locally. Checking Cloud Backups...`);
                try {
                    const { getCloudBackups } = require('./lib/db-backup');
                    const cloudRecords = yield getCloudBackups();
                    if (cloudRecords && cloudRecords.length > 0) {
                        for (const record of cloudRecords) {
                            if (targetLesson)
                                break;
                            const data = ((_a = record.data) === null || _a === void 0 ? void 0 : _a.data) || record.data;
                            const backupLessons = Array.isArray(data === null || data === void 0 ? void 0 : data.lesson) ? data.lesson : [];
                            const found = backupLessons.find((l) => l.title === LESSON_TITLE || (l.title && l.title.includes('subtracting, multiplying') && l.title.includes('whole numbers')));
                            if (found) {
                                console.log(`[Auto-Recovery] Found lesson in Cloud Backup from ${record.created_at}`);
                                targetLesson = found;
                            }
                        }
                    }
                }
                catch (err) {
                    console.warn(`[Auto-Recovery] Failed to search Cloud Backup:`, err.message);
                }
            }
            if (!targetLesson) {
                console.log(`[Auto-Recovery] Lesson "${LESSON_TITLE}" could not be found in any local or cloud backup.`);
                return;
            }
            // 3. Restore the lesson
            const existingCourse = yield prisma_1.default.course.findUnique({ where: { id: targetLesson.courseId } });
            if (!existingCourse) {
                console.warn(`[Auto-Recovery] Parent course (${targetLesson.courseId}) is missing. Cannot restore lesson without course.`);
                return;
            }
            yield prisma_1.default.lesson.upsert({
                where: { id: targetLesson.id },
                update: Object.assign(Object.assign({}, targetLesson), { updatedAt: new Date(), publishDate: targetLesson.publishDate ? new Date(targetLesson.publishDate) : null, cutOffDate: targetLesson.cutOffDate ? new Date(targetLesson.cutOffDate) : null }),
                create: Object.assign(Object.assign({}, targetLesson), { createdAt: new Date(targetLesson.createdAt), updatedAt: new Date(), publishDate: targetLesson.publishDate ? new Date(targetLesson.publishDate) : null, cutOffDate: targetLesson.cutOffDate ? new Date(targetLesson.cutOffDate) : null })
            });
            console.log(`[Auto-Recovery] âœ… Successfully restored lesson "${targetLesson.title}" to course "${existingCourse.title}"!`);
        }
        catch (error) {
            console.error('[Auto-Recovery] Error recovering specific lesson:', error.message);
        }
    });
}
// Keep Cloud Backup Awake and Sync Missing Courses
/* function startCloudBackupKeepAlive() {
  console.log('ðŸ”„ Started Cloud Backup Keep-Alive service (ping every 5 minutes)');
  // 5 minutes = 300,000 ms
  setInterval(() => {
    keepCloudBackupAlive();
    // USER REQUEST: Do not merge Cloud Backup data back into PostgreSQL automatically
    // syncMissingCloudCourses().catch(e => console.error('[Auto-Sync] Error:', e.message));
  }, 5 * 60 * 1000);
} */
const startServer = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('ðŸ“¡ Testing database connection...');
        yield prisma_1.default.$connect();
        console.log('âœ… Database connected successfully!');
    }
    catch (error) {
        console.error('âŒ Database connection failed:', error.message);
    }
    app.get('/api/run-cleanup-duplicate-questions', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const exams = yield prisma_1.default.exam.findMany({ select: { id: true, title: true } });
            let totalDeleted = 0;
            for (const exam of exams) {
                const questions = yield prisma_1.default.question.findMany({ where: { examId: exam.id }, orderBy: { createdAt: 'asc' } });
                const seenText = new Set();
                const duplicatesIds = [];
                for (const q of questions) {
                    const normalized = (q.text || '').trim().toLowerCase();
                    const signature = `${normalized}::${q.options}`;
                    if (seenText.has(signature))
                        duplicatesIds.push(q.id);
                    else
                        seenText.add(signature);
                }
                if (duplicatesIds.length > 0) {
                    const deleted = yield prisma_1.default.question.deleteMany({ where: { id: { in: duplicatesIds } } });
                    totalDeleted += deleted.count;
                }
            }
            res.json({ success: true, message: `Cleanup complete. Deleted ${totalDeleted} duplicates across all exams.` });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    }));
    app.get('/api/run-cleanup-question-marks', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield (0, clean_question_marks_1.cleanQuestionMarks)();
            res.json({ success: true, message: 'Cleaned corrupted question marks successfully.' });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    }));
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`ðŸš€ LMS Backend running on port ${PORT}`);
        // âš¡ CRITICAL FIX: Defer ALL heavy startup tasks by 30 seconds.
        // This ensures the healthcheck passes immediately and prevents Bad Gateway (502) loops.
        // Dokploy/Nginx will see the server as "healthy" right away, then heavy tasks run in background.
        setTimeout(() => {
            console.log('â³ [Deferred Startup] Starting background initialization tasks...');
            // Cron jobs & schedulers (lightweight to register, heavy to execute later)
            // startBackupScheduler(); // Removed to prevent duplicate hourly backups with cronService
            (0, cronService_1.initCronJobs)();
            // Auto-recover missing slides (Disabled â€” completed its job)
            // autoRecoverMissingSlides().catch((e: any) => console.error('[Auto-Recover-Slides]:', e.message));
            console.log('✅ [Deferred Startup] All background tasks launched.');
        }, 30000); // 30 seconds delay — safely after healthcheck passes
    });
    // In PM2 cluster mode, only Worker #0 runs startup DDL and data initialization
    const isPrimaryWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    if (isPrimaryWorker) {
        (0, shared_1.ensurePerformanceIndexes)()
            .then(() => console.log('✅ Performance indexes are ready'))
            .catch((error) => console.error('⚠️ Performance index setup failed:', error.message));
        initializeStartupData()
            .then(() => console.log('✅ Startup data initialized'))
            .catch((error) => console.error('⚠️ Startup data initialization failed:', error.message));
    }
    else {
        console.log(`[Startup] PM2 worker #${process.env.NODE_APP_INSTANCE} online — deferred tasks & DDL handled by worker #0.`);
    }
});
// Graceful shutdown handling
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('SIGTERM signal received: closing HTTP server');
    yield prisma_1.default.$disconnect();
    process.exit(0);
}));
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('SIGINT signal received: closing HTTP server');
    yield prisma_1.default.$disconnect();
    process.exit(0);
}));
startServer();
