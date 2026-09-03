import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Clean all garbage data
  await prisma.user.deleteMany({ where: { username: "" } });
  await prisma.school.deleteMany({ where: { name: { contains: "?" } } });

  const adminPassword = process.env.INITIAL_SUPER_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('INITIAL_SUPER_ADMIN_PASSWORD is required for seeding the super admin');
  }
  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  
  // Upsert ensures we reset the password even if user exists
  const superAdmin = await prisma.user.upsert({
    where: { username: 'superadmin' },
    update: { password: hashedPassword },
    create: {
      name: 'مدير الموقع',
      username: 'superadmin',
      password: hashedPassword,
      role: 'SUPER_ADMIN',
    },
  });

  console.log('✅ Super Admin ready:', superAdmin.username);

  // Create some sample schools
  const schoolsData = [
    { name: 'مدرسة النهضة الحديثة', subdomain: 'nahda' },
    { name: 'مدرسة النور الدولية', subdomain: 'noor' },
    { name: 'مدرسة المستقبل للغات', subdomain: 'future' },
  ];

  for (const school of schoolsData) {
    await prisma.school.upsert({
      where: { subdomain: school.subdomain },
      update: {},
      create: {
        name: school.name,
        subdomain: school.subdomain,
        status: 'ACTIVE',
      }
    });
  }

  console.log('✅ Sample schools created');

  // Add some students to the first school
  const school = await prisma.school.findFirst({ where: { subdomain: 'nahda' } });
  if (school) {
    const seedStudentPassword = process.env.SEED_USER_PASSWORD || adminPassword;
    const studentPassword = await bcrypt.hash(seedStudentPassword, 10);
    const studentsData = [
      { name: 'أحمد علي', username: 'ahmed.ali' },
      { name: 'سارة محمد', username: 'sara.mohamed' },
      { name: 'ياسين محمود', username: 'yassin.mah' },
    ];

    for (const student of studentsData) {
      await prisma.user.upsert({
        where: { username: student.username },
        update: {},
        create: {
          name: student.name,
          username: student.username,
          password: studentPassword,
          role: 'STUDENT',
          schoolId: school.id,
        }
      });
    }
    console.log('✅ Sample students created for Nahda school');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
