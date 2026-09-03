import prisma from './src/lib/prisma';

async function main() {
  console.log("Start seeding KLEVRO Skills Hub database content...");

  // 1. Get first school
  const school = await prisma.school.findFirst();
  if (!school) {
    console.error("No school found in the database. Please seed the DB first.");
    process.exit(1);
  }
  console.log(`Using school for scoped content: ${school.name} (ID: ${school.id})`);

  // Clear existing Skills Hub data to avoid duplicates/conflicts during seeding
  console.log("Cleaning up existing Skills Hub data...");
  await prisma.activityAttempt.deleteMany({});
  await prisma.interactiveActivity.deleteMany({});
  await prisma.skillLesson.deleteMany({});
  await prisma.skillCluster.deleteMany({});
  console.log("Cleanup finished.");

  // 2. Seed Central Grade 3 Math Cluster
  console.log("Creating Central Math Cluster...");
  const centralMathCluster = await prisma.skillCluster.create({
    data: {
      name: "📐 العمليات الحسابية والكسور",
      description: "تنمية مهارات الجمع والطرح السريع وقراءة الوقت ومفاهيم الكسور للصف الثالث الابتدائي",
      subject: "الرياضيات",
      grade: "الصف الثالث الابتدائي",
      isCentral: true,
      schoolId: null
    }
  });

  // Math Lesson 1: mental math
  const mathLesson1 = await prisma.skillLesson.create({
    data: {
      clusterId: centralMathCluster.id,
      name: "الحساب الذهني والجمع بتكوين العشرات",
      description: "تطوير قدرة الطالب على الحساب السريع ذهنياً عن طريق تجميع العشرات",
      order: 1
    }
  });

  // Math Activity 1: MATCHING
  await prisma.interactiveActivity.create({
    data: {
      lessonId: mathLesson1.id,
      title: "توصيل الأرقام المكملة لتكوين الرقم 10",
      type: "MATCHING",
      difficulty: "Easy",
      dok: "1",
      points: 10,
      estimatedTime: 60,
      options: JSON.stringify({
        left: ["8", "7", "6", "5"],
        right: ["2", "3", "4", "5"]
      }),
      correctAnswer: JSON.stringify({
        "8": "2",
        "7": "3",
        "6": "4",
        "5": "5"
      }),
      hint: "ابحث عن الرقم الذي يكمل الرقم الآخر ليصل المجموع إلى 10.",
      tip: "تكوين العشرات يسهل عليك حساب العمليات الكبيرة لاحقاً ذهنياً وبسرعة!",
      explanation: "الأعداد المكملة للرقم 10 هي: 8 + 2 = 10، 7 + 3 = 10، 6 + 4 = 10، 5 + 5 = 10.",
      keyInsight: "الحساب الذهني يعتمد على تبسيط الأرقام الكبيرة إلى مجموعات من العشرات.",
      standard: "MATH.3.A.1",
      indicator: "MATH.IND.1",
      learningOutcome: "القدرة على تكوين العشرات في الحساب الذهني"
    }
  });

  // Math Activity 2: CLOCK
  await prisma.interactiveActivity.create({
    data: {
      lessonId: mathLesson1.id,
      title: "ساعة الحائط ومطابقة عقارب الوقت (09:30)",
      type: "CLOCK",
      difficulty: "Medium",
      dok: "2",
      points: 15,
      estimatedTime: 45,
      options: JSON.stringify({ minuteStep: 5 }),
      correctAnswer: "09:30",
      hint: "اجعل عقرب الساعات القصير يشير بين الرقمين 9 و 10 وعقرب الدقائق الطويل يشير للرقم 6.",
      tip: "كل رقم في عقرب الدقائق يعبر عن 5 دقائق إضافية (الرقم 6 يعبر عن 30 دقيقة أي نصف ساعة).",
      explanation: "التاسعة والنصف تعني مرور 30 دقيقة بعد الساعة التاسعة، لذا يشير عقرب الدقائق للرقم 6.",
      keyInsight: "قراءة الساعات بدقة تعيننا على تنظيم يومنا الدراسي والمنزلي بكفاءة.",
      standard: "MATH.3.A.2",
      indicator: "MATH.IND.2",
      learningOutcome: "قراءة الساعات بشكل تفاعلي ودقيق"
    }
  });

  // Math Lesson 2: Fractions
  const mathLesson2 = await prisma.skillLesson.create({
    data: {
      clusterId: centralMathCluster.id,
      name: "مفهوم الكسور الاعتيادية",
      description: "التعرف على بسط ومقام الكسر وتمثيله بيانياً بالرسوم",
      order: 2
    }
  });

  // Math Activity 3: MCQ fractions
  await prisma.interactiveActivity.create({
    data: {
      lessonId: mathLesson2.id,
      title: "تحديد الكسر الممثل للشكل الدائري المظلل",
      type: "MCQ",
      difficulty: "Medium",
      dok: "2",
      points: 12,
      estimatedTime: 40,
      options: JSON.stringify({
        choices: ["1/2 (نصف)", "1/3 (ثلث)", "1/4 (ربع)", "2/3 (ثلثان)"]
      }),
      correctAnswer: "1/4 (ربع)",
      hint: "عد الأجزاء المظللة أولاً (البسط)، ثم عد إجمالي الأجزاء المقسم إليها الشكل (المقام).",
      tip: "الكسر هو جزء من الكل. إذا قسمنا البيتزا إلى أربعة أجزاء وأكلنا جزءاً واحداً، فنحن أكلنا الربع!",
      explanation: "الشكل مقسم إلى 4 أجزاء متساوية تماماً، وتم تظليل جزء واحد فقط منها، مما يعبر عن الكسر 1/4 (الربع).",
      keyInsight: "الكسور تساعدنا في تقسيم الأشياء والموارد بالتساوي.",
      standard: "MATH.3.B.1",
      indicator: "MATH.IND.3",
      learningOutcome: "فهم الكسر كجزء من الكل وتمثيله بيانياً"
    }
  });

  // 3. Seed Central Grade 3 Reading Cluster
  console.log("Creating Central Reading Cluster...");
  const centralReadingCluster = await prisma.skillCluster.create({
    data: {
      name: "📚 مهارات الفهم القرائي والمفردات",
      description: "تحسين مهارات القراءة السريعة والفهم القرائي وحصيلة المفردات المترادفة للصف الثالث الابتدائي",
      subject: "القراءة",
      grade: "الصف الثالث الابتدائي",
      isCentral: true,
      schoolId: null
    }
  });

  const readingLesson1 = await prisma.skillLesson.create({
    data: {
      clusterId: centralReadingCluster.id,
      name: "المفردات والسياق القرائي",
      description: "استنتاج معاني الكلمات الجديدة وتصنيف المترادفات والمتضادات",
      order: 1
    }
  });

  // Reading Activity 1: MATCHING
  await prisma.interactiveActivity.create({
    data: {
      lessonId: readingLesson1.id,
      title: "مطابقة الكلمة بالمرادف اللغوي المناسب لها",
      type: "MATCHING",
      difficulty: "Medium",
      dok: "2",
      points: 12,
      estimatedTime: 50,
      options: JSON.stringify({
        left: ["جميل", "سريع", "ذكي", "كريم"],
        right: ["وسيم", "خاطف", "عبقري", "سخي"]
      }),
      correctAnswer: JSON.stringify({
        "جميل": "وسيم",
        "سريع": "خاطف",
        "ذكي": "عبقري",
        "كريم": "سخي"
      }),
      hint: "فكر في الكلمات البديلة التي يمكن أن تضعها في الجملة وتؤدي نفس المعنى.",
      tip: "القراءة المستمرة تزيد من معجمك اللغوي وتجعلك تعبر عن أفكارك بكلمات متنوعة ورائعة!",
      explanation: "المترادفات هي كلمات تعطي نفس المعنى: جميل = وسيم، سريع = خاطف، ذكي = عبقري، كريم = سخي.",
      keyInsight: "اللغة العربية غنية بالمرادفات التي تعطي دقة وجمالاً في التعبير والكتابة.",
      standard: "READ.3.A.1",
      indicator: "READ.IND.1",
      learningOutcome: "توسيع الحصيلة اللغوية واستخدام المفردات البديلة"
    }
  });

  // 4. Seed Scoped School-Specific Cluster (Grade 3 Math) to verify isolation
  console.log(`Creating School-Specific Math Cluster for school ${school.name}...`);
  const schoolSpecificCluster = await prisma.skillCluster.create({
    data: {
      name: "🧩 أنشطة الذكاء السريع الخاصة بمدرستنا",
      description: "محور مهاراتي إضافي وخاص بمدرستنا فقط لتحديات الذكاء السريع وحل المشكلات الحسابية المعقدة",
      subject: "الرياضيات",
      grade: "الصف الثالث الابتدائي",
      isCentral: false,
      schoolId: school.id
    }
  });

  const schoolLesson1 = await prisma.skillLesson.create({
    data: {
      clusterId: schoolSpecificCluster.id,
      name: "تحدي الألغاز والأنماط الحسابية",
      description: "تنمية مهارات التفكير المنطقي عبر الأنماط الرقمية",
      order: 1
    }
  });

  // School Activity 1: MCQ
  await prisma.interactiveActivity.create({
    data: {
      lessonId: schoolLesson1.id,
      title: "تكملة النمط الرقمي الهندسي (2، 4، 8، 16، ...)",
      type: "MCQ",
      difficulty: "Hard",
      dok: "3",
      points: 20,
      estimatedTime: 90,
      options: JSON.stringify({
        choices: ["20", "24", "32", "64"]
      }),
      correctAnswer: "32",
      hint: "لاحظ العلاقة بين كل رقمين متتاليين. هل نقوم بالجمع، أم بالضرب في رقم ثابت؟",
      tip: "في هذا النمط، كل رقم هو ضعف الرقم الذي قبله (أي نضربه في 2).",
      explanation: "النمط هو ضرب العدد السابق في 2: 2×2=4، 4×2=8، 8×2=16، 16×2=32. إذن الرقم التالي هو 32.",
      keyInsight: "الأنماط الرياضية هي جوهر التفكير الجبري والبرمجي لحل المشكلات المعقدة.",
      standard: "MATH.3.C.1",
      indicator: "MATH.IND.4",
      learningOutcome: "استنتاج النمط الحسابي المعتمد على الضرب المتكرر"
    }
  });

  console.log("Database seeding completed successfully for KLEVRO Skills Hub!");
}

main()
  .catch((e) => {
    console.error("Error during seeding process:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
