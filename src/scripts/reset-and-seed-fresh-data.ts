import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- STARTING DATABASE RESET & SEED ---');

  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });

  if (!superAdmin) {
    throw new Error('Super Admin user not found! Aborting to protect data integrity.');
  }

  const allSchools = await prisma.school.findMany();
  const schoolIds = allSchools.map(s => ({ id: s.id }));

  console.log(`Found Super Admin: ${superAdmin.name} (${superAdmin.id})`);
  console.log(`Found ${allSchools.length} schools to associate content with.`);

  console.log('1. Deleting all existing exam submissions and student answers...');
  await prisma.studentAnswer.deleteMany();
  await prisma.examSubmission.deleteMany();

  console.log('2. Deleting all existing questions, sub-exams, and exam modules...');
  await prisma.question.deleteMany();
  await prisma.subExam.deleteMany();
  await prisma.examModule.deleteMany();

  console.log('3. Deleting all existing exams and folders...');
  await prisma.exam.deleteMany();
  await prisma.examFolder.deleteMany();

  console.log('4. Deleting all existing lesson blocks, sections, and answers...');
  await prisma.blockAnswer.deleteMany();
  await prisma.dynamicSection.deleteMany();
  await prisma.lessonBlock.deleteMany();

  console.log('5. Deleting all existing lesson and course progresses and enrollments...');
  await prisma.lessonProgress.deleteMany();
  await prisma.courseProgress.deleteMany();
  await prisma.studentEnrollment.deleteMany();
  await prisma.teacherCourse.deleteMany();

  console.log('6. Deleting all existing lessons and courses...');
  await prisma.lesson.deleteMany();
  await prisma.course.deleteMany();

  console.log('7. Deleting all existing skill activities, lessons, and clusters...');
  await prisma.activityAttempt.deleteMany();
  await prisma.interactiveActivity.deleteMany();
  await prisma.skillLesson.deleteMany();
  await prisma.skillCluster.deleteMany();

  console.log('--- ALL OLD EXAMS, COURSES, QUESTIONS, AND SKILLS DELETED ---');

  console.log('8. Creating new English Mathematics Course with 5 Interactive Questions...');

  const courseSlides = [
    {
      id: 1,
      type: 'TEXT',
      label: 'CONTENT',
      title: 'مقدمة في الأعداد الصحيحة',
      titleEn: 'Introduction to Integers',
      content: '<p><strong>الأعداد الصحيحة</strong> هي الأعداد الكلية ومعكوساتها بما في ذلك الصفر (... -3، -2، -1، 0، 1، 2، 3 ...). ولا تحتوي على أي أجزاء كسرية أو عشرية.</p>',
      contentEn: '<p><strong>Integers</strong> are whole numbers and their opposites, including zero (... -3, -2, -1, 0, 1, 2, 3 ...). They have no fractional or decimal parts.</p>',
      videoUrl: '',
      sections: [
        {
          id: 101,
          type: 'EXPLANATION',
          content: 'تُستخدم الأعداد الصحيحة لتمثيل القيم في الحياة اليومية مثل درجات الحرارة والأرباح والخسائر والارتفاعات.',
          contentEn: 'Integers are used in everyday situations such as temperature, bank balances, elevation, and sports scores.'
        }
      ]
    },
    {
      id: 2,
      type: 'QUESTION',
      label: 'MCQ',
      title: 'السؤال 1: تصنيف الأعداد',
      titleEn: 'Question 1: Number Classification',
      content: '<p>أي من الأعداد التالية <strong>لا</strong> يُعد عدداً صحيحاً؟</p>',
      contentEn: '<p>Which of the following numbers is <strong>NOT</strong> an integer?</p>',
      options: ['-15', '0', '4.75', '108'],
      optionsEn: ['-15', '0', '4.75', '108'],
      correctAnswer: '4.75',
      correctAnswerEn: '4.75',
      videoUrl: '',
      standard: 'MATH.7.NS.1',
      indicator: 'Identify and distinguish integers from rational decimals',
      level: 'Easy',
      points: 1,
      sections: [
        {
          id: 102,
          type: 'EXPLANATION',
          content: 'العدد 4.75 هو عدد عشري وليس عدداً كلياً، وبالتالي لا يُعد عدداً صحيحاً.',
          contentEn: '4.75 is a decimal number, therefore it is not a whole number or an integer.'
        }
      ]
    },
    {
      id: 3,
      type: 'QUESTION',
      label: 'MCQ',
      title: 'السؤال 2: المعكوس الجمعي',
      titleEn: 'Question 2: Opposite Values',
      content: '<p>ما هو المعكوس الجمعي للعدد <strong>-23</strong>؟</p>',
      contentEn: '<p>What is the additive inverse (opposite) of the number <strong>-23</strong>?</p>',
      options: ['-23', '23', '0', '1/23'],
      optionsEn: ['-23', '23', '0', '1/23'],
      correctAnswer: '23',
      correctAnswerEn: '23',
      videoUrl: '',
      standard: 'MATH.7.NS.2',
      indicator: 'Determine opposites and additive inverses of integers',
      level: 'Easy',
      points: 1,
      sections: [
        {
          id: 103,
          type: 'EXPLANATION',
          content: 'معكوس أي عدد سالب -س هو العدد الموجب المقابل له +س.',
          contentEn: 'The opposite of any negative number -x is its positive counterpart +x.'
        }
      ]
    },
    {
      id: 4,
      type: 'QUESTION',
      label: 'MCQ',
      title: 'السؤال 3: جمع الأعداد الصحيحة',
      titleEn: 'Question 3: Integer Addition',
      content: '<p>ما قيمة ناتج العملية: <strong>(-8) + 15</strong>؟</p>',
      contentEn: '<p>What is the value of: <strong>(-8) + 15</strong>?</p>',
      options: ['-23', '-7', '7', '23'],
      optionsEn: ['-23', '-7', '7', '23'],
      correctAnswer: '7',
      correctAnswerEn: '7',
      videoUrl: '',
      standard: 'MATH.7.NS.3',
      indicator: 'Apply addition of positive and negative integers',
      level: 'Medium',
      points: 1,
      sections: [
        {
          id: 104,
          type: 'EXPLANATION',
          content: 'عند جمع عددين مختلفين في الإشارة، نطرح القيمة الصغرى من الكبرى ونأخذ إشارة الأكبر: 15 - 8 = 7.',
          contentEn: 'When adding numbers with different signs, subtract the smaller absolute value from the larger: 15 - 8 = 7.'
        }
      ]
    },
    {
      id: 5,
      type: 'QUESTION',
      label: 'MCQ',
      title: 'السؤال 4: ضرب الأعداد الصحيحة',
      titleEn: 'Question 4: Integer Multiplication',
      content: '<p>احسب حاصل ضرب: <strong>(-6) × (-7)</strong></p>',
      contentEn: '<p>Calculate the product: <strong>(-6) × (-7)</strong></p>',
      options: ['-42', '42', '-13', '13'],
      optionsEn: ['-42', '42', '-13', '13'],
      correctAnswer: '42',
      correctAnswerEn: '42',
      videoUrl: '',
      standard: 'MATH.7.NS.4',
      indicator: 'Evaluate products of signed integers using sign rules',
      level: 'Medium',
      points: 1,
      sections: [
        {
          id: 105,
          type: 'EXPLANATION',
          content: 'ضرب عدد سالب في عدد سالب يعطي دائماً ناتجاً موجباً: (-6) × (-7) = 42.',
          contentEn: 'Multiplying two negative numbers always yields a positive result: (-6) × (-7) = +42.'
        }
      ]
    },
    {
      id: 6,
      type: 'QUESTION',
      label: 'MCQ',
      title: 'السؤال 5: مسألة تطبيقية',
      titleEn: 'Question 5: Real-World Temperature Problem',
      content: '<p>كانت درجة الحرارة عند الفجر <strong>-4°C</strong>، ثم ارتفعت بمقدار <strong>9°C</strong> بحلول الظهر. كم أصبحت درجة الحرارة عند الظهر؟</p>',
      contentEn: '<p>The temperature at dawn was <strong>-4°C</strong>. By noon, it rose by <strong>9°C</strong>. What is the temperature at noon?</p>',
      options: ['-13°C', '-5°C', '5°C', '13°C'],
      optionsEn: ['-13°C', '-5°C', '5°C', '13°C'],
      correctAnswer: '5°C',
      correctAnswerEn: '5°C',
      videoUrl: '',
      standard: 'MATH.7.NS.5',
      indicator: 'Solve contextual real-world problems involving integer operations',
      level: 'Hard',
      points: 1,
      sections: [
        {
          id: 106,
          type: 'EXPLANATION',
          content: 'البدء من -4 والارتفاع بمقدار 9 يعني: -4 + 9 = 5 درجات مئوية.',
          contentEn: 'Starting at -4°C and rising by 9°C means: -4 + 9 = 5°C.'
        }
      ]
    }
  ];

  const lessonQuestions = courseSlides.filter(s => s.type === 'QUESTION').map((q, idx) => ({
    id: q.id,
    type: 'MCQ',
    title: q.title,
    titleEn: q.titleEn,
    text: q.content,
    textEn: q.contentEn,
    options: q.options,
    optionsEn: q.optionsEn,
    correctAnswer: q.correctAnswer,
    correctAnswerEn: q.correctAnswerEn,
    points: 1,
    standard: q.standard,
    indicator: q.indicator,
    level: q.level,
    explanation: q.sections[0]?.content || '',
    explanationEn: q.sections[0]?.contentEn || '',
    sections: q.sections
  }));

  const createdCourse = await prisma.course.create({
    data: {
      title: 'English Mathematics: Integers & Number Systems',
      description: 'Comprehensive English mathematics course covering positive and negative integers, absolute value, arithmetic operations, and real-world applications.',
      grade: 'الصف الأول الإعدادي',
      subject: 'Mathematics',
      isCentral: true,
      creatorId: superAdmin.id,
      schools: {
        connect: schoolIds
      },
      lessons: {
        create: [
          {
            title: 'Unit 1: Fundamentals of Integers',
            domain: 'Mathematics',
            summary: 'Core foundational principles of signed integers and arithmetic operations.',
            duration: 1800,
            isCentral: true,
            isVisible: true,
            order: 1,
            creatorId: superAdmin.id,
            slides: courseSlides,
            questions: lessonQuestions,
            assignments: []
          }
        ]
      }
    },
    include: {
      lessons: true
    }
  });

  const createdLesson = createdCourse.lessons[0];
  console.log(`Created Course: ${createdCourse.title} (${createdCourse.id})`);
  console.log(`Created Lesson: ${createdLesson.title} (${createdLesson.id}) with 5 questions.`);

  console.log('9. Creating new English Diagnostic Exam with 5 Questions...');

  const createdExam = await prisma.exam.create({
    data: {
      title: 'Mathematics Diagnostic Exam: Integers & Signed Numbers',
      description: 'Standardized diagnostic examination assessing student proficiency in integer classification, arithmetic, and problem solving.',
      type: 'Quiz',
      duration: 30,
      passingScore: 60,
      status: 'PUBLISHED',
      isCentral: true,
      grade: 'الصف الأول الإعدادي',
      subjects: 'Mathematics',
      level: 'Medium',
      creatorId: superAdmin.id,
      courseId: createdCourse.id,
      schools: {
        connect: schoolIds
      },
      questions: {
        create: [
          {
            text: 'أي من الأعداد التالية لا يُعد عدداً صحيحاً؟',
            textEn: 'Which of the following numbers is NOT an integer?',
            type: 'MCQ',
            options: JSON.stringify(['-15', '0', '4.75', '108']),
            optionsEn: JSON.stringify(['-15', '0', '4.75', '108']),
            correctAnswer: '4.75',
            points: 1,
            xpPoints: 10,
            level: 'Easy',
            skill: 'Number Sense & Classification',
            domain: 'Mathematics',
            standard: 'MATH.7.NS.1',
            indicator: 'Identify and distinguish integers from rational decimals',
            explanation: 'العدد 4.75 عدد عشري وليس عدداً كلياً.',
            explanationEn: '4.75 is a decimal number, therefore it is not an integer.',
            order: 1
          },
          {
            text: 'ما هو المعكوس الجمعي (نظير) العدد -23؟',
            textEn: 'What is the additive inverse (opposite) of -23?',
            type: 'MCQ',
            options: JSON.stringify(['-23', '23', '0', '1/23']),
            optionsEn: JSON.stringify(['-23', '23', '0', '1/23']),
            correctAnswer: '23',
            points: 1,
            xpPoints: 10,
            level: 'Easy',
            skill: 'Additive Inverses',
            domain: 'Mathematics',
            standard: 'MATH.7.NS.2',
            indicator: 'Determine opposites and additive inverses of integers',
            explanation: 'المعكوس الجمعي لأي عدد سالب هو العدد الموجب المقابل له.',
            explanationEn: 'The opposite of any negative number -x is its positive counterpart +x.',
            order: 2
          },
          {
            text: 'أوجد ناتج العملية الحسابية: (-8) + 15',
            textEn: 'Evaluate the arithmetic expression: (-8) + 15',
            type: 'MCQ',
            options: JSON.stringify(['-23', '-7', '7', '23']),
            optionsEn: JSON.stringify(['-23', '-7', '7', '23']),
            correctAnswer: '7',
            points: 1,
            xpPoints: 10,
            level: 'Medium',
            skill: 'Integer Addition',
            domain: 'Mathematics',
            standard: 'MATH.7.NS.3',
            indicator: 'Apply addition of positive and negative integers',
            explanation: '15 - 8 = 7.',
            explanationEn: 'When adding numbers with different signs, subtract the smaller from larger: 15 - 8 = 7.',
            order: 3
          },
          {
            text: 'احسب حاصل ضرب: (-6) × (-7)',
            textEn: 'Compute the product: (-6) × (-7)',
            type: 'MCQ',
            options: JSON.stringify(['-42', '42', '-13', '13']),
            optionsEn: JSON.stringify(['-42', '42', '-13', '13']),
            correctAnswer: '42',
            points: 1,
            xpPoints: 10,
            level: 'Medium',
            skill: 'Integer Multiplication',
            domain: 'Mathematics',
            standard: 'MATH.7.NS.4',
            indicator: 'Evaluate products of signed integers using sign rules',
            explanation: 'حاصل ضرب عددين سالبين هو عدد موجب: (-6) × (-7) = 42.',
            explanationEn: 'Multiplying two negative numbers always yields a positive result: (-6) × (-7) = +42.',
            order: 4
          },
          {
            text: 'كانت درجة الحرارة عند الفجر -4 مئوية، وارتفعت بمقدار 9 درجات عند الظهر. كم أصبحت درجة الحرارة؟',
            textEn: 'The temperature at dawn was -4°C and increased by 9°C at noon. What is the noon temperature?',
            type: 'MCQ',
            options: JSON.stringify(['-13°C', '-5°C', '5°C', '13°C']),
            optionsEn: JSON.stringify(['-13°C', '-5°C', '5°C', '13°C']),
            correctAnswer: '5°C',
            points: 1,
            xpPoints: 10,
            level: 'Hard',
            skill: 'Contextual Word Problems',
            domain: 'Mathematics',
            standard: 'MATH.7.NS.5',
            indicator: 'Solve contextual real-world problems involving integer operations',
            explanation: '-4 + 9 = 5 درجات مئوية.',
            explanationEn: 'Starting at -4°C and increasing by 9°C: -4 + 9 = 5°C.',
            order: 5
          }
        ]
      }
    },
    include: {
      questions: true
    }
  });

  console.log(`Created Exam: ${createdExam.title} (${createdExam.id}) with 5 questions.`);

  console.log('10. Creating 5 Educational Skills in Skills Hub...');

  const skillCluster = await prisma.skillCluster.create({
    data: {
      name: 'Mathematics & Numerical Systems',
      description: 'Core standards and competencies in signed integers, operations, and numerical reasoning.',
      subject: 'Mathematics',
      grade: JSON.stringify(['الصف الأول الإعدادي']),
      isCentral: true,
      creatorId: superAdmin.id,
      schoolId: allSchools[0]?.id || null,
      skills: {
        create: [
          {
            name: 'Skill 1: Integer Identification & Classification',
            description: 'Recognize positive integers, negative integers, and zero while differentiating from fractions and decimals.',
            order: 1,
            activities: {
              create: [
                {
                  title: 'Identify Non-Integers',
                  titleEn: 'Identify Non-Integers',
                  questionText: 'أي من الأعداد التالية ليس عدداً صحيحاً؟',
                  questionTextEn: 'Which number is not an integer?',
                  type: 'MCQ',
                  options: JSON.stringify(['-15', '0', '4.75', '108']),
                  optionsEn: JSON.stringify(['-15', '0', '4.75', '108']),
                  correctAnswer: JSON.stringify('4.75'),
                  correctAnswerEn: JSON.stringify('4.75'),
                  points: 10,
                  difficulty: 'Easy',
                  standard: 'MATH.7.NS.1',
                  indicator: 'Classify numbers as integers or non-integers'
                }
              ]
            }
          },
          {
            name: 'Skill 2: Number Line Representation & Ordering',
            description: 'Plot directed integers on a horizontal number line and order them using inequality notation.',
            order: 2,
            activities: {
              create: [
                {
                  title: 'Compare Integers',
                  titleEn: 'Compare Integers',
                  questionText: 'أي تعبير رياضي صحيح؟',
                  questionTextEn: 'Which comparison statement is mathematically correct?',
                  type: 'MCQ',
                  options: JSON.stringify(['-8 > -2', '-5 < -9', '-3 > -7', '0 < -4']),
                  optionsEn: JSON.stringify(['-8 > -2', '-5 < -9', '-3 > -7', '0 < -4']),
                  correctAnswer: JSON.stringify('-3 > -7'),
                  correctAnswerEn: JSON.stringify('-3 > -7'),
                  points: 10,
                  difficulty: 'Medium',
                  standard: 'MATH.7.NS.2',
                  indicator: 'Order and compare integers'
                }
              ]
            }
          },
          {
            name: 'Skill 3: Absolute Value & Additive Inverses',
            description: 'Determine distance from origin as absolute value and find opposites of signed quantities.',
            order: 3,
            activities: {
              create: [
                {
                  title: 'Additive Inverses',
                  titleEn: 'Additive Inverses',
                  questionText: 'ما المعكوس الجمعي للعدد -23؟',
                  questionTextEn: 'What is the additive inverse of -23?',
                  type: 'MCQ',
                  options: JSON.stringify(['-23', '23', '0', '1/23']),
                  optionsEn: JSON.stringify(['-23', '23', '0', '1/23']),
                  correctAnswer: JSON.stringify('23'),
                  correctAnswerEn: JSON.stringify('23'),
                  points: 10,
                  difficulty: 'Easy',
                  standard: 'MATH.7.NS.3',
                  indicator: 'Find opposite values'
                }
              ]
            }
          },
          {
            name: 'Skill 4: Integer Addition and Subtraction',
            description: 'Execute addition and subtraction of signed numbers applying algebraic sign properties.',
            order: 4,
            activities: {
              create: [
                {
                  title: 'Compute Integer Sums',
                  titleEn: 'Compute Integer Sums',
                  questionText: 'أوجد قيمة (-8) + 15',
                  questionTextEn: 'Evaluate: (-8) + 15',
                  type: 'MCQ',
                  options: JSON.stringify(['-23', '-7', '7', '23']),
                  optionsEn: JSON.stringify(['-23', '-7', '7', '23']),
                  correctAnswer: JSON.stringify('7'),
                  correctAnswerEn: JSON.stringify('7'),
                  points: 10,
                  difficulty: 'Medium',
                  standard: 'MATH.7.NS.4',
                  indicator: 'Add signed integers'
                }
              ]
            }
          },
          {
            name: 'Skill 5: Real-World Multi-Step Problem Solving',
            description: 'Synthesize integer rules to calculate temperature changes, elevation shifts, and monetary accounts.',
            order: 5,
            activities: {
              create: [
                {
                  title: 'Temperature Word Problem',
                  titleEn: 'Temperature Word Problem',
                  questionText: 'كانت درجة الحرارة -4 مئوية وارتفعت بمقدار 9 درجات. كم أصبحت؟',
                  questionTextEn: 'Initial temperature was -4°C and increased by 9°C. What is the final temperature?',
                  type: 'MCQ',
                  options: JSON.stringify(['-13°C', '-5°C', '5°C', '13°C']),
                  optionsEn: JSON.stringify(['-13°C', '-5°C', '5°C', '13°C']),
                  correctAnswer: JSON.stringify('5°C'),
                  correctAnswerEn: JSON.stringify('5°C'),
                  points: 10,
                  difficulty: 'Hard',
                  standard: 'MATH.7.NS.5',
                  indicator: 'Solve real-world problems'
                }
              ]
            }
          }
        ]
      }
    },
    include: {
      skills: {
        include: {
          activities: true
        }
      }
    }
  });

  console.log(`Created Skill Cluster: ${skillCluster.name} with ${skillCluster.skills.length} skills.`);

  console.log('--- DATABASE RESET & FRESH DATA SEEDING COMPLETE ---');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
