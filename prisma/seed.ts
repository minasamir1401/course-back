import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const seedPassword = process.env.SEED_USER_PASSWORD || process.env.INITIAL_SUPER_ADMIN_PASSWORD;
  if (!seedPassword) {
    throw new Error('SEED_USER_PASSWORD or INITIAL_SUPER_ADMIN_PASSWORD is required for seeding users');
  }
  const hashedPassword = await bcrypt.hash(seedPassword, 10);
  
  // 1. Create Super Admin
  const superAdmin = await prisma.user.upsert({
    where: { username: 'superadmin' },
    update: { password: hashedPassword },
    create: {
      username: 'superadmin',
      password: hashedPassword,
      name: 'Mina Adly (Super Admin)',
      role: 'SUPER_ADMIN',
    },
  });

  // 2. Egyptian Private Schools
  const schoolsData = [
    { name: 'مدرسة الرواد الخاصة - القاهرة', subdomain: 'alrowad', themeColor: '#4f46e5' },
    { name: 'مدرسة النيل الدولية - الشيخ زايد', subdomain: 'nile', themeColor: '#059669' },
    { name: 'مدرسة المنارة لغات - الإسكندرية', subdomain: 'almanara', themeColor: '#dc2626' },
    { name: 'مدرسة بورسعيد الحديثة', subdomain: 'portsaid', themeColor: '#2563eb' },
  ];

  const schools = [];
  for (const s of schoolsData) {
    const school = await prisma.school.upsert({
      where: { subdomain: s.subdomain },
      update: { name: s.name },
      create: s,
    });
    schools.push(school);

    // Create School Admin
    await prisma.user.upsert({
      where: { username: `${s.subdomain}_admin` },
      update: { password: hashedPassword },
      create: {
        username: `${s.subdomain}_admin`,
        password: hashedPassword,
        name: `أ/ محمد أحمد - مدير ${s.name}`,
        role: 'SCHOOL_ADMIN',
        schoolId: school.id,
      },
    });

    // Create some Teachers for each school
    const teacherNames = ['أحمد محمود', 'سارة حسن', 'إبراهيم علي', 'مريم يوسف'];
    for (let i = 0; i < teacherNames.length; i++) {
      await prisma.user.upsert({
        where: { username: `${s.subdomain}_teacher_${i+1}` },
        update: { password: hashedPassword },
        create: {
          username: `${s.subdomain}_teacher_${i+1}`,
          password: hashedPassword,
          name: `أ/ ${teacherNames[i]}`,
          role: 'TEACHER',
          schoolId: school.id,
        },
      });
    }

    // Create some Students for each school
    const studentNames = ['ياسين خالد', 'جنى عمرو', 'عمر إيهاب', 'ليلى مصطفى', 'حمزة هاني', 'نور الدين', 'فريدة محمد'];
    const grades = ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];
    for (let i = 0; i < studentNames.length; i++) {
      await prisma.user.upsert({
        where: { username: `${s.subdomain}_student_${i+1}` },
        update: { password: hashedPassword },
        create: {
          username: `${s.subdomain}_student_${i+1}`,
          password: hashedPassword,
          name: studentNames[i],
          role: 'STUDENT',
          schoolId: school.id,
          grade: grades[i % grades.length],
        },
      });
    }
  }

  // 3. Sample Exams with Egyptian Subjects
  const subjects = [
    'اللغة العربية', 'اللغة الإنجليزية', 'الرياضيات (جبر)', 'الفيزياء', 'الكيمياء'
  ];

  // Create a few sample exams for the first school
  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i];
    const grade = 'الصف الأول الثانوي';
    const title = `امتحان شهر أكتوبر - ${subject}`;

    const existingExam = await prisma.exam.findFirst({
      where: { title, schoolId: schools[0].id }
    });

    if (!existingExam) {
      await prisma.exam.create({
        data: {
          title: title,
          description: `امتحان تجريبي لتقييم مستوى الطلاب في مادة ${subject}.`,
          category: subject,
          grade: grade,
          duration: 60,
          type: 'Exam',
          status: 'PUBLISHED',
          schoolId: schools[0].id,
          resultVisibility: 'SHOW_ALL',
          showAnswers: true,
          questions: {
            create: [
              {
                text: `ما هو السؤال الأول في ${subject}؟`,
                type: 'MCQ',
                options: JSON.stringify(['الإجابة الأولى', 'الإجابة الثانية', 'الإجابة الثالثة', 'الإجابة الرابعة']),
                correctAnswer: 'الإجابة الأولى',
                points: 2,
                skill: 'الفهم',
                standard: 'STD-101',
                learningOutcome: 'القدرة على استنتاج المعلومة',
                level: 'Medium'
              },
              {
                text: `هل العبارة التالية صحيحة بخصوص ${subject}؟`,
                type: 'TRUE_FALSE',
                options: JSON.stringify(['True', 'False']),
                correctAnswer: 'True',
                points: 1,
                skill: 'المعرفة',
                standard: 'STD-102',
                learningOutcome: 'تذكر الحقائق الأساسية',
                level: 'Easy'
              }
            ]
          }
        }
      });
    }
  }

  console.log('✅ Seed data updated successfully with realistic Egyptian data.');
  console.log(`- Super Admin: superadmin / password set from environment`);
  console.log(`- Schools: ${schools.length} schools created.`);
  console.log(`- Users: Teachers and Students added to each school.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
