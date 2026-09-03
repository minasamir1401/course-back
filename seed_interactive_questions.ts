import prisma from './src/lib/prisma';

async function main() {
  console.log("Start seeding interactive test course and questions...");

  // 1. Get first school
  const school = await prisma.school.findFirst();
  if (!school) {
    console.error("No school found in the database. Please seed the DB first using npm run db:seed or equivalent.");
    process.exit(1);
  }
  console.log(`Using school: ${school.name} (ID: ${school.id})`);

  // 2. Get first student
  const student = await prisma.user.findFirst({
    where: { role: 'STUDENT', schoolId: school.id }
  });
  if (!student) {
    console.error("No student found for this school.");
    process.exit(1);
  }
  console.log(`Using student for enrollment check: ${student.name} (Username: ${student.username})`);

  // 3. Get first teacher or school admin to associate
  const teacher = await prisma.user.findFirst({
    where: { role: 'TEACHER', schoolId: school.id }
  }) || await prisma.user.findFirst({
    where: { role: 'SCHOOL_ADMIN', schoolId: school.id }
  });

  const allGrades = ["الصف الأول الثانوي", "الصف الثاني الثانوي", "الصف الثالث الثانوي"];

  // 4. Create/Upsert Course
  const courseTitle = "كورس الأسئلة التفاعلية الشامل (11 نوع)";
  const course = await prisma.course.upsert({
    where: { id: 'interactive-test-course-id-11' },
    update: {
      title: courseTitle,
      description: "هذا الكورس يحتوي على جميع أنواع الأسئلة التفاعلية الـ 11 لتجربة وتقييم التصميم ثلاثي الأبعاد المميز ونظام الحركة والجاذبية.",
      schoolId: school.id,
      isCentral: true,
      grade: "الصف الأول الثانوي",
      grades: JSON.stringify(allGrades),
      subject: "تجربة الأسئلة تفاعلية"
    },
    create: {
      id: 'interactive-test-course-id-11',
      title: courseTitle,
      description: "هذا الكورس يحتوي على جميع أنواع الأسئلة التفاعلية الـ 11 لتجربة وتقييم التصميم ثلاثي الأبعاد المميز ونظام الحركة والجاذبية.",
      schoolId: school.id,
      isCentral: true,
      grade: "الصف الأول الثانوي",
      grades: JSON.stringify(allGrades),
      subject: "تجربة الأسئلة تفاعلية"
    }
  });
  console.log(`Course created/upserted: ${course.title} (ID: ${course.id})`);

  // Enroll all students in this school to this course
  const allStudents = await prisma.user.findMany({
    where: { role: 'STUDENT', schoolId: school.id }
  });
  for (const std of allStudents) {
    await prisma.studentEnrollment.upsert({
      where: {
        studentId_courseId: {
          studentId: std.id,
          courseId: course.id
        }
      },
      update: {},
      create: {
        studentId: std.id,
        courseId: course.id
      }
    });
  }
  console.log(`Enrolled ${allStudents.length} students in the course.`);

  if (teacher) {
    await prisma.teacherCourse.upsert({
      where: {
        teacherId_courseId: {
          teacherId: teacher.id,
          courseId: course.id
        }
      },
      update: {},
      create: {
        teacherId: teacher.id,
        courseId: course.id
      }
    });
    console.log(`Associated teacher: ${teacher.name} with the course.`);
  }

  // 5. Create Exam with all 11 question types
  const examTitle = "امتحان تجربة الأسئلة التفاعلية (11 نوع)";
  
  // Delete existing exam if any to clean up questions
  const existingExam = await prisma.exam.findFirst({
    where: { title: examTitle, courseId: course.id }
  });
  if (existingExam) {
    await prisma.exam.delete({ where: { id: existingExam.id } });
  }

  const exam = await prisma.exam.create({
    data: {
      title: examTitle,
      description: "امتحان تجريبي شامل يحتوي على 11 نوع من الأسئلة التفاعلية ثلاثية الأبعاد ونظام الجاذبية لتقييم الأداء والمظهر.",
      type: "Exam",
      duration: 60,
      passingScore: 50,
      isCentral: true,
      status: "PUBLISHED",
      schoolId: school.id,
      courseId: course.id,
      grade: "الصف الأول الثانوي",
      grades: JSON.stringify(allGrades),
      questions: {
        create: [
          {
            text: "سؤال التوصيل (MATCHING): قم بتوصيل الكلمة بالرمز المناسب لها:",
            type: "MATCHING",
            options: JSON.stringify({
              left: ["تفاحة", "صاروخ", "يونيكورن", "نجمة"],
              right: ["🚀", "🍎", "🌟", "🦄"]
            }),
            correctAnswer: JSON.stringify({
              "تفاحة": "🍎",
              "صاروخ": "🚀",
              "يونيكورن": "🦄",
              "نجمة": "🌟"
            }),
            points: 2,
            level: "Medium",
            skill: "توصيل"
          },
          {
            text: "سؤال سحب الفراغات (DRAG_DROP_FILL): اسحب الكلمة المناسبة لتملأ الفراغ الصحيح:",
            type: "DRAG_DROP_FILL",
            options: JSON.stringify({
              sentence: "تعتبر مدينة [slot0] هي عاصمة جمهورية مصر العربية، بينما مدينة [slot1] هي عاصمة فرنسا.",
              choices: ["القاهرة", "باريس", "لندن", "روما"]
            }),
            correctAnswer: JSON.stringify(["القاهرة", "باريس"]),
            points: 2,
            level: "Medium",
            skill: "سحب وإفلات"
          },
          {
            text: "سؤال تصنيف المجموعات (GROUP_SORTING): صنف العناصر التالية إلى مجموعات حيوانات ونباتات:",
            type: "GROUP_SORTING",
            options: JSON.stringify({
              groups: ["حيوانات", "نباتات"],
              items: ["الأسد", "شجرة التفاح", "القطة", "الوردة الجورية"]
            }),
            correctAnswer: JSON.stringify({
              "حيوانات": ["الأسد", "القطة"],
              "نباتات": ["شجرة التفاح", "الوردة الجورية"]
            }),
            points: 2,
            level: "Medium",
            skill: "تصنيف"
          },
          {
            text: "سؤال الساعة التفاعلية (CLOCK): اضبط الساعة لتشير إلى الثالثة والربع (03:15):",
            type: "CLOCK",
            options: JSON.stringify({ minuteStep: 5 }),
            correctAnswer: "03:15",
            points: 2,
            level: "Medium",
            skill: "قراءة الوقت"
          },
          {
            text: "سؤال خريطة المفاهيم (MIND_MAP): أكمل خريطة المفاهيم التالية عن أركان المجموعة الشمسية:",
            type: "MIND_MAP",
            options: JSON.stringify({
              nodes: [
                { id: "root", label: "المجموعة الشمسية", parent: null, isBlank: false },
                { id: "child1", label: "كوكب الأرض", parent: "root", isBlank: false },
                { id: "child2", label: "كوكب المريخ", parent: "root", isBlank: true },
                { id: "child3", label: "كوكب المشتري", parent: "root", isBlank: true }
              ]
            }),
            correctAnswer: JSON.stringify({
              "child2": "كوكب المريخ",
              "child3": "كوكب المشتري"
            }),
            points: 2,
            level: "Medium",
            skill: "خريطة ذهنية"
          },
          {
            text: "سؤال نقطة تفتيش الفيديو (VIDEO_CHECKPOINT): شاهد الفيديو واجب عن السؤال الذي سيظهر لك:",
            type: "VIDEO_CHECKPOINT",
            options: JSON.stringify({
              videoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
              checkpoints: [
                {
                  time: 3,
                  question: "ما هو الكائن الذي يظهر في بداية الفيديو? ",
                  choices: ["أرنب", "عصفور", "سلحفاة"],
                  correctAnswer: "أرنب"
                }
              ]
            }),
            correctAnswer: JSON.stringify({ "3": "أرنب" }),
            points: 2,
            level: "Medium",
            skill: "فيديو تفاعلي"
          },
          {
            text: "سؤال خط الأعداد (NUMBER_LINE): حدد الرقم 7 على خط الأعداد التالي:",
            type: "NUMBER_LINE",
            options: JSON.stringify({
              min: 0,
              max: 10,
              step: 1,
              labels: ["0", "2", "4", "6", "8", "10"]
            }),
            correctAnswer: "7",
            points: 2,
            level: "Medium",
            skill: "خط أعداد"
          },
          {
            text: "سؤال السحب السريع (SWIPE_SORT): اسحب البطاقات لليمين للمجموعة الزوجية ولليسار للمجموعة الفردية:",
            type: "SWIPE_SORT",
            options: JSON.stringify({
              leftGroup: "فردي",
              rightGroup: "زوجي",
              items: ["5", "8", "9", "12"]
            }),
            correctAnswer: JSON.stringify({
              "5": "left",
              "8": "right",
              "9": "left",
              "12": "right"
            }),
            points: 2,
            level: "Medium",
            skill: "فرز سريع"
          },
          {
            text: "سؤال المتاهة التعليمية (MAZE): ابحث عن مسار الخروج الصحيح بالضغط على المربعات المتجاورة:",
            type: "MAZE",
            options: JSON.stringify({
              mazeGrid: [
                [1, 0, 1],
                [1, 1, 1],
                [0, 0, 1]
              ],
              start: [0, 0],
              end: [2, 2]
            }),
            correctAnswer: JSON.stringify(["0,0", "1,0", "1,1", "1,2", "2,2"]),
            points: 2,
            level: "Medium",
            skill: "متاهة"
          },
          {
            text: "سؤال الكلمات المتقاطعة (WORD_SEARCH): اعثر على الكلمتين التاليتين في شبكة الحروف واشطب عليهما: (كتاب، قلم):",
            type: "WORD_SEARCH",
            options: JSON.stringify({
              grid: [
                ["ك", "ت", "ا", "ب"],
                ["ق", "ل", "م", "أ"],
                ["ش", "ص", "ض", "ط"]
              ],
              words: ["كتاب", "قلم"]
            }),
            correctAnswer: JSON.stringify(["كتاب", "قلم"]),
            points: 2,
            level: "Medium",
            skill: "بحث عن الكلمات"
          },
          {
            text: "سؤال جيوجيبرا (GEOGEBRA): استخدم أداة جيوجيبرا التفاعلية لإدخال القيمة الصحيحة للحل:",
            type: "GEOGEBRA",
            options: JSON.stringify({
              materialId: "R5yZ9G5z",
              iframeUrl: "https://www.geogebra.org/material/iframe/id/R5yZ9G5z/width/800/height/500/border/888888/smb/false/stb/false/stbh/false/ai/false/asb/false/sri/false/rc/false/ld/false/sdz/false/ctl/false",
              width: 800,
              height: 500
            }),
            correctAnswer: "5",
            points: 2,
            level: "Medium",
            skill: "جيوجيبرا"
          }
        ]
      }
    }
  });
  console.log(`Exam created: ${exam.title} (ID: ${exam.id})`);

  // 6. Create a Lesson inside the Course
  const lessonTitle = "درس تجربة الأسئلة التفاعلية";
  const lesson = await prisma.lesson.upsert({
    where: { id: 'interactive-test-lesson-id-11' },
    update: {
      title: lessonTitle,
      courseId: course.id,
      order: 1,
      isVisible: true,
      content: "مرحباً بكم في درس تجربة الأسئلة التفاعلية الجديدة. يحتوي هذا الدرس على اختبار مدمج وأقسام شرح للميزات التفاعلية."
    },
    create: {
      id: 'interactive-test-lesson-id-11',
      title: lessonTitle,
      courseId: course.id,
      order: 1,
      isVisible: true,
      content: "مرحباً بكم في درس تجربة الأسئلة التفاعلية الجديدة. يحتوي هذا الدرس على اختبار مدمج وأقسام شرح للميزات التفاعلية."
    }
  });
  console.log(`Lesson created: ${lesson.title} (ID: ${lesson.id})`);

  console.log("Seeding complete! Enjoy testing the interactive question renderer.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
