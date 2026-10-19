/* Local, additive demo data for the explicitly requested report30_08 account.
 * Run from back/: node scripts/seed-student-demo.cjs --apply
 * Without --apply this only reads and verifies. Re-running never resets demo edits.
 */
require('dotenv/config');
require('ts-node').register({ transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { buildSubmissionSnapshot, snapshotQuestion } = require('../src/utils/submissionSnapshot');
const db = new PrismaClient();
const USERNAME = 'report30_08';
const PREFIX = 'student-demo-report30_08-v1';
const now = new Date();
const day = offset => new Date(now.getTime() + offset * 86400000);
const id = key => {
  const hex = createHash('sha256').update(`${PREFIX}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
// Each topic includes real explanations and three distinct, self-contained questions.
const subjects = [
  { ar: 'الرياضيات', en: 'Mathematics', domain: 'الجبر والأعداد', domainEn: 'Algebra and numbers', skill: 'حل المسائل', skillEn: 'Problem solving', topics: [
    ['المجموعات والعمليات عليها', 'Sets and operations', 'المجموعة هي تجميع لعناصر مميزة. التقاطع يضم العناصر المشتركة، والاتحاد يضم جميع العناصر دون تكرار.', 'A set contains distinct elements. Intersection contains shared elements; union contains all elements without duplicates.', [
      ['إذا كانت أ = {1، 2، 3}، ب = {3، 4} فما أ ∩ ب؟', 'If A = {1, 2, 3} and B = {3, 4}, what is A ∩ B?', ['{3}', '{1، 2}', '{4}', '{1، 4}'], '{3}'],
      ['كم عنصرًا في المجموعة {2، 4، 6، 8}؟', 'How many elements are in {2, 4, 6, 8}?', ['4', '2', '6', '8'], '4'],
      ['ما اتحاد {1، 2} و{2، 3}؟', 'What is the union of {1, 2} and {2, 3}?', ['{1، 2، 3}', '{2}', '{1، 3}', '{}'], '{1، 2، 3}'],
    ]],
    ['المعادلات الخطية', 'Linear equations', 'لحل معادلة خطية نحافظ على تساوي الطرفين بإجراء العملية نفسها عليهما. مثال: س + 3 = 8 إذن س = 5.', 'Solve a linear equation by applying the same operation to both sides. For x + 3 = 8, x = 5.', [
      ['حل المعادلة س + 3 = 8.', 'Solve x + 3 = 8.', ['5', '11', '3', '8'], '5'],
      ['إذا كان 2س = 12، فما س؟', 'If 2x = 12, what is x?', ['6', '24', '10', '12'], '6'],
      ['حل المعادلة س − 4 = 3.', 'Solve x - 4 = 3.', ['7', '-1', '1', '12'], '7'],
    ]],
    ['الأسس والقوى', 'Powers and exponents', 'الأس يحدد عدد مرات ضرب الأساس في نفسه. عند ضرب قوتين لهما الأساس نفسه نجمع الأسس.', 'An exponent counts repeated multiplication. When multiplying powers with the same base, add the exponents.', [
      ['ما قيمة 2³؟', 'What is 2 cubed?', ['8', '6', '9', '5'], '8'],
      ['ما قيمة 5²؟', 'What is 5 squared?', ['25', '10', '15', '20'], '25'],
      ['ما قيمة 3² × 3؟', 'What is 3 squared times 3?', ['27', '18', '9', '6'], '27'],
    ]],
    ['المتوسط الحسابي', 'Arithmetic mean', 'المتوسط الحسابي يساوي مجموع القيم مقسومًا على عددها. متوسط 2 و4 و6 يساوي 4.', 'The arithmetic mean is the sum of the values divided by their count. The mean of 2, 4 and 6 is 4.', [
      ['ما متوسط 2 و4 و6؟', 'What is the mean of 2, 4 and 6?', ['4', '6', '12', '3'], '4'],
      ['مجموع 5 قيم هو 50. ما متوسطها؟', 'Five values sum to 50. What is their mean?', ['10', '5', '25', '50'], '10'],
      ['ما متوسط 10 و20؟', 'What is the mean of 10 and 20?', ['15', '30', '10', '20'], '15'],
    ]],
  ] },
  { ar: 'اللغة العربية', en: 'Arabic language', domain: 'النحو والقراءة', domainEn: 'Grammar and reading', skill: 'الفهم والتحليل', skillEn: 'Comprehension and analysis', topics: [
    ['الجملة الاسمية', 'Nominal sentences', 'تبدأ الجملة الاسمية باسم وتتكون غالبًا من مبتدأ وخبر مرفوعين. في جملة «العلم نور» العلم مبتدأ ونور خبر.', 'A nominal sentence usually contains a subject and a predicate. In «العلم نور», «العلم» is the subject and «نور» is the predicate.', [
      ['ما المبتدأ في «العلم نور»؟', 'Which word is the subject in «العلم نور»?', ['العلم', 'نور', 'الجملة', 'لا يوجد'], 'العلم'],
      ['ما الخبر في «الطالب مجتهد»؟', 'Which word is the predicate in «الطالب مجتهد»?', ['مجتهد', 'الطالب', 'الـ', 'لا يوجد'], 'مجتهد'],
      ['ما نوع جملة «الحديقة جميلة»؟', 'What type of sentence is «الحديقة جميلة»?', ['اسمية', 'فعلية', 'استفهام', 'أمر'], 'اسمية'],
    ]],
    ['كان وأخواتها', 'Kana and related verbs', 'تدخل كان على الجملة الاسمية فترفع المبتدأ ويسمى اسمها وتنصب الخبر ويسمى خبرها: كان الطالب مجتهدًا.', 'Kana keeps its noun nominative and makes its predicate accusative: «كان الطالب مجتهدًا».', [
      ['ما اسم كان في «كان الجو معتدلًا»؟', 'Which is the noun of kana in «كان الجو معتدلًا»?', ['الجو', 'معتدلًا', 'كان', 'لا يوجد'], 'الجو'],
      ['ما خبر كان في «كان الطالب مجتهدًا»؟', 'Which is the predicate of kana in «كان الطالب مجتهدًا»?', ['مجتهدًا', 'الطالب', 'كان', 'الـ'], 'مجتهدًا'],
      ['ما حكم خبر كان؟', 'What case does the predicate of kana take?', ['منصوب', 'مرفوع', 'مجرور', 'مجزوم'], 'منصوب'],
    ]],
    ['الفهم القرائي', 'Reading comprehension', 'الفكرة الرئيسة تلخص موضوع النص، والتفاصيل تدعمها. اقرأ: يحافظ الطالب على وقته، فيقسم يومه بين الدراسة والراحة.', 'A main idea summarizes a text; details support it. Read: A student manages time by balancing study and rest.', [
      ['ما الفكرة الرئيسة للنص: «يقسم الطالب يومه بين الدراسة والراحة»؟', 'What is the main idea of balancing study and rest?', ['تنظيم الوقت', 'السفر', 'الرياضة فقط', 'الطعام'], 'تنظيم الوقت'],
      ['ما مرادف «يحافظ» في «يحافظ على وقته»؟', 'What does «يحافظ» mean in this context?', ['يصون', 'يهدر', 'يضيع', 'ينسى'], 'يصون'],
      ['ما مضاد «الراحة»؟', 'What is the opposite of «الراحة»?', ['التعب', 'السكون', 'الهدوء', 'النوم'], 'التعب'],
    ]],
    ['التشبيه', 'Simile', 'التشبيه يربط بين شيئين في صفة مشتركة. في «العلم كالنور» العلم مشبه، والنور مشبه به، والكاف أداة تشبيه.', 'A simile compares two things through a shared quality. In «العلم كالنور», knowledge is compared to light using «ك».', [
      ['ما أداة التشبيه في «العلم كالنور»؟', 'What is the comparison word in «العلم كالنور»?', ['الكاف', 'العلم', 'النور', 'الـ'], 'الكاف'],
      ['ما المشبه في «الجندي كالأسد»؟', 'What is being compared in «الجندي كالأسد»?', ['الجندي', 'الأسد', 'الكاف', 'لا يوجد'], 'الجندي'],
      ['ما المشبه به في «العلم كالنور»؟', 'What is knowledge compared to in «العلم كالنور»?', ['النور', 'العلم', 'الكاف', 'الجملة'], 'النور'],
    ]],
  ] },
  { ar: 'اللغة الإنجليزية', en: 'English language', domain: 'القواعد والمفردات', domainEn: 'Grammar and vocabulary', skill: 'استخدام اللغة', skillEn: 'Language use', topics: [
    ['المضارع البسيط', 'Present simple', 'نستخدم المضارع البسيط للعادات والحقائق. نضيف s مع he وshe وit: She reads every day.', 'Use the present simple for habits and facts. Add s with he, she and it: She reads every day.', [
      ['اختر: She ___ to school every day.', 'Choose: She ___ to school every day.', ['goes', 'go', 'going', 'gone'], 'goes'],
      ['اختر: They ___ football on Fridays.', 'Choose: They ___ football on Fridays.', ['play', 'plays', 'playing', 'played'], 'play'],
      ['اختر: He ___ not like coffee.', 'Choose: He ___ not like coffee.', ['does', 'do', 'is', 'are'], 'does'],
    ]],
    ['الماضي البسيط', 'Past simple', 'نستخدم الماضي البسيط لحدث انتهى في الماضي. بعض الأفعال منتظمة بإضافة ed، وأخرى شاذة مثل go → went.', 'Use the past simple for finished past events. Regular verbs add ed; irregular verbs change, such as go → went.', [
      ['اختر: Yesterday, I ___ my friend.', 'Choose: Yesterday, I ___ my friend.', ['visited', 'visit', 'visits', 'visiting'], 'visited'],
      ['ما ماضي go؟', 'What is the past tense of go?', ['went', 'goed', 'goes', 'going'], 'went'],
      ['اختر: Did you ___ the film?', 'Choose: Did you ___ the film?', ['watch', 'watched', 'watches', 'watching'], 'watch'],
    ]],
    ['مفردات الحياة المدرسية', 'School vocabulary', 'Library تعني مكتبة، وtimetable تعني جدول الحصص، وassignment تعني واجبًا أو مهمة دراسية.', 'A library holds books, a timetable lists lesson times, and an assignment is a study task.', [
      ['أين نستعير الكتب؟', 'Where can we borrow books?', ['library', 'kitchen', 'garage', 'airport'], 'library'],
      ['ما معنى timetable؟', 'What does timetable mean?', ['جدول الحصص', 'حقيبة', 'قلم', 'ملعب'], 'جدول الحصص'],
      ['أي كلمة تعني واجبًا دراسيًا؟', 'Which word means a study task?', ['assignment', 'holiday', 'journey', 'weather'], 'assignment'],
    ]],
    ['المقارنة والتفضيل', 'Comparatives and superlatives', 'نستخدم taller للمقارنة بين اثنين وthe tallest للتفضيل. مع الصفات الطويلة نستخدم more وthe most.', 'Use taller to compare two people and the tallest for a group. Longer adjectives use more and the most.', [
      ['اختر: Ali is ___ than Omar.', 'Choose: Ali is ___ than Omar.', ['taller', 'tallest', 'tall', 'the tall'], 'taller'],
      ['اختر: This is the ___ building in town.', 'Choose: This is the ___ building in town.', ['tallest', 'taller', 'tall', 'more tall'], 'tallest'],
      ['اختر: This book is ___ interesting than that one.', 'Choose: This book is ___ interesting than that one.', ['more', 'most', 'much', 'many'], 'more'],
    ]],
  ] },
];

function question(subject, topic, raw, key, order = 0) {
  // Rotate choices so the correct answer is not always in the same position.
  const shift = order % raw[2].length;
  const options = [...raw[2].slice(shift), ...raw[2].slice(0, shift)];
  return { id: id(key), text: raw[0], textEn: raw[1], type: 'MCQ', options: JSON.stringify(options),
    optionsEn: JSON.stringify(options), correctAnswer: raw[3], points: 2, xpPoints: 10, order,
    course: subject.ar, courseEn: subject.en, section: topic[0], sectionEn: topic[1],
    domain: subject.domain, domainEn: subject.domainEn, skill: subject.skill, skillEn: subject.skillEn,
    standard: `فهم وتطبيق ${topic[0]}`, standardEn: `Understand and apply ${topic[1]}`,
    learningOutcome: `يطبق الطالب مفاهيم ${topic[0]}`, learningOutcomeEn: `Apply the concepts of ${topic[1]}`,
    indicator: 'يختار الإجابة الصحيحة مع تفسير السبب', indicatorEn: 'Select the correct answer and explain why',
    subskill: 'التطبيق', subskillEn: 'Application', microSkill: 'اختيار الاستراتيجية', microSkillEn: 'Strategy selection',
    errorPattern: 'الخلط بين المفاهيم', errorPatternEn: 'Confusing concepts', level: ['Easy', 'Medium', 'Hard'][order % 3],
    dok: String(1 + order % 3), cognitive: 'Apply', estimatedTime: '60',
    explanation: `${topic[2]} الإجابة الصحيحة: ${raw[3]}.`, explanationEn: `${topic[3]} Correct answer: ${raw[3]}.`,
    hint: `راجع قاعدة ${topic[0]} قبل الإجابة.`, hintEn: `Review ${topic[1]} before answering.` };
}
const jsonQuestion = q => ({ ...q, type: 'QUESTION', label: 'MCQ', options: JSON.parse(q.options), optionsEn: JSON.parse(q.optionsEn), content: q.text, contentEn: q.textEn });

async function main() {
  const host = new URL(process.env.DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw Error('This fixture only targets the local development database.');
  const student = await db.user.findUnique({ where: { username: USERNAME }, include: { school: true } });
  if (!student || student.role !== 'STUDENT' || student.deletedAt || student.status !== 'ACTIVE'
    || student.grade !== 'الصف الأول الثانوي' || student.school?.name !== 'مدرسة الرواد الخاصة - القاهرة') throw Error('Student/school/grade do not match the requested fixture.');
  const creator = await db.user.findFirst({ where: { schoolId: student.schoolId, role: 'SCHOOL_ADMIN', deletedAt: null } });
  if (!creator) throw Error('The school needs an existing school administrator.');
  const teachers = await db.user.findMany({ where: { schoolId: student.schoolId, role: 'TEACHER', deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' } });
  const courseIds = subjects.map((_, c) => id(`course:${c}`));
  const existing = await db.course.count({ where: { id: { in: courseIds } } });
  if (existing && existing !== subjects.length) throw Error('Partial fixture exists; inspect it before adding more data.');
  let xpAdded = 0;
  if (process.argv.includes('--apply') && !existing) {
    await db.$transaction(async tx => {
      // Serialize repeat invocations to avoid duplicate submissions or XP.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(17083008)`;
      if (await tx.course.count({ where: { id: { in: courseIds } } })) throw Error('Fixture already created by another invocation.');
      async function attempt(exam, questions, key, correctCount, daysAgo, child = null, attemptNum = 1) {
        const at = day(-daysAgo);
        const answers = questions.map((q, index) => ({ questionId: q.id, selectedAnswer: index < correctCount ? q.correctAnswer : JSON.parse(q.options).find(option => option !== q.correctAnswer), isCorrect: index < correctCount }));
        const totalScore = questions.filter((_, i) => i < correctCount).reduce((sum, q) => sum + q.points, 0);
        const percentage = totalScore / questions.reduce((sum, q) => sum + q.points, 0) * 100;
        const earned = attemptNum === 1 ? correctCount * 10 : 0;
        const bonus = attemptNum === 1 && correctCount >= 5 ? 10 : 0;
        const reportSnapshot = { ...buildSubmissionSnapshot(exam, child, student, questions, answers, percentage, earned + bonus), capturedAt: at.toISOString() };
        await tx.examSubmission.create({ data: { id: id(key), userId: student.id, examId: exam.id, subExamId: child?.id || null, totalScore, percentage,
          totalTime: questions.length * 65, createdAt: at, reportSnapshot, schoolIdAtSubmission: student.schoolId, gradeAtSubmission: student.grade,
          answers: { create: answers.map((a, i) => ({ ...a, id: id(`${key}:answer:${i}`), userId: student.id, timeTaken: 65, createdAt: at, questionSnapshot: snapshotQuestion(questions[i]) })) } } });
        await tx.xPHistory.createMany({ data: answers.map((a, i) => ({ id: id(`${key}:xp:${i}`), userId: student.id, xp: attemptNum === 1 && a.isCorrect ? 10 : 0,
          sourceType: 'EXAM', sourceId: exam.id, questionId: a.questionId, isCorrect: a.isCorrect, attemptNum, createdAt: at })) });
        if (bonus) await tx.xPHistory.create({ data: { id: id(`${key}:bonus`), userId: student.id, xp: bonus, sourceType: 'EXAM', sourceId: exam.id,
          questionId: 'streak_5', isCorrect: true, attemptNum, isBonus: true, createdAt: at } });
        xpAdded += earned + bonus;
      }
      for (const [c, subject] of subjects.entries()) {
        const courseId = courseIds[c];
        const title = `${subject.ar} — تجربة آدم — أولى ثانوي`;
        await tx.course.create({ data: { id: courseId, title, description: `بيانات تجريبية لاختبار الدروس والتقدم والنتائج. ${subject.en}: school and grade scoped demo.`,
          subject: subject.ar, grade: student.grade, grades: JSON.stringify([student.grade]), schoolId: student.schoolId, creatorId: creator.id, isCentral: false,
          schools: { connect: { id: student.schoolId } }, enrollments: { create: { studentId: student.id } },
          ...(teachers.length ? { teachers: { create: { teacherId: teachers[c % teachers.length].id } } } : {}), createdAt: day(-25) } });
        for (const [l, topic] of subject.topics.entries()) {
          const lessonId = id(`lesson:${c}:${l}`);
          const practice = topic[4].map((raw, q) => jsonQuestion(question(subject, topic, raw, `lesson:${c}:${l}:quiz:${q}`, q)));
          const assignments = topic[4].slice(0, 2).map((raw, q) => jsonQuestion(question(subject, topic, raw, `lesson:${c}:${l}:assignment:${q}`, q)));
          const textSlide = (n, heading, html, headingEn, htmlEn) => ({ id: id(`lesson:${c}:${l}:slide:${n}`), type: 'TEXT', label: 'CONTENT', title: heading,
            content: `<h2>${heading}</h2><p>${html}</p>`, contentEn: `<h2>${headingEn}</h2><p>${htmlEn}</p>`, order: n,
            domain: subject.domain, domainEn: subject.domainEn, learningOutcome: `فهم ${topic[0]}`, learningOutcomeEn: `Understand ${topic[1]}` });
          const slides = [textSlide(0, topic[0], topic[2], topic[1], topic[3]),
            textSlide(1, 'مثال محلول', `${topic[4][0][0]} الإجابة: ${topic[4][0][3]}.`, 'Worked example', `${topic[4][0][1]} Answer: ${topic[4][0][3]}.`),
            { ...jsonQuestion(question(subject, topic, topic[4][1], `lesson:${c}:${l}:slide:2`, 2)), order: 2 },
            textSlide(3, 'ملخص الدرس', `راجع ${topic[0]} ثم حل التدريب والواجب. ${topic[2]}`, 'Lesson summary', `${topic[3]} Complete the practice and assignment.`)];
          await tx.lesson.create({ data: { id: lessonId, courseId, creatorId: creator.id, title: `${l + 1}. ${topic[0]}`, order: l, duration: 900 + l * 120,
            content: `<h2>${topic[0]}</h2><p>${topic[2]}</p>`, summary: topic[2], notes: 'درس تجريبي يحتوي على شرح وتدريب وواجب ومثال محلول.',
            slides, questions: practice, assignments, isVisible: true, isCentral: false, publishDate: l === 3 ? day(2 + c) : day(-20 + l),
            cutOffDate: c === 2 && l === 2 ? day(-1) : day(20 + l), createdAt: day(-25),
            domain: subject.domain, domainEn: subject.domainEn, standards: `فهم وتطبيق ${topic[0]}`, standardsEn: `Understand and apply ${topic[1]}`,
            indicators: 'يحل تدريبات الدرس بصورة صحيحة', indicatorsEn: 'Solve the lesson practice correctly', learningOutcomes: `يطبق مفاهيم ${topic[0]}`, learningOutcomesEn: `Apply ${topic[1]}` } });
          if (l < 3 && !(c === 2 && l === 2)) {
            const completed = l < (3 - c);
            const watched = completed ? 900 + l * 120 : 180;
            await tx.lessonProgress.create({ data: { id: id(`progress:${c}:${l}`), userId: student.id, lessonId, watchedSeconds: watched,
              activeStudySeconds: completed ? 750 + l * 70 : 120, isCompleted: completed, lastActivityAt: day(-3 + l), createdAt: day(-12 + l), updatedAt: day(-3 + l) } });
            const answered = completed ? practice : practice.slice(0, 1);
            for (const [q, item] of answered.entries()) {
              const correct = (q + c) % 3 !== 2;
              await tx.xPHistory.create({ data: { id: id(`lesson-xp:${c}:${l}:${q}`), userId: student.id, xp: correct ? 10 : 0,
                sourceType: 'LESSON_QUIZ', sourceId: lessonId, questionId: item.id, isCorrect: correct, attemptNum: 1, createdAt: day(-3 + l) } });
              xpAdded += correct ? 10 : 0;
            }
          }
        }
        await tx.courseProgress.create({ data: { userId: student.id, courseId, progressPercent: (3 - c) / 4 * 100, lastAccessedAt: day(-1), createdAt: day(-12) } });
        const pool = subject.topics.flatMap(topic => topic[4].map(raw => ({ topic, raw })));
        for (let e = 0; e < 4; e++) {
          const examId = id(`exam:${c}:${e}`);
          const exam = await tx.exam.create({ data: { id: examId, title: `${subject.ar} — ${['اختبار تشخيصي محلول', 'امتحان الوحدة — متاح للحل', 'واجب تطبيقي', 'بنك اختبارات بأقسام'][e]} — تجربة آدم`,
            description: 'محتوى تجريبي لمدرسة الرواد والصف الأول الثانوي، لا يمثل تقييمًا دراسيًا حقيقيًا.', type: ['Quiz', 'Exam', 'Assignment', 'Exam'][e],
            courseId, courseName: title, schoolId: student.schoolId, schools: { connect: { id: student.schoolId } }, grade: student.grade,
            grades: JSON.stringify([student.grade]), subjects: subject.ar, creatorId: creator.id, isCentral: false, status: 'PUBLISHED', duration: e === 1 ? 30 : 20,
            passingScore: 60, attemptsAllowed: e === 0 ? 3 : 2, showAnswers: true, resultVisibility: 'SHOW_ALL',
            startDate: day(-14), endDate: e === 2 && c === 2 ? day(-1) : day(14 + c), createdAt: day(-20), domain: subject.domain, learningOutcomes: `تطبيق مهارات ${subject.ar}` } });
          const createQuestions = async (key, count, offset, moduleId = null, subExamId = null) => {
            const questions = [];
            for (let q = 0; q < count; q++) {
              const entry = pool[(offset + q) % pool.length];
              questions.push(await tx.question.create({ data: { ...question(subject, entry.topic, entry.raw, `${key}:q:${q}`, q), examId, moduleId, subExamId, gradeTarget: student.grade } }));
            }
            return questions;
          };
          if (e < 3) {
            const section = await tx.examModule.create({ data: { id: id(`exam:${c}:${e}:root`), examId, title: exam.title, order: 0,
              domain: subject.domain, domainEn: subject.domainEn, learningOutcomes: `تطبيق مهارات ${subject.ar}`, learningOutcomesEn: `Apply ${subject.en} skills` } });
            const questions = await createQuestions(`exam:${c}:${e}`, [5, 6, 4][e], e * 3, section.id);
            if (e === 0) {
              await attempt(exam, questions, `attempt:${c}:diagnostic:1`, [2, 3, 4][c], 10 - c);
              if (c === 0) await attempt(exam, questions, `attempt:${c}:diagnostic:2`, 5, 3, null, 2);
            }
            if (e === 2 && c === 0) await attempt(exam, questions, `attempt:${c}:homework`, 3, 2);
          } else {
            const module = await tx.examModule.create({ data: { id: id(`module:${c}:root`), examId, title: `الوحدة الأولى — ${subject.ar}`, order: 0,
              domain: subject.domain, domainEn: subject.domainEn, standards: 'تطبيق المفاهيم الأساسية', standardsEn: 'Apply core concepts',
              indicators: 'يجيب عن أسئلة متنوعة', indicatorsEn: 'Answer varied questions', learningOutcomes: 'يحل أسئلة الوحدة', learningOutcomesEn: 'Solve unit questions' } });
            const nested = await tx.examModule.create({ data: { id: id(`module:${c}:nested`), examId, parentModuleId: module.id, title: 'قسم فرعي — مراجعة إضافية', order: 1,
              domain: subject.domain, domainEn: subject.domainEn, learningOutcomes: 'مراجعة المهارات', learningOutcomesEn: 'Review skills' } });
            for (let s = 0; s < 3; s++) {
              const child = await tx.subExam.create({ data: { id: id(`subexam:${c}:${s}`), moduleId: s === 2 ? nested.id : module.id,
                title: ['اختبار فرعي محلول', 'اختبار فرعي متاح', c === 1 ? 'اختبار فرعي انتهى موعده' : 'اختبار فرعي قادم'][s], order: s,
                duration: 10, passingScore: 60, attemptsAllowed: s === 0 ? 1 : 2,
                publishDate: s === 2 && c !== 1 ? day(3) : day(-12), cutOffDate: s === 2 && c === 1 ? day(-1) : day(12) } });
              const questions = await createQuestions(`subexam:${c}:${s}`, 4, s * 4, child.moduleId, child.id);
              if (s === 0) await attempt(exam, questions, `attempt:${c}:subexam`, [2, 4, 3][c], 5 - c, child);
            }
          }
        }
      }
      await tx.user.update({ where: { id: student.id }, data: { xp: { increment: xpAdded } } });
      await tx.activityLog.create({ data: { id: id('audit'), userId: student.id, type: 'DEMO_DATA_SEEDED',
        metadata: JSON.stringify({ fixture: PREFIX, simulated: true, courses: 3, lessons: 12, exams: 12, xpAdded }), timestamp: now } });
    }, { timeout: 60000, maxWait: 10000 });
  }
  // Older local fixtures may predate the student's required root-section format.
  // Only fill missing sections for this fixture; preserve edited content and grades.
  if (process.argv.includes('--apply') && existing === 3) {
    await db.$transaction(async tx => {
      for (const [c, subject] of subjects.entries()) for (let e = 0; e < 3; e++) {
        const examId = id(`exam:${c}:${e}`);
        const exam = await tx.exam.findUnique({ where: { id: examId }, include: { modules: { select: { id: true } } } });
        if (!exam || exam.modules.length) continue;
        const section = await tx.examModule.create({ data: { id: id(`exam:${c}:${e}:root`), examId, title: exam.title, order: 0,
          domain: subject.domain, domainEn: subject.domainEn, learningOutcomes: `تطبيق مهارات ${subject.ar}`, learningOutcomesEn: `Apply ${subject.en} skills` } });
        const questionIds = Array.from({ length: [5, 6, 4][e] }, (_, q) => id(`exam:${c}:${e}:q:${q}`));
        await tx.question.updateMany({ where: { examId, id: { in: questionIds }, moduleId: null, subExamId: null }, data: { moduleId: section.id } });
      }
    });
  }
  const courses = await db.course.findMany({ where: { id: { in: courseIds } }, include: { _count: { select: { lessons: true, exams: true } } }, orderBy: { subject: 'asc' } });
  const examIds = subjects.flatMap((_, c) => Array.from({ length: 4 }, (_, e) => id(`exam:${c}:${e}`)));
  const submissions = await db.examSubmission.findMany({ where: { userId: student.id, examId: { in: examIds } }, select: { id: true, examId: true, subExamId: true, percentage: true, totalScore: true, createdAt: true, _count: { select: { answers: true } } }, orderBy: { createdAt: 'asc' } });
  const summary = { fixture: PREFIX, applied: process.argv.includes('--apply'), alreadyPresent: existing === 3, xpAdded,
    student: { username: student.username, name: student.name, school: student.school.name, grade: student.grade },
    courses: courses.map(course => ({ id: course.id, title: course.title, lessons: course._count.lessons, exams: course._count.exams })),
    questions: await db.question.count({ where: { examId: { in: examIds } } }), modules: await db.examModule.count({ where: { examId: { in: examIds } } }),
    subExams: await db.subExam.count({ where: { module: { examId: { in: examIds } } } }), submissions };
  if (courses.length) {
    if (courses.some(course => course.schoolId !== student.schoolId || course.grade !== student.grade || course.isCentral)) throw Error('Fixture scope verification failed.');
    writeFileSync(resolve(__dirname, '../../artifacts/student-demo-report30_08.json'), JSON.stringify(summary, null, 2));
  }
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
