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
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middleware/auth");
const runtimeSecurity_1 = require("../lib/runtimeSecurity");
const shared_1 = require("../shared");
const backups_1 = require("./backups");
const router = (0, express_1.Router)();
// --- Extracted from lines 681-996 ---
router.post('/api/admin/users/bulk', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { users } = req.body;
        if (!Array.isArray(users) || users.length === 0) {
            return res.status(400).json({ error: 'users array is required and must not be empty.' });
        }
        if (users.length > 500) {
            return res.status(400).json({ error: 'Maximum 500 users per bulk import.' });
        }
        const results = { success: [], errors: [] };
        for (const u of users) {
            if (!u.name || !u.username) {
                results.errors.push({ row: u, error: 'name and username are required' });
                continue;
            }
            try {
                // Generate a unique random temp password per user (not a shared static default)
                const plainPwd = u.password || crypto_1.default.randomBytes(10).toString('hex');
                const hashedPassword = yield bcryptjs_1.default.hash(plainPwd, 10);
                const created = yield prisma_1.default.user.create({
                    data: {
                        name: String(u.name).trim(),
                        username: String(u.username).trim(),
                        email: u.email ? String(u.email).trim() : undefined,
                        password: hashedPassword,
                        role: u.role && ['STUDENT', 'TEACHER', 'PARENT'].includes(u.role.toUpperCase()) ? u.role.toUpperCase() : 'STUDENT',
                        grade: u.grade ? String(u.grade).trim() : undefined,
                        phone: u.phone ? String(u.phone).trim() : undefined,
                        gender: u.gender && ['MALE', 'FEMALE'].includes(u.gender.toUpperCase()) ? u.gender.toUpperCase() : undefined,
                        schoolId: u.schoolId || (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) === 'SCHOOL_ADMIN' ? (_b = req.user) === null || _b === void 0 ? void 0 : _b.schoolId : undefined)
                    }
                });
                // Return the temp password only if it was auto-generated (so admin can share it)
                const tempPwd = u.password ? undefined : plainPwd;
                results.success.push({ id: created.id, username: created.username, name: created.name, tempPassword: tempPwd });
            }
            catch (err) {
                const msg = err.code === 'P2002' ? `Username or email already exists` : err.message;
                results.errors.push({ row: u, error: msg });
            }
        }
        return res.json({
            message: `Bulk import complete: ${results.success.length} created, ${results.errors.length} failed.`,
            created: results.success.length,
            failed: results.errors.length,
            errors: results.errors
        });
    }
    catch (err) {
        return res.status(500).json({ error: 'Bulk import failed', details: err.message });
    }
}));
// Global error handler for uncaught exceptions in async routes
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
// Startup data maintenance that is safe to run in production.
function initializeStartupData() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Quick fix for existing data: 
            // Ensure any course without schoolId is treated as central if not already
            yield prisma_1.default.course.updateMany({
                where: {
                    schoolId: null,
                    isCentral: false
                },
                data: {
                    isCentral: true
                }
            });
            yield (0, shared_1.normalizeLegacyCourses)();
            // 🔒 SECURITY FIX: Only create superadmin if it does NOT already exist.
            // NEVER use upsert({ update: { password } }) — that resets the password on every deploy.
            const existingSuperAdmin = yield prisma_1.default.user.findFirst({
                where: { role: 'SUPER_ADMIN', username: 'superadmin' }
            });
            if (!existingSuperAdmin) {
                const adminPassword = (0, runtimeSecurity_1.requireInitialAdminPassword)(process.env.SUPER_ADMIN_INITIAL_PASSWORD, process.env.NODE_ENV);
                const hashedAdminPassword = yield bcryptjs_1.default.hash(adminPassword, 10);
                yield prisma_1.default.user.create({
                    data: {
                        username: 'superadmin',
                        password: hashedAdminPassword,
                        name: 'Mina Adly (Super Admin)',
                        role: 'SUPER_ADMIN'
                    }
                });
                console.log('✅ Super admin account created for the first time.');
            }
            else {
                console.log('✅ Super admin already exists — password preserved as-is.');
            }
            // Password used for seeding demo schools/users (safe default for test data)
            const seedPwd = crypto_1.default.randomBytes(10).toString('hex');
            const hashedPassword = yield bcryptjs_1.default.hash(seedPwd, 10);
            // Automatic Database Seeder: independent checks for absolute safety
            const schoolCount = yield prisma_1.default.school.count();
            const courseCount = yield prisma_1.default.course.count();
            const examCount = yield prisma_1.default.exam.count();
            console.log(`📊 Current Database Stats - Schools: ${schoolCount}, Courses: ${courseCount}, Exams: ${examCount}`);
            // 1. Seed Schools & School-Specific Users if empty of schools
            if (schoolCount === 0) {
                console.log('🌱 Database is empty of schools. Initiating automatic school data seeding...');
                // 1. Create Schools
                const schoolsData = [
                    { name: 'مدرسة الرواد الخاصة - القاهرة', subdomain: 'alrowad', themeColor: '#4f46e5' },
                    { name: 'مدرسة النيل الدولية - الشيخ زايد', subdomain: 'nile', themeColor: '#059669' },
                    { name: 'مدرسة المنارة لغات - الإسكندرية', subdomain: 'almanara', themeColor: '#dc2626' },
                    { name: 'مدرسة بورسعيد الحديثة', subdomain: 'portsaid', themeColor: '#2563eb' }
                ];
                const schools = [];
                for (const s of schoolsData) {
                    const school = yield prisma_1.default.school.create({ data: s });
                    schools.push(school);
                    // Create School Admin
                    yield prisma_1.default.user.create({
                        data: {
                            username: `${s.subdomain}_admin`,
                            password: hashedPassword,
                            name: `أ/ محمد أحمد - مدير ${s.name}`,
                            role: 'SCHOOL_ADMIN',
                            schoolId: school.id
                        }
                    });
                    // Create Teachers
                    const teacherNames = ['أحمد محمود', 'سارة حسن', 'إبراهيم علي', 'مريم يوسف'];
                    for (let i = 0; i < teacherNames.length; i++) {
                        yield prisma_1.default.user.create({
                            data: {
                                username: `${s.subdomain}_teacher_${i + 1}`,
                                password: hashedPassword,
                                name: `أ/ ${teacherNames[i]}`,
                                role: 'TEACHER',
                                schoolId: school.id
                            }
                        });
                    }
                    // Create Students
                    const studentNames = ['ياسين خالد', 'جنى عمرو', 'عمر إيهاب', 'ليلى مصطفى', 'حمزة هاني', 'نور الدين', 'فريدة محمد'];
                    const grades = ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];
                    for (let i = 0; i < studentNames.length; i++) {
                        yield prisma_1.default.user.create({
                            data: {
                                username: `${s.subdomain}_student_${i + 1}`,
                                password: hashedPassword,
                                name: studentNames[i],
                                role: 'STUDENT',
                                schoolId: school.id,
                                grade: grades[i % grades.length]
                            }
                        });
                    }
                }
                console.log('✅ 4 Schools, Admins, Teachers, and Students seeded successfully.');
            }
            // 2. Seed Central Courses if empty of courses
            if (courseCount === 0) {
                console.log('🌱 Database is empty of courses. Initiating automatic course data seeding...');
                // Create Central Courses with Lessons
                const coursesData = [
                    {
                        title: 'الفيزياء للصف الأول الثانوي',
                        description: 'شرح مفصل لمنهج الفيزياء للصف الأول الثانوي الترم الأول.',
                        subject: 'الفيزياء',
                        grade: 'الصف الأول الثانوي',
                        coverImage: 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?q=80&w=400',
                        lessons: [
                            {
                                title: 'القياس الفيزيائي والكميات القياسية والمتجهة',
                                order: 1,
                                content: 'مقدمة في علم الفيزياء والقياس الفيزيائي ووحدات القياس.',
                                slides: JSON.stringify([{ id: 1, title: 'القياس الفيزيائي', content: 'أهمية القياس في علم الفيزياء وعناصره الأساسية.' }]),
                                questions: JSON.stringify([]),
                                assignments: JSON.stringify([])
                            },
                            {
                                title: 'الحركة في خط مستقيم والسرعة والعجلة',
                                order: 2,
                                content: 'شرح مفهوم الحركة والفرق بين السرعة والسرعة المتجهة والعجلة.',
                                slides: JSON.stringify([{ id: 2, title: 'الحركة والسرعة', content: 'قوانين الحركة والسرعة المنتظمة وغير المنتظمة.' }]),
                                questions: JSON.stringify([]),
                                assignments: JSON.stringify([])
                            }
                        ]
                    },
                    {
                        title: 'الكيمياء للصف الأول الثانوي',
                        description: 'شرح مفصل لمنهج الكيمياء للصف الأول الثانوي الترم الأول.',
                        subject: 'الكيمياء',
                        grade: 'الصف الأول الثانوي',
                        coverImage: 'https://images.unsplash.com/photo-1532187643603-ba119ca4109e?q=80&w=400',
                        lessons: [
                            {
                                title: 'الكيمياء والقياس والنانوتكنولوجي',
                                order: 1,
                                content: 'الكيمياء كمركز للعلوم وأهمية القياس والتعرف على تكنولوجيا النانو.',
                                slides: JSON.stringify([{ id: 1, title: 'النانوتكنولوجي', content: 'مقدمة في النانو كيمياء وأهميتها وتطبيقاتها.' }]),
                                questions: JSON.stringify([]),
                                assignments: JSON.stringify([])
                            }
                        ]
                    },
                    {
                        title: 'اللغة العربية للصف الأول الثانوي',
                        description: 'منهج اللغة العربية الكامل متضمناً النحو والبلاغة والنصوص والأدب.',
                        subject: 'اللغة العربية',
                        grade: 'الصف الأول الثانوي',
                        coverImage: 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?q=80&w=400',
                        lessons: [
                            {
                                title: 'النحو: الأفعال الناقصة والتامة (كان وأخواتها)',
                                order: 1,
                                content: 'شرح درس كان وأخواتها وحالات تمامها ونقصانها بالأمثلة.',
                                slides: JSON.stringify([{ id: 1, title: 'كان وأخواتها', content: 'قواعد النحو العربي للصف الأول الثانوي.' }]),
                                questions: JSON.stringify([]),
                                assignments: JSON.stringify([])
                            }
                        ]
                    }
                ];
                for (const c of coursesData) {
                    const { lessons } = c, courseFields = __rest(c, ["lessons"]);
                    const course = yield prisma_1.default.course.create({
                        data: Object.assign(Object.assign({}, courseFields), { isCentral: true, grades: JSON.stringify([c.grade]) })
                    });
                    // Add Lessons to Course
                    for (const l of lessons) {
                        yield prisma_1.default.lesson.create({
                            data: Object.assign(Object.assign({}, l), { courseId: course.id, isCentral: true, isVisible: true })
                        });
                    }
                }
                console.log('✅ 3 Central Courses and Lessons seeded successfully.');
            }
            // 3. Seed Central Exams if empty of exams
            if (examCount === 0) {
                console.log('🌱 Database is empty of exams. Initiating automatic exam data seeding...');
                // Create Sample Exams with realistic questions
                const subjectsList = ['الفيزياء', 'الكيمياء', 'اللغة العربية'];
                const gradeTarget = 'الصف الأول الثانوي';
                for (let i = 0; i < subjectsList.length; i++) {
                    const subject = subjectsList[i];
                    const title = `امتحان التقييم الأول - ${subject}`;
                    yield prisma_1.default.exam.create({
                        data: {
                            title: title,
                            description: `امتحان تجريبي لتقييم مستوى الطلاب في مادة ${subject}.`,
                            category: subject,
                            grade: gradeTarget,
                            duration: 45,
                            passingScore: 50,
                            type: 'Exam',
                            status: 'PUBLISHED',
                            isCentral: true,
                            resultVisibility: 'SHOW_ALL',
                            showAnswers: true,
                            questions: {
                                create: [
                                    {
                                        text: `ما هي الوحدة الأساسية لقياس الكمية الفيزيائية في النظام الدولي لدرس ${subject}؟`,
                                        type: 'MCQ',
                                        options: JSON.stringify(['الخيار الأول', 'الخيار الثاني', 'الخيار الثالث', 'الخيار الرابع']),
                                        correctAnswer: 'الخيار الأول',
                                        points: 5,
                                        skill: 'الفهم والتذكر',
                                        cognitive: 'Understanding',
                                        learningOutcome: 'معرفة أساسيات المادة العلمية',
                                        level: 'Medium',
                                        order: 1
                                    },
                                    {
                                        text: `هل تعتبر هذه المفاهيم صحيحة علمياً بخصوص ${subject}؟`,
                                        type: 'TRUE_FALSE',
                                        options: JSON.stringify(['صح', 'خطأ']),
                                        correctAnswer: 'صح',
                                        points: 5,
                                        skill: 'التحليل',
                                        cognitive: 'Analyzing',
                                        learningOutcome: 'تحليل البيانات المعروضة',
                                        level: 'Easy',
                                        order: 2
                                    }
                                ]
                            }
                        }
                    });
                }
                console.log('✅ 3 Central Exams and Questions seeded successfully.');
                console.log('🌱 Database auto-seeding completed successfully!');
            }
        }
        catch (error) {
            console.error('[Startup] Startup data maintenance failed:', error);
        }
    });
}
// initializeStartupData is handled exclusively by Worker #0 in index.ts
// --- Extracted from lines 1168-1983 ---
router.post('/api/admin/schools', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, subdomain, adminName, adminUsername, adminPassword } = req.body;
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'اسم المدرسة مطلوب.' });
        }
        // Create school and admin in a transaction
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const school = yield tx.school.create({
                data: {
                    name: name.trim(),
                    subdomain: subdomain ? subdomain.trim().toLowerCase() : undefined
                }
            });
            let admin = null;
            if (adminUsername && adminPassword) {
                const hashedPassword = yield bcryptjs_1.default.hash(adminPassword, 10);
                admin = yield tx.user.create({
                    data: {
                        name: adminName || `مدير ${name}`,
                        username: adminUsername,
                        password: hashedPassword,
                        role: 'SCHOOL_ADMIN',
                        schoolId: school.id
                    }
                });
            }
            return { school, admin: (0, shared_1.sanitizeUser)(admin) };
        }));
        res.json(Object.assign({ message: 'School and Admin created successfully' }, result));
    }
    catch (error) {
        console.error('❌ School creation error:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'اسم المستخدم هذا موجود مسبقاً.' });
        }
        res.status(500).json({ error: 'Error creating school and admin' });
    }
}));
router.get('/api/admin/schools', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Fetch ALL schools without pagination to always show the complete list
        const schools = yield prisma_1.default.school.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: {
                        users: true,
                        classrooms: true
                    }
                },
                users: {
                    where: { role: 'SCHOOL_ADMIN', deletedAt: null },
                    select: { id: true, name: true, username: true, role: true }
                }
            }
        });
        // Use parallel count queries for role stats
        const schoolIds = schools.map(s => s.id);
        const [studentCounts, teacherCounts, parentCounts] = yield Promise.all([
            prisma_1.default.user.groupBy({ by: ['schoolId'], where: { schoolId: { in: schoolIds }, role: 'STUDENT' }, _count: true }),
            prisma_1.default.user.groupBy({ by: ['schoolId'], where: { schoolId: { in: schoolIds }, role: 'TEACHER' }, _count: true }),
            prisma_1.default.user.groupBy({ by: ['schoolId'], where: { schoolId: { in: schoolIds }, role: 'PARENT' }, _count: true }),
        ]);
        const studentMap = Object.fromEntries(studentCounts.map((r) => [r.schoolId, r._count]));
        const teacherMap = Object.fromEntries(teacherCounts.map((r) => [r.schoolId, r._count]));
        const parentMap = Object.fromEntries(parentCounts.map((r) => [r.schoolId, r._count]));
        const result = schools.map(school => (Object.assign(Object.assign({}, school), { stats: {
                students: studentMap[school.id] || 0,
                teachers: teacherMap[school.id] || 0,
                parents: parentMap[school.id] || 0,
                admins: school.users.length,
                classrooms: school._count.classrooms
            } })));
        // Return as array directly so frontend works with both formats
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching schools' });
    }
}));
// Update School
router.put('/api/admin/schools/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const school = yield prisma_1.default.school.update({
            where: { id },
            data: { name }
        });
        res.json({ message: 'School updated', school });
    }
    catch (error) {
        res.status(500).json({ error: 'Error updating school' });
    }
}));
// Delete School (with full cascade for users and classrooms)
router.delete('/api/admin/schools/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        // Step 1: Detach all users from classrooms in this school first (to avoid FK conflicts)
        yield prisma_1.default.user.updateMany({
            where: { school: { id }, classroomId: { not: null } },
            data: { classroomId: null }
        });
        // Step 2: Nullify parentId references that point to users in this school
        const schoolUserIds = (yield prisma_1.default.user.findMany({
            where: { schoolId: id },
            select: { id: true }
        })).map(u => u.id);
        if (schoolUserIds.length > 0) {
            yield prisma_1.default.user.updateMany({
                where: { parentId: { in: schoolUserIds } },
                data: { parentId: null }
            });
        }
        // Step 3: Delete all users belonging to this school
        yield prisma_1.default.user.deleteMany({ where: { schoolId: id } });
        // Step 4: Classrooms will be cascade deleted by Prisma (onDelete: Cascade on Classroom->School)
        // Step 5: Delete the school itself
        yield prisma_1.default.school.delete({ where: { id } });
        res.json({ message: 'School and all related data deleted successfully' });
    }
    catch (error) {
        console.error('Delete school error:', error);
        res.status(500).json({ error: 'Error deleting school: ' + (error.message || 'Unknown error') });
    }
}));
// Manage Users Globally (Create School Admin or Student)
router.post('/api/admin/users', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), auth_1.checkSchoolAccess, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, username, password, role, schoolId, grade } = req.body;
        const missing = (0, shared_1.hasRequiredFields)(req.body, ['name', 'username', 'password', 'role']);
        if (missing) {
            return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
        }
        if (!shared_1.ALL_ROLES.includes(role)) {
            return res.status(400).json({ error: 'Invalid role.' });
        }
        // Security: School admin can only create teachers or students in their own school
        if (req.user.role === 'SCHOOL_ADMIN') {
            if (!shared_1.SCHOOL_MANAGED_ROLES.includes(role)) {
                return res.status(403).json({ error: 'غير مسموح لك بإنشاء مستخدمين بهذه الصلاحية.' });
            }
            req.body.schoolId = req.user.schoolId;
        }
        else if ((role === 'SCHOOL_ADMIN' || shared_1.SCHOOL_MANAGED_ROLES.includes(role)) && !schoolId) {
            return res.status(400).json({ error: 'schoolId is required for this role.' });
        }
        const hashedPassword = yield bcryptjs_1.default.hash(password, 10);
        const user = yield prisma_1.default.user.create({
            data: {
                name,
                username,
                password: hashedPassword,
                role,
                schoolId: req.user.role === 'SCHOOL_ADMIN' ? req.user.schoolId : schoolId,
                grade,
                phone: req.body.phone,
                status: req.body.status || "ACTIVE",
                avatar: req.body.avatar,
                gender: req.body.gender,
                address: req.body.address,
                specialization: req.body.specialization || req.body.subject,
                classroomId: req.body.classroomId || null,
                parentId: req.body.parentId || null
            },
            select: shared_1.userSafeSelect
        });
        res.json({ message: 'User created', user });
    }
    catch (error) {
        console.error('❌ User creation error:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً، يرجى اختيار اسم مستخدم آخر.' });
        }
        res.status(500).json({ error: error.message || 'Error creating user' });
    }
}));
// List All Users (Filtered by school/role if provided)
router.get('/api/admin/users', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), auth_1.checkSchoolAccess, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { schoolId, role, page = '1', limit = '50', search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);
        // ✅ Filter out soft-deleted users
        const where = { deletedAt: null };
        if (req.user.role === 'SUPER_ADMIN') {
            if (schoolId)
                where.schoolId = schoolId;
            if (role)
                where.role = role;
        }
        else {
            where.schoolId = req.user.schoolId;
            if (role && role !== 'SUPER_ADMIN')
                where.role = role;
            else
                where.role = { not: 'SUPER_ADMIN' };
        }
        if (search) {
            where.AND = [
                ...(where.AND || []),
                {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { username: { contains: search, mode: 'insensitive' } },
                        { phone: { contains: search, mode: 'insensitive' } }
                    ]
                }
            ];
        }
        const [users, total] = yield Promise.all([
            prisma_1.default.user.findMany({
                where,
                skip,
                take,
                select: shared_1.userSafeSelect,
                orderBy: { createdAt: 'desc' }
            }),
            prisma_1.default.user.count({ where })
        ]);
        const mappedUsers = users.map(u => (Object.assign(Object.assign({}, u), { subject: u.specialization || "" })));
        res.json({
            users: mappedUsers,
            pagination: {
                total,
                page: parseInt(page),
                limit: take,
                totalPages: Math.ceil(total / take)
            }
        });
    }
    catch (error) {
        console.error('❌ Fetch users error:', error);
        res.status(500).json({ error: 'Error fetching users' });
    }
}));
// Update User
router.put('/api/admin/users/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, username, password, schoolId, role, grade } = req.body;
        // Security check for School Admin
        if (req.user.role === 'SCHOOL_ADMIN') {
            const existingUser = yield prisma_1.default.user.findUnique({ where: { id } });
            if (!existingUser || existingUser.schoolId !== req.user.schoolId) {
                return res.status(403).json({ error: 'غير مسموح لك بتعديل بيانات مستخدم خارج مدرستك.' });
            }
            if (role && role !== existingUser.role) {
                return res.status(403).json({ error: 'غير مسموح لك بتغيير صلاحيات المستخدمين.' });
            }
            if (existingUser.role === 'SUPER_ADMIN') {
                return res.status(403).json({ error: 'غير مسموح لك بتعديل هذا المستخدم.' });
            }
        }
        const data = {
            name,
            username,
            schoolId: req.user.role === 'SCHOOL_ADMIN' ? req.user.schoolId : schoolId,
            role: req.user.role === 'SCHOOL_ADMIN' ? undefined : role,
            grade,
            phone: req.body.phone,
            status: req.body.status,
            specialization: req.body.specialization || req.body.subject,
            avatar: req.body.avatar,
            gender: req.body.gender,
            address: req.body.address,
            classroomId: req.body.classroomId,
            parentId: req.body.parentId
        };
        if (password) {
            if (req.user.id === id) {
                const { oldPassword } = req.body;
                if (!oldPassword) {
                    return res.status(400).json({ error: 'كلمة المرور الحالية مطلوبة.' });
                }
                const currentUser = yield prisma_1.default.user.findUnique({ where: { id } });
                if (!currentUser)
                    return res.status(404).json({ error: 'المستخدم غير موجود' });
                const isMatch = yield bcryptjs_1.default.compare(oldPassword, currentUser.password);
                if (!isMatch) {
                    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
                }
            }
            data.password = yield bcryptjs_1.default.hash(password, 10);
        }
        const user = yield prisma_1.default.user.update({
            where: { id },
            data,
            select: shared_1.userSafeSelect
        });
        res.json({ message: 'User updated successfully', user });
    }
    catch (error) {
        console.error('❌ User update error:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً.' });
        }
        res.status(500).json({ error: 'Error updating user' });
    }
}));
// Delete User (Soft Delete)
router.delete('/api/admin/users/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const userToDelete = yield prisma_1.default.user.findUnique({ where: { id } });
        if ((userToDelete === null || userToDelete === void 0 ? void 0 : userToDelete.role) === 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'لا يمكن حذف حساب السوبر أدمن.' });
        }
        // Security check for School Admin
        if (req.user.role === 'SCHOOL_ADMIN') {
            if (!userToDelete || userToDelete.schoolId !== req.user.schoolId) {
                return res.status(403).json({ error: 'غير مسموح لك بحذف مستخدم خارج مدرستك.' });
            }
        }
        // Soft Delete
        yield prisma_1.default.user.update({
            where: { id },
            data: { deletedAt: new Date() }
        });
        res.json({ message: 'User moved to trash successfully' });
    }
    catch (error) {
        console.error('❌ User deletion error:', error);
        res.status(500).json({ error: 'Error deleting user' });
    }
}));
// Get Super Admin Stats
router.get(['/api/admin/stats', '/api/super-admin/stats'], auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Run all counts in parallel for maximum speed
        const [totalSchools, totalUsers, totalStudents, totalTeachers, totalCourses, totalClassrooms, totalParents, activeStudents, activeExams, centralExamsCount, recentSchoolsData, allSchools] = yield Promise.all([
            prisma_1.default.school.count(),
            prisma_1.default.user.count(),
            prisma_1.default.user.count({ where: { role: 'STUDENT' } }),
            prisma_1.default.user.count({ where: { role: 'TEACHER' } }),
            prisma_1.default.course.count({ where: { isCentral: true } }),
            prisma_1.default.classroom.count(),
            prisma_1.default.user.count({ where: { role: 'PARENT' } }),
            prisma_1.default.user.count({ where: { role: 'STUDENT', OR: [{ studentEnrollments: { some: {} } }, { examSubmissions: { some: {} } }] } }),
            prisma_1.default.exam.count({ where: { status: 'PUBLISHED' } }),
            prisma_1.default.exam.count({ where: { isCentral: true } }),
            prisma_1.default.school.findMany({
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: {
                    _count: { select: { users: { where: { role: 'STUDENT' } } } }
                }
            }),
            prisma_1.default.school.findMany({
                include: { _count: { select: { users: { where: { role: 'STUDENT' } } } } }
            })
        ]);
        const interactionRate = totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 100) : 0;
        const recentSchools = recentSchoolsData.map(s => ({
            id: s.id,
            name: s.name,
            students: s._count.users,
            status: s.status,
            type: 'مدرسة' // or logic based on grade if exists
        }));
        const schoolPerformanceData = allSchools
            .map(s => ({
            name: s.name,
            students: s._count.users,
            growth: 0
        }))
            .sort((a, b) => b.students - a.students)
            .slice(0, 5);
        res.json({
            schoolsCount: totalSchools,
            usersCount: totalUsers,
            studentsCount: totalStudents,
            teachersCount: totalTeachers,
            coursesCount: totalCourses,
            interactionRate,
            classroomsCount: totalClassrooms,
            parentsCount: totalParents,
            activeExams,
            centralExamsCount,
            recentSchools,
            schoolPerformanceData
        });
    }
    catch (error) {
        console.error('❌ Stats error:', error);
        res.status(500).json({ error: 'Error fetching statistics' });
    }
}));
// Impersonate User (Super Admin only)
router.post('/api/admin/impersonate/:id', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const user = yield prisma_1.default.user.findUnique({
            where: { id },
            include: { school: true }
        });
        if (!user || user.deletedAt)
            return res.status(404).json({ error: 'User not found or deleted' });
        // Generate token for the target user
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            role: user.role,
            schoolId: user.schoolId,
            grade: user.grade,
            isImpersonated: true,
            adminId: req.user.id // Store who impersonated
        }, shared_1.JWT_SECRET, { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') } // Match standard expiry
        );
        // Set httpOnly cookie for impersonated session
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 8 * 60 * 60 * 1000,
            path: '/'
        });
        res.json({
            message: `Impersonating ${user.name}`,
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                schoolId: user.schoolId,
                schoolName: (_a = user.school) === null || _a === void 0 ? void 0 : _a.name,
                grade: user.grade,
                avatar: user.avatar
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Impersonation failed', details: error.message });
    }
}));
// Stop Impersonation & Restore Admin Session
router.post('/api/admin/stop-impersonate', auth_1.verifyToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.isImpersonated) || !((_b = req.user) === null || _b === void 0 ? void 0 : _b.adminId)) {
            return res.status(400).json({ error: 'No active impersonation session found.' });
        }
        const admin = yield prisma_1.default.user.findUnique({
            where: { id: req.user.adminId }
        });
        if (!admin || admin.status !== 'ACTIVE' || admin.deletedAt) {
            return res.status(403).json({ error: 'Original admin account not available or inactive.' });
        }
        const adminToken = jsonwebtoken_1.default.sign({ id: admin.id, role: admin.role, schoolId: admin.schoolId, grade: admin.grade }, shared_1.JWT_SECRET, { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') });
        res.cookie('auth_token', adminToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: 8 * 60 * 60 * 1000,
            path: '/'
        });
        res.json({
            message: 'Impersonation ended. Restored admin session.',
            user: {
                id: admin.id,
                name: admin.name,
                role: admin.role,
                schoolId: admin.schoolId
            }
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to restore admin session', details: error.message });
    }
}));
// Get Detailed School Stats
router.get('/api/admin/schools/:id/stats', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        if ((req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'TEACHER') && id !== req.user.schoolId) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const students = yield prisma_1.default.user.count({ where: { schoolId: id, role: 'STUDENT' } });
        const teachers = yield prisma_1.default.user.count({ where: { schoolId: id, role: 'TEACHER' } });
        const parents = yield prisma_1.default.user.count({ where: { schoolId: id, role: 'PARENT' } });
        const classrooms = yield prisma_1.default.classroom.count({ where: { schoolId: id } });
        const exams = yield prisma_1.default.exam.count({ where: { schoolId: id } });
        res.json({
            students,
            teachers,
            parents,
            classrooms,
            exams
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching school stats' });
    }
}));
router.get('/api/admin/diagnostics', auth_1.verifyToken, (0, auth_1.checkRole)(['SUPER_ADMIN']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const sampleLimit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
        const [schoolsCount, usersCount, coursesCount, lessonsCount, examsCount, lessonBlocksCount, dynamicSectionsCount, activityLogsCount, submissionsCount, schools, users, courses, lessons, exams, lessonBlocks, dynamicSections, submissions] = yield Promise.all([
            prisma_1.default.school.count(),
            prisma_1.default.user.count(),
            prisma_1.default.course.count(),
            prisma_1.default.lesson.count(),
            prisma_1.default.exam.count(),
            prisma_1.default.lessonBlock.count(),
            prisma_1.default.dynamicSection.count(),
            prisma_1.default.activityLog.count(),
            prisma_1.default.examSubmission.count(),
            prisma_1.default.school.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, subdomain: true, status: true, createdAt: true, updatedAt: true } }),
            prisma_1.default.user.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, username: true, role: true, status: true, schoolId: true, createdAt: true, updatedAt: true } }),
            prisma_1.default.course.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, grade: true, subject: true, schoolId: true, isCentral: true, createdAt: true, updatedAt: true } }),
            prisma_1.default.lesson.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, courseId: true, title: true, order: true, isVisible: true, publishDate: true, cutOffDate: true, questions: true, assignments: true, slides: true, updatedAt: true } }),
            prisma_1.default.exam.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, type: true, schoolId: true, courseId: true, status: true, createdAt: true, updatedAt: true } }),
            prisma_1.default.lessonBlock.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, lessonId: true, type: true, title: true, order: true, isVisible: true, createdAt: true, updatedAt: true } }),
            prisma_1.default.dynamicSection.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, blockId: true, type: true, order: true, createdAt: true, updatedAt: true } }),
            prisma_1.default.examSubmission.findMany({ take: sampleLimit, orderBy: { createdAt: 'desc' }, select: { id: true, examId: true, userId: true, totalScore: true, percentage: true, totalTime: true, createdAt: true } })
        ]);
        const backupFiles = fs_1.default.readdirSync(backups_1.BACKUPS_DIR)
            .filter(file => (file.startsWith('backup-') || file.startsWith('backup_')) && file.endsWith('.json'))
            .map(file => {
            const filePath = path_1.default.join(backups_1.BACKUPS_DIR, file);
            const stats = fs_1.default.statSync(filePath);
            return {
                filename: file,
                size: stats.size,
                createdAt: stats.birthtime || stats.mtime
            };
        })
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, sampleLimit);
        res.json({
            ok: true,
            server: {
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                nodeEnv: process.env.NODE_ENV || 'development',
                memory: process.memoryUsage()
            },
            counts: {
                schools: schoolsCount,
                users: usersCount,
                courses: coursesCount,
                lessons: lessonsCount,
                exams: examsCount,
                lessonBlocks: lessonBlocksCount,
                dynamicSections: dynamicSectionsCount,
                activityLogs: activityLogsCount,
                examSubmissions: submissionsCount
            },
            samples: {
                schools,
                users,
                courses,
                lessons,
                exams,
                lessonBlocks,
                dynamicSections,
                submissions,
                backupFiles
            },
            logs: shared_1.diagnosticLogs.slice(-sampleLimit * 5),
            errors: shared_1.diagnosticLogs.filter(entry => entry.level === 'error').slice(-sampleLimit * 5)
        });
    }
    catch (error) {
        console.error('❌ Diagnostics error:', error);
        res.status(500).json({ error: 'Failed to fetch diagnostics', details: error.message });
    }
}));
router.post('/api/admin/log-error', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { level = 'error', message, details } = req.body;
        if (message) {
            (0, shared_1.pushDiagnosticLog)(level, [`[Frontend] ${message}`, details]);
        }
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to log error' });
    }
}));
exports.default = router;
