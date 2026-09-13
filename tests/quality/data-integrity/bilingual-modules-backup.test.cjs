require('ts-node/register/transpile-only');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Prisma } = require('@prisma/client');
const source = path.resolve(__dirname, '../../../src/lib/backupSnapshot.ts');
const api = require('fs').existsSync(source) ? require(source) : {};
const models = Prisma.dmmf.datamodel.models;

function database(seed = {}) {
  const tables = Object.fromEntries(
    models.map(m => [
      m.name[0].toLowerCase() + m.name.slice(1),
      new Map((seed[m.name[0].toLowerCase() + m.name.slice(1)] || []).map(r => [r.id, structuredClone(r)]))
    ])
  );
  let txActive = false;
  const tx = {};
  for (const m of models) {
    const key = m.name[0].toLowerCase() + m.name.slice(1);
    const validate = row => {
      for (const rel of m.fields.filter(f => f.kind === 'object' && f.relationFromFields?.length)) {
        const value = row[rel.relationFromFields[0]];
        if (value != null && !tables[rel.type[0].toLowerCase() + rel.type.slice(1)].has(value)) {
          throw Error(`Missing parent ${rel.type}/${value} for ${m.name}`);
        }
      }
    };
    tx[key] = {
      findUnique: async ({ where }) => tables[key].get(where.id),
      findMany: async args => {
        if (!txActive) throw Error('Read outside snapshot');
        if (!args?.take || args.take > 500) throw Error('Unbounded read');
        let rows = [...tables[key].values()].sort((a, b) => a.id.localeCompare(b.id));
        if (args.cursor) rows = rows.slice(rows.findIndex(r => r.id === args.cursor.id) + 1);
        return rows.slice(0, args.take).map(r => structuredClone(r));
      },
      upsert: async ({ where, create, update }) => {
        const row = { ...(tables[key].get(where.id) || create), ...update };
        validate(row);
        tables[key].set(where.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = { ...tables[key].get(where.id), ...data };
        validate(row);
        tables[key].set(where.id, row);
        return row;
      }
    };
  }
  return {
    tables,
    $transaction: async (fn, options) => {
      txActive = true;
      try {
        return await fn(tx);
      } finally {
        txActive = false;
      }
    }
  };
}

describe('Bilingual questions and complex ExamModule / SubExam hierarchy backup and restore', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bilingual-backup-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const complexHierarchyFixture = {
    school: [{ id: 'school-main', name: 'Al-Amal School' }],
    user: [
      { id: 'student-1', name: 'Zaid', username: 'zaid', password: 'hashedpassword', schoolId: 'school-main' }
    ],
    course: [
      { id: 'course-sci', title: 'Science 101', schoolId: 'school-main', schools: [{ id: 'school-main' }] }
    ],
    lesson: [
      { id: 'lesson-1', courseId: 'course-sci', title: 'Intro to Physics' }
    ],
    examFolder: [
      { id: 'folder-midterms', title: 'Midterms 2026', schoolId: 'school-main' }
    ],
    exam: [
      { id: 'exam-root', title: 'Physics Final', folderId: 'folder-midterms', courseId: 'course-sci', schools: [{ id: 'school-main' }] }
    ],
    examModule: [
      { id: 'module-unit-1', examId: 'exam-root', title: 'Mechanics Unit', parentModuleId: null, order: 1 },
      { id: 'submodule-kinematics', examId: 'exam-root', title: 'Kinematics Sub-module', parentModuleId: 'module-unit-1', order: 1 },
      { id: 'submodule-dynamics', examId: 'exam-root', title: 'Dynamics Sub-module', parentModuleId: 'module-unit-1', order: 2 }
    ],
    subExam: [
      { id: 'subexam-motion', moduleId: 'submodule-kinematics', title: '1D Motion Quiz', order: 1, attemptsAllowed: 2 },
      { id: 'subexam-forces', moduleId: 'submodule-dynamics', title: 'Newton Laws Quiz', order: 1, attemptsAllowed: 1 }
    ],
    question: [
      {
        id: 'q-bilingual-1',
        examId: 'exam-root',
        moduleId: 'submodule-kinematics',
        subExamId: 'subexam-motion',
        text: 'ما هي وحدة قياس السرعة؟',
        textEn: 'What is the unit of velocity?',
        options: JSON.stringify(['متر/ثانية', 'كيلوجرام', 'جول', 'نيوتن']),
        optionsEn: JSON.stringify(['m/s', 'kg', 'J', 'N']),
        correctAnswer: '0',
        explanation: 'السرعة تقاس بالمتر لكل ثانية في النظام الدولي.',
        explanationEn: 'Velocity is measured in meters per second in the SI system.',
        imageUrl: '/uploads/velocity-diagram.png',
        xpPoints: 15,
        indicator: 'mechanics-speed',
        order: 1
      },
      {
        id: 'q-bilingual-2',
        examId: 'exam-root',
        moduleId: 'submodule-dynamics',
        subExamId: 'subexam-forces',
        text: 'ما هو قانون نيوتن الثاني؟',
        textEn: 'What is Newton\'s Second Law?',
        options: JSON.stringify(['القوة = الكتلة × التسارع', 'الطاقة لا تفنى', 'لكل فعل رد فعل']),
        optionsEn: JSON.stringify(['F = m * a', 'Conservation of energy', 'Action equals reaction']),
        correctAnswer: '0',
        explanation: 'القوة تساوي حاصل ضرب الكتلة في التسارع.',
        explanationEn: 'Force equals mass multiplied by acceleration.',
        xpPoints: 20,
        indicator: 'newton-law-2',
        order: 2
      }
    ],
    examSubmission: [
      { id: 'subm-1', examId: 'exam-root', subExamId: 'subexam-motion', userId: 'student-1', totalScore: 15 }
    ],
    studentAnswer: [
      { id: 'ans-1', submissionId: 'subm-1', questionId: 'q-bilingual-1', userId: 'student-1', selectedAnswer: '0', isCorrect: true }
    ]
  };

  test('snapshot correctly exports full exam hierarchy and bilingual questions', async () => {
    const backupFile = path.join(tempDir, 'bilingual-backup.json');
    const sourceDb = database(complexHierarchyFixture);

    await api.writeFullSnapshot(sourceDb, backupFile);

    const snapshot = JSON.parse(await fs.readFile(backupFile, 'utf8'));

    // Check version
    expect(snapshot.version).toBe('2.0');

    // Check exam modules (parent and children)
    expect(snapshot.data.examModule).toHaveLength(3);
    const rootMod = snapshot.data.examModule.find(m => m.id === 'module-unit-1');
    const childMod1 = snapshot.data.examModule.find(m => m.id === 'submodule-kinematics');
    const childMod2 = snapshot.data.examModule.find(m => m.id === 'submodule-dynamics');
    expect(rootMod.parentModuleId).toBeNull();
    expect(childMod1.parentModuleId).toBe('module-unit-1');
    expect(childMod2.parentModuleId).toBe('module-unit-1');

    // Check subExams
    expect(snapshot.data.subExam).toHaveLength(2);
    expect(snapshot.data.subExam.map(s => s.id).sort()).toEqual(['subexam-forces', 'subexam-motion']);

    // Check bilingual fields on questions
    expect(snapshot.data.question).toHaveLength(2);
    const q1 = snapshot.data.question.find(q => q.id === 'q-bilingual-1');
    expect(q1.text).toBe('ما هي وحدة قياس السرعة؟');
    expect(q1.textEn).toBe('What is the unit of velocity?');
    expect(q1.optionsEn).toBe(JSON.stringify(['m/s', 'kg', 'J', 'N']));
    expect(q1.explanationEn).toBe('Velocity is measured in meters per second in the SI system.');
    expect(q1.moduleId).toBe('submodule-kinematics');
    expect(q1.subExamId).toBe('subexam-motion');

    // Check submission and student answers
    expect(snapshot.data.examSubmission).toHaveLength(1);
    expect(snapshot.data.examSubmission[0].subExamId).toBe('subexam-motion');
    expect(snapshot.data.studentAnswer).toHaveLength(1);
    expect(snapshot.data.studentAnswer[0].questionId).toBe('q-bilingual-1');
  });

  test('restoreSnapshot restores hierarchy, relations, and bilingual question fields accurately', async () => {
    const backupFile = path.join(tempDir, 'bilingual-backup.json');
    const sourceDb = database(complexHierarchyFixture);

    await api.writeFullSnapshot(sourceDb, backupFile);
    const snapshot = JSON.parse(await fs.readFile(backupFile, 'utf8'));

    const targetDb = database();
    await api.restoreSnapshot(targetDb, snapshot);

    // Verify all tables populated in target database
    expect(targetDb.tables.examModule.size).toBe(3);
    expect(targetDb.tables.subExam.size).toBe(2);
    expect(targetDb.tables.question.size).toBe(2);
    expect(targetDb.tables.examSubmission.size).toBe(1);
    expect(targetDb.tables.studentAnswer.size).toBe(1);

    // Verify parentModuleId relationship restored
    const restoredChildMod = targetDb.tables.examModule.get('submodule-kinematics');
    expect(restoredChildMod.parentModuleId).toBe('module-unit-1');

    // Verify bilingual fields restored verbatim
    const restoredQ1 = targetDb.tables.question.get('q-bilingual-1');
    expect(restoredQ1.text).toBe('ما هي وحدة قياس السرعة؟');
    expect(restoredQ1.textEn).toBe('What is the unit of velocity?');
    expect(restoredQ1.optionsEn).toBe(JSON.stringify(['m/s', 'kg', 'J', 'N']));
    expect(restoredQ1.explanationEn).toBe('Velocity is measured in meters per second in the SI system.');
    expect(restoredQ1.moduleId).toBe('submodule-kinematics');
    expect(restoredQ1.subExamId).toBe('subexam-motion');

    // Verify submission and answer links
    const restoredSubm = targetDb.tables.examSubmission.get('subm-1');
    expect(restoredSubm.subExamId).toBe('subexam-motion');
    expect(restoredSubm.userId).toBe('student-1');

    const restoredAns = targetDb.tables.studentAnswer.get('ans-1');
    expect(restoredAns.questionId).toBe('q-bilingual-1');
    expect(restoredAns.isCorrect).toBe(true);
  });

  test('restoreExamWithHierarchy selectively restores an exam with its full module hierarchy and bilingual questions', async () => {
    const { restoreExamWithHierarchy } = require('../../../src/controllers/backups.controller');
    expect(typeof restoreExamWithHierarchy).toBe('function');

    const targetDb = database({
      school: complexHierarchyFixture.school,
      examFolder: complexHierarchyFixture.examFolder,
      course: [{ id: 'new-target-course-id', title: 'Target Course', schoolId: 'school-main' }]
    });
    await targetDb.$transaction(async (tx) => {
      await restoreExamWithHierarchy(
        tx,
        complexHierarchyFixture.exam[0],
        complexHierarchyFixture,
        'new-target-course-id'
      );
    });

    // Check exam
    const exam = targetDb.tables.exam.get('exam-root');
    expect(exam).toBeDefined();
    expect(exam.courseId).toBe('new-target-course-id');
    expect(exam.title).toBe('Physics Final');

    // Check modules and submodules
    expect(targetDb.tables.examModule.size).toBe(3);
    const parentMod = targetDb.tables.examModule.get('module-unit-1');
    expect(parentMod.parentModuleId).toBeNull();
    const childMod1 = targetDb.tables.examModule.get('submodule-kinematics');
    expect(childMod1.parentModuleId).toBe('module-unit-1');

    // Check subExams
    expect(targetDb.tables.subExam.size).toBe(2);
    const subExam1 = targetDb.tables.subExam.get('subexam-motion');
    expect(subExam1.moduleId).toBe('submodule-kinematics');

    // Check questions with bilingual fields
    expect(targetDb.tables.question.size).toBe(2);
    const q1 = targetDb.tables.question.get('q-bilingual-1');
    expect(q1.text).toBe('ما هي وحدة قياس السرعة؟');
    expect(q1.textEn).toBe('What is the unit of velocity?');
    expect(q1.optionsEn).toBe(JSON.stringify(['m/s', 'kg', 'J', 'N']));
    expect(q1.explanationEn).toBe('Velocity is measured in meters per second in the SI system.');
    expect(q1.moduleId).toBe('submodule-kinematics');
    expect(q1.subExamId).toBe('subexam-motion');
  });
});
