const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seeding...');
  const seedPassword = process.env.SEED_USER_PASSWORD || process.env.INITIAL_SUPER_ADMIN_PASSWORD;
  if (!seedPassword) {
    throw new Error('SEED_USER_PASSWORD or INITIAL_SUPER_ADMIN_PASSWORD is required for seeding users');
  }

  // Cleanup
  await prisma.user.deleteMany({});
  await prisma.classroom.deleteMany({});
  await prisma.school.deleteMany({});

  const password = await bcrypt.hash(seedPassword, 10);

  // 1. Create Schools
  const school1 = await prisma.school.create({
    data: {
      name: 'مدرسة الابتكارية الدولية',
      subdomain: 'ebtekaria',
      status: 'ACTIVE',
    },
  });

  const school2 = await prisma.school.create({
    data: {
      name: 'مدرسة المستقبل الحديثة',
      subdomain: 'future',
      status: 'ACTIVE',
    },
  });

  // 2. Create Super Admin
  await prisma.user.create({
    data: {
      name: 'Super Admin',
      username: 'superadmin',
      password,
      role: 'SUPER_ADMIN',
    },
  });

  // 3. Create School Admins
  await prisma.user.create({
    data: {
      name: 'مدير الابتكارية',
      username: 'admin1',
      password: password,
      role: 'SCHOOL_ADMIN',
      schoolId: school1.id,
    },
  });

  // 4. Create Classrooms
  const class1A = await prisma.classroom.create({
    data: {
      name: '1/A',
      grade: 'الصف الأول الثانوي',
      schoolId: school1.id,
    },
  });

  const class2B = await prisma.classroom.create({
    data: {
      name: '2/B',
      grade: 'الصف الثاني الثانوي',
      schoolId: school1.id,
    },
  });

  // 5. Create Teachers
  const teacher1 = await prisma.user.create({
    data: {
      name: 'أ/ محمد علي',
      username: 'teacher1',
      password: password,
      role: 'TEACHER',
      schoolId: school1.id,
      phone: '01012345678',
      status: 'ACTIVE',
    },
  });

  // 6. Create Parents
  const parent1 = await prisma.user.create({
    data: {
      name: 'أحمد محمود (ولي أمر)',
      username: 'parent1',
      password: password,
      role: 'PARENT',
      schoolId: school1.id,
      phone: '01198765432',
    },
  });

  // 7. Create Students
  const studentsData = [
    { name: 'ياسين أحمد', username: 'student1', grade: 'الصف الأول الثانوي', classroomId: class1A.id, parentId: parent1.id },
    { name: 'ليلى يوسف', username: 'student2', grade: 'الصف الأول الثانوي', classroomId: class1A.id, parentId: parent1.id },
    { name: 'عمر خالد', username: 'student3', grade: 'الصف الثاني الثانوي', classroomId: class2B.id },
    { name: 'مريم إبراهيم', username: 'student4', grade: 'الصف الثاني الثانوي', classroomId: class2B.id },
    { name: 'زياد حسن', username: 'student5', grade: 'الصف الأول الثانوي', classroomId: class1A.id },
  ];

  for (const s of studentsData) {
    await prisma.user.create({
      data: {
        ...s,
        password: password,
        role: 'STUDENT',
        schoolId: school1.id,
        status: 'ACTIVE',
        phone: '012' + Math.floor(Math.random() * 10000000),
        avatar: `https://i.pravatar.cc/150?u=${s.username}`
      },
    });
  }

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
