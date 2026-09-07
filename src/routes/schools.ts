import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import { requireInitialAdminPassword } from '../lib/runtimeSecurity';
import {
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields,
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses
} from '../shared';
import { BACKUPS_DIR } from './backups';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const router = Router();

// --- Extracted from lines 681-996 ---
router.post('/api/admin/users/bulk', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), async (req: Request, res: Response) => {
  try {
    const { users } = req.body as { users: any[] };
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'users array is required and must not be empty.' });
    }
    if (users.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 users per bulk import.' });
    }

    const results: { success: any[]; errors: any[] } = { success: [], errors: [] };

    for (const u of users) {
      if (!u.name || !u.username) {
        results.errors.push({ row: u, error: 'name and username are required' });
        continue;
      }
      try {
        // Generate a unique random temp password per user (not a shared static default)
        const plainPwd = u.password || crypto.randomBytes(10).toString('hex');
        const hashedPassword = await bcrypt.hash(plainPwd, 10);
        const created = await prisma.user.create({
          data: {
            name: String(u.name).trim(),
            username: String(u.username).trim(),
            email: u.email ? String(u.email).trim() : undefined,
            password: hashedPassword,
            role: u.role && ['STUDENT', 'TEACHER', 'PARENT'].includes(u.role.toUpperCase()) ? u.role.toUpperCase() : 'STUDENT',
            grade: u.grade ? String(u.grade).trim() : undefined,
            phone: u.phone ? String(u.phone).trim() : undefined,
            gender: u.gender && ['MALE', 'FEMALE'].includes(u.gender.toUpperCase()) ? u.gender.toUpperCase() : undefined,
            schoolId: u.schoolId || (req.user?.role === 'SCHOOL_ADMIN' ? req.user?.schoolId : undefined)
          }
        });
        // Return the temp password only if it was auto-generated (so admin can share it)
        const tempPwd = u.password ? undefined : plainPwd;
        results.success.push({ id: created.id, username: created.username, name: created.name, tempPassword: tempPwd });
      } catch (err: any) {
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
  } catch (err: any) {
    return res.status(500).json({ error: 'Bulk import failed', details: err.message });
  }
});

// Global error handler for uncaught exceptions in async routes
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Startup data maintenance that is safe to run in production.
async function initializeStartupData() {
  try {
    // Quick fix for existing data: 
    // Ensure any course without schoolId is treated as central if not already
    await prisma.course.updateMany({
      where: {
        schoolId: null,
        isCentral: false
      },
      data: {
        isCentral: true
      }
    });
    await normalizeLegacyCourses();

    // 🔒 SECURITY FIX: Only create superadmin if it does NOT already exist.
    // NEVER use upsert({ update: { password } }) — that resets the password on every deploy.
    const existingSuperAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', username: 'superadmin' }
    });
    if (!existingSuperAdmin) {
      const adminPassword = requireInitialAdminPassword(
        process.env.SUPER_ADMIN_INITIAL_PASSWORD,
        process.env.NODE_ENV,
      );
      const hashedAdminPassword = await bcrypt.hash(adminPassword, 10);
      await prisma.user.create({
        data: {
          username: 'superadmin',
          password: hashedAdminPassword,
          name: 'Mina Adly (Super Admin)',
          role: 'SUPER_ADMIN'
        }
      });
      console.log('✅ Super admin account created for the first time.');
    } else {
      console.log('✅ Super admin already exists — password preserved as-is.');
    }
    // Password used for seeding demo schools/users (safe default for test data)
    const seedPwd = crypto.randomBytes(10).toString('hex');
    const hashedPassword = await bcrypt.hash(seedPwd, 10);
    // Automatic Database Seeder: independent checks for absolute safety
    const schoolCount = await prisma.school.count();
    const courseCount = await prisma.course.count();
    const examCount = await prisma.exam.count();

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
        const school = await prisma.school.create({ data: s });
        schools.push(school);

        // Create School Admin
        await prisma.user.create({
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
          await prisma.user.create({
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
          await prisma.user.create({
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
        const { lessons, ...courseFields } = c;
        const course = await prisma.course.create({
          data: {
            ...courseFields,
            isCentral: true,
            grades: JSON.stringify([c.grade])
          }
        });

        // Add Lessons to Course
        for (const l of lessons) {
          await prisma.lesson.create({
            data: {
              ...l,
              courseId: course.id,
              isCentral: true,
              isVisible: true
            }
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

        await prisma.exam.create({
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
  } catch (error) {
    console.error('[Startup] Startup data maintenance failed:', error);
  }
}

// initializeStartupData is handled exclusively by Worker #0 in index.ts


// --- Extracted from lines 1168-1983 ---
router.post('/api/admin/schools', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { name, subdomain, adminName, adminUsername, adminPassword } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'اسم المدرسة مطلوب.' });
    }

    // Create school and admin in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: name.trim(),
          subdomain: subdomain ? subdomain.trim().toLowerCase() : undefined
        }
      });

      let admin = null;
      if (adminUsername && adminPassword) {
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        admin = await tx.user.create({
          data: {
            name: adminName || `مدير ${name}`,
            username: adminUsername,
            password: hashedPassword,
            role: 'SCHOOL_ADMIN',
            schoolId: school.id
          }
        });
      }
      return { school, admin: sanitizeUser(admin) };
    });

    res.json({ message: 'School and Admin created successfully', ...result });
  } catch (error: any) {
    console.error('❌ School creation error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'اسم المستخدم هذا موجود مسبقاً.' });
    }
    res.status(500).json({ error: 'Error creating school and admin' });
  }
});

router.get('/api/admin/schools', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    // Fetch ALL schools without pagination to always show the complete list
    const schools = await prisma.school.findMany({
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
    const [studentCounts, teacherCounts, parentCounts] = await Promise.all([
      prisma.user.groupBy({ by: ['schoolId'], where: { schoolId: { in: schoolIds }, role: 'STUDENT' }, _count: true }),
      prisma.user.groupBy({ by: ['schoolId'], where: { schoolId: { in: schoolIds }, role: 'TEACHER' }, _count: true }),
      prisma.user.groupBy({ by: ['schoolId'], where: { schoolId: { in: schoolIds }, role: 'PARENT' }, _count: true }),
    ]);

    const studentMap = Object.fromEntries(studentCounts.map((r: any) => [r.schoolId, r._count]));
    const teacherMap = Object.fromEntries(teacherCounts.map((r: any) => [r.schoolId, r._count]));
    const parentMap = Object.fromEntries(parentCounts.map((r: any) => [r.schoolId, r._count]));

    const result = schools.map(school => ({
      ...school,
      stats: {
        students: studentMap[school.id] || 0,
        teachers: teacherMap[school.id] || 0,
        parents: parentMap[school.id] || 0,
        admins: school.users.length,
        classrooms: school._count.classrooms
      }
    }));

    // Return as array directly so frontend works with both formats
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching schools' });
  }
});

// Update School
router.put('/api/admin/schools/:id', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const school = await prisma.school.update({
      where: { id },
      data: { name }
    });
    res.json({ message: 'School updated', school });
  } catch (error) {
    res.status(500).json({ error: 'Error updating school' });
  }
});

// Delete School (with full cascade for users and classrooms)
router.delete('/api/admin/schools/:id', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { id } = req.params;

    // Step 1: Detach all users from classrooms in this school first (to avoid FK conflicts)
    await prisma.user.updateMany({
      where: { school: { id }, classroomId: { not: null } },
      data: { classroomId: null }
    });

    // Step 2: Nullify parentId references that point to users in this school
    const schoolUserIds = (await prisma.user.findMany({
      where: { schoolId: id },
      select: { id: true }
    })).map(u => u.id);

    if (schoolUserIds.length > 0) {
      await prisma.user.updateMany({
        where: { parentId: { in: schoolUserIds } },
        data: { parentId: null }
      });
    }

    // Step 3: Delete all users belonging to this school
    await prisma.user.deleteMany({ where: { schoolId: id } });

    // Step 4: Classrooms will be cascade deleted by Prisma (onDelete: Cascade on Classroom->School)
    // Step 5: Delete the school itself
    await prisma.school.delete({ where: { id } });

    res.json({ message: 'School and all related data deleted successfully' });
  } catch (error: any) {
    console.error('Delete school error:', error);
    res.status(500).json({ error: 'Error deleting school: ' + (error.message || 'Unknown error') });
  }
});

// Manage Users Globally (Create School Admin or Student)
router.post('/api/admin/users', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), checkSchoolAccess, async (req: any, res: any) => {
  try {
    const { name, username, password, role, schoolId, grade } = req.body;
    const missing = hasRequiredFields(req.body, ['name', 'username', 'password', 'role']);
    if (missing) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    if (!ALL_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }

    // Security: School admin can only create teachers or students in their own school
    if (req.user.role === 'SCHOOL_ADMIN') {
      if (!SCHOOL_MANAGED_ROLES.includes(role)) {
        return res.status(403).json({ error: 'غير مسموح لك بإنشاء مستخدمين بهذه الصلاحية.' });
      }
      req.body.schoolId = req.user.schoolId;
    } else if ((role === 'SCHOOL_ADMIN' || SCHOOL_MANAGED_ROLES.includes(role)) && !schoolId) {
      return res.status(400).json({ error: 'schoolId is required for this role.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
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
      select: userSafeSelect
    });
    res.json({ message: 'User created', user });
  } catch (error: any) {
    console.error('❌ User creation error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً، يرجى اختيار اسم مستخدم آخر.' });
    }
    res.status(500).json({ error: error.message || 'Error creating user' });
  }
});

// List All Users (Filtered by school/role if provided)
router.get('/api/admin/users', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), checkSchoolAccess, async (req: any, res: any) => {
  try {
    const { schoolId, role, page = '1', limit = '50', search } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    // ✅ Filter out soft-deleted users
    const where: any = { deletedAt: null };
    
    if (req.user.role === 'SUPER_ADMIN') {
      if (schoolId) where.schoolId = schoolId as string;
      if (role) where.role = role as string;
    } else {
      where.schoolId = req.user.schoolId;
      if (role && role !== 'SUPER_ADMIN') where.role = role as string;
      else where.role = { not: 'SUPER_ADMIN' };
    }

    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { name: { contains: search as string, mode: 'insensitive' } },
            { username: { contains: search as string, mode: 'insensitive' } },
            { phone: { contains: search as string, mode: 'insensitive' } }
          ]
        }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        select: userSafeSelect,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    const mappedUsers = users.map(u => ({
      ...u,
      subject: u.specialization || ""
    }));

    res.json({
      users: mappedUsers,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    console.error('❌ Fetch users error:', error);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

// Update User
router.put('/api/admin/users/:id', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN']), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { name, username, password, schoolId, role, grade } = req.body;

    // Security check for School Admin
    if (req.user.role === 'SCHOOL_ADMIN') {
      const existingUser = await prisma.user.findUnique({ where: { id } });
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

    const data: any = {
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
        const currentUser = await prisma.user.findUnique({ where: { id } });
        if (!currentUser) return res.status(404).json({ error: 'المستخدم غير موجود' });
        
        const isMatch = await bcrypt.compare(oldPassword, currentUser.password);
        if (!isMatch) {
          return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
        }
      }
      data.password = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: userSafeSelect
    });
    res.json({ message: 'User updated successfully', user });
  } catch (error: any) {
    console.error('❌ User update error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'اسم المستخدم هذا مسجل مسبقاً.' });
    }
    res.status(500).json({ error: 'Error updating user' });
  }
});

// Delete User (Soft Delete)
router.delete('/api/admin/users/:id', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const userToDelete = await prisma.user.findUnique({ where: { id } });
    if (userToDelete?.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'لا يمكن حذف حساب السوبر أدمن.' });
    }

    // Security check for School Admin
    if (req.user.role === 'SCHOOL_ADMIN') {
      if (!userToDelete || userToDelete.schoolId !== req.user.schoolId) {
        return res.status(403).json({ error: 'غير مسموح لك بحذف مستخدم خارج مدرستك.' });
      }
    }

    // Soft Delete
    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
    res.json({ message: 'User moved to trash successfully' });
  } catch (error) {
    console.error('❌ User deletion error:', error);
    res.status(500).json({ error: 'Error deleting user' });
  }
});

// Get Super Admin Stats
router.get(['/api/admin/stats', '/api/super-admin/stats'], verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    // Run all counts in parallel for maximum speed
    const [totalSchools, totalUsers, totalStudents, totalTeachers, totalCourses, totalClassrooms, totalParents, activeStudents, activeExams, centralExamsCount, recentSchoolsData, allSchools] = await Promise.all([
      prisma.school.count(),
      prisma.user.count(),
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.user.count({ where: { role: 'TEACHER' } }),
      prisma.course.count({ where: { isCentral: true } }),
      prisma.classroom.count(),
      prisma.user.count({ where: { role: 'PARENT' } }),
      prisma.user.count({ where: { role: 'STUDENT', OR: [{ studentEnrollments: { some: {} } }, { examSubmissions: { some: {} } }] } }),
      prisma.exam.count({ where: { status: 'PUBLISHED' } }),
      prisma.exam.count({ where: { isCentral: true } }),
      prisma.school.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { users: { where: { role: 'STUDENT' } } } }
        }
      }),
      prisma.school.findMany({
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
  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(500).json({ error: 'Error fetching statistics' });
  }
});

// Impersonate User (Super Admin only)
router.post('/api/admin/impersonate/:id', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      include: { school: true }
    });

    if (!user || user.deletedAt) return res.status(404).json({ error: 'User not found or deleted' });

    // Generate token for the target user
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        schoolId: user.schoolId,
        grade: user.grade,
        isImpersonated: true,
        adminId: req.user.id // Store who impersonated
      },
      JWT_SECRET,
      { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as any } // Match standard expiry
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
        schoolName: user.school?.name,
        grade: user.grade,
        avatar: user.avatar
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Impersonation failed', details: error.message });
  }
});

// Stop Impersonation & Restore Admin Session
router.post('/api/admin/stop-impersonate', verifyToken, async (req: any, res: any) => {
  try {
    if (!req.user?.isImpersonated || !req.user?.adminId) {
      return res.status(400).json({ error: 'No active impersonation session found.' });
    }

    const admin = await prisma.user.findUnique({
      where: { id: req.user.adminId }
    });

    if (!admin || admin.status !== 'ACTIVE' || admin.deletedAt) {
      return res.status(403).json({ error: 'Original admin account not available or inactive.' });
    }

    const adminToken = jwt.sign(
      { id: admin.id, role: admin.role, schoolId: admin.schoolId, grade: admin.grade },
      JWT_SECRET,
      { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as any }
    );

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
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to restore admin session', details: error.message });
  }
});

// Get Detailed School Stats
router.get('/api/admin/schools/:id/stats', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    if ((req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'TEACHER') && id !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const students = await prisma.user.count({ where: { schoolId: id, role: 'STUDENT' } });
    const teachers = await prisma.user.count({ where: { schoolId: id, role: 'TEACHER' } });
    const parents = await prisma.user.count({ where: { schoolId: id, role: 'PARENT' } });
    const classrooms = await prisma.classroom.count({ where: { schoolId: id } });
    const exams = await prisma.exam.count({ where: { schoolId: id } });

    res.json({
      students,
      teachers,
      parents,
      classrooms,
      exams
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching school stats' });
  }
});

router.get('/api/admin/diagnostics', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const sampleLimit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);
    const [
      schoolsCount,
      usersCount,
      coursesCount,
      lessonsCount,
      examsCount,
      lessonBlocksCount,
      dynamicSectionsCount,
      activityLogsCount,
      submissionsCount,
      schools,
      users,
      courses,
      lessons,
      exams,
      lessonBlocks,
      dynamicSections,
      submissions
    ] = await Promise.all([
      prisma.school.count(),
      prisma.user.count(),
      prisma.course.count(),
      prisma.lesson.count(),
      prisma.exam.count(),
      prisma.lessonBlock.count(),
      prisma.dynamicSection.count(),
      prisma.activityLog.count(),
      prisma.examSubmission.count(),
      prisma.school.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, subdomain: true, status: true, createdAt: true, updatedAt: true } }),
      prisma.user.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, username: true, role: true, status: true, schoolId: true, createdAt: true, updatedAt: true } }),
      prisma.course.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, grade: true, subject: true, schoolId: true, isCentral: true, createdAt: true, updatedAt: true } }),
      prisma.lesson.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, courseId: true, title: true, order: true, isVisible: true, publishDate: true, cutOffDate: true, questions: true, assignments: true, slides: true, updatedAt: true } }),
      prisma.exam.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, type: true, schoolId: true, courseId: true, status: true, createdAt: true, updatedAt: true } }),
      prisma.lessonBlock.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, lessonId: true, type: true, title: true, order: true, isVisible: true, createdAt: true, updatedAt: true } }),
      prisma.dynamicSection.findMany({ take: sampleLimit, orderBy: { updatedAt: 'desc' }, select: { id: true, blockId: true, type: true, order: true, createdAt: true, updatedAt: true } }),
      prisma.examSubmission.findMany({ take: sampleLimit, orderBy: { createdAt: 'desc' }, select: { id: true, examId: true, userId: true, totalScore: true, percentage: true, totalTime: true, createdAt: true } })
    ]);

    const backupFiles = fs.readdirSync(BACKUPS_DIR)
      .filter(file => (file.startsWith('backup-') || file.startsWith('backup_')) && file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(BACKUPS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime
        };
      })
      .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime())
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
      logs: diagnosticLogs.slice(-sampleLimit * 5),
      errors: diagnosticLogs.filter(entry => entry.level === 'error').slice(-sampleLimit * 5)
    });
  } catch (error: any) {
    console.error('❌ Diagnostics error:', error);
    res.status(500).json({ error: 'Failed to fetch diagnostics', details: error.message });
  }
});

router.post('/api/admin/log-error', async (req: any, res: any) => {
  try {
    const { level = 'error', message, details } = req.body;
    if (message) {
      pushDiagnosticLog(level as any, [`[Frontend] ${message}`, details]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log error' });
  }
});


export default router;
