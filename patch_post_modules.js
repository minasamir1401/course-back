/**
 * This script patches the backend exams.ts POST handler to fix modules not being saved.
 * Root cause: Prisma nested `create` for modules+questions in one call doesn't guarantee
 * modules are committed before questions try to reference them via FK.
 * Fix: Sequential creation - create exam, then modules, then questions.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'routes', 'exams.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Find the transaction block for exam creation (POST)
// We'll replace the part from "const sanitizedQuestions = sanitizeDeep" 
// to the end of the first router.post transaction

const OLD_TRANSACTION_START = `    const sanitizedQuestions = sanitizeDeep(questions || []);

    const exam = await prisma.$transaction(async (tx) => {
      const newExam = await tx.exam.create({
        data: {`;

const hasOldCode = content.includes(OLD_TRANSACTION_START);
console.log('Found old transaction code:', hasOldCode);

if (!hasOldCode) {
  console.log('Pattern not found - maybe already patched or code is different');
  // Try to find what's there
  const idx = content.indexOf('sanitizedQuestions = sanitizeDeep');
  if (idx > -1) {
    console.log('Context around sanitizedQuestions:');
    console.log(content.substring(idx - 50, idx + 200));
  }
  process.exit(1);
}

const NEW_TRANSACTION = `    const sanitizedQuestions = sanitizeDeep(questions || []);
    const sanitizedModulesInput = Array.isArray(req.body.modules) ? req.body.modules : [];

    const exam = await prisma.$transaction(async (tx) => {
      // Step 1: Create the exam (without modules/questions) 
      const newExam = await tx.exam.create({
        data: {`;

content = content.replace(OLD_TRANSACTION_START, NEW_TRANSACTION);

// Now find and replace the modules nested create section within POST
// We need to replace from `modules: {` to `questions: {` in the POST create

const OLD_MODULES_NESTED = `          schools: {
            connect: finalSchoolIds.filter((id: string) => id).map((id: string) => ({ id }))
          },
          modules: {
            create: Array.isArray(req.body.modules) ? req.body.modules.map((m: any, index: number) => ({
              id: m.id || undefined,
              title: m.title ? sanitizeHtml(m.title) : \`Module \${index + 1}\`,
              description: m.description ? sanitizeHtml(m.description) : null,
              order: m.order !== undefined ? parseInt(m.order) : index,
              duration: m.duration ? parseInt(m.duration) : null,
              passingScore: m.passingScore ? parseInt(m.passingScore) : null,
              subExams: {
                create: Array.isArray(m.subExams) ? m.subExams.map((s: any, sIdx: number) => ({
                  id: s.id || undefined,
                  title: s.title ? sanitizeHtml(s.title) : \`Sub-Exam \${sIdx + 1}\`,
                  duration: s.duration ? parseInt(s.duration) : null,
                  passingScore: s.passingScore ? parseInt(s.passingScore) : null,
                  attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
                  order: s.order !== undefined ? parseInt(s.order) : sIdx,
                })) : []
              }
            })) : []
          },
          questions: {
            create: sanitizedQuestions.map((q: any, index: number) => ({
              text: extractAndSaveBase64Images(sanitizeHtml(q.text || '')),
              type: q.type ? sanitizeHtml(q.type) : 'MCQ',
              options: extractAndSaveBase64Images(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])),
              correctAnswer: formatCorrectAnswer(q),
              points: parseInt(q.points) || 1,
              xpPoints: parseInt(q.xpPoints) || 10,
              skill: q.skill ? sanitizeHtml(q.skill) : null,
              standard: q.standard ? sanitizeHtml(q.standard) : null,
              learningOutcome: q.learningOutcome ? sanitizeHtml(q.learningOutcome) : null,
              indicator: q.indicator ? sanitizeHtml(q.indicator) : null,
              videoUrl: q.videoUrl ? sanitizeHtml(q.videoUrl) : null,
              level: q.level ? sanitizeHtml(q.level) : 'Medium',
              dok: q.dok ? sanitizeHtml(q.dok) : null,
              course: q.course ? sanitizeHtml(q.course) : null,
              section: q.section ? sanitizeHtml(q.section) : null,
              domain: q.domain ? sanitizeHtml(q.domain) : null,
              subskill: q.subskill ? sanitizeHtml(q.subskill) : null,
              microSkill: q.microSkill ? sanitizeHtml(q.microSkill) : null,
              gradeTarget: q.gradeTarget ? sanitizeHtml(q.gradeTarget) : null,
              errorPattern: q.errorPattern ? sanitizeHtml(q.errorPattern) : null,
              estimatedTime: q.estimatedTime ? sanitizeHtml(q.estimatedTime) : null,
              explanation: formatExplanation(q),
              imageUrl: q.imageUrl ? extractAndSaveBase64Images(sanitizeHtml(q.imageUrl)) : null,
              moduleId: q.moduleId ? sanitizeHtml(q.moduleId) : null,
              subExamId: q.subExamId ? sanitizeHtml(q.subExamId) : null,
              order: index
            }))
          }
        },
        include: {
          questions: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
          },
          modules: {
            orderBy: { order: 'asc' },
            include: { subExams: { orderBy: { order: 'asc' } } }
          }
        }
      });
      return sanitizeExam(newExam);
    }, { maxWait: 15000, timeout: 120000 });`;

const NEW_SEQUENTIAL = `          schools: {
            connect: finalSchoolIds.filter((id: string) => id).map((id: string) => ({ id }))
          },
        }
      });

      // Step 2: Create modules SEQUENTIALLY so FK constraints are satisfied before questions
      const moduleIdMap: Record<string, string> = {};
      for (let i = 0; i < sanitizedModulesInput.length; i++) {
        const m = sanitizedModulesInput[i];
        const frontendModuleId = m.id;
        const createdMod = await tx.examModule.create({
          data: {
            examId: newExam.id,
            title: m.title ? sanitizeHtml(m.title) : \`Module \${i + 1}\`,
            description: m.description ? sanitizeHtml(m.description) : null,
            order: m.order !== undefined ? parseInt(m.order) : i,
            duration: m.duration ? parseInt(m.duration) : null,
            passingScore: m.passingScore ? parseInt(m.passingScore) : null,
          }
        });
        if (frontendModuleId) moduleIdMap[frontendModuleId] = createdMod.id;
        const subExamsInput = Array.isArray(m.subExams) ? m.subExams : [];
        for (let j = 0; j < subExamsInput.length; j++) {
          const s = subExamsInput[j];
          await tx.subExam.create({
            data: {
              moduleId: createdMod.id,
              title: s.title ? sanitizeHtml(s.title) : \`Sub-Exam \${j + 1}\`,
              duration: s.duration ? parseInt(s.duration) : null,
              passingScore: s.passingScore ? parseInt(s.passingScore) : null,
              attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
              order: s.order !== undefined ? parseInt(s.order) : j,
            }
          });
        }
      }

      // Step 3: Create questions resolving moduleId via the map
      for (let index = 0; index < sanitizedQuestions.length; index++) {
        const q = sanitizedQuestions[index];
        const resolvedModuleId = q.moduleId
          ? (moduleIdMap[sanitizeHtml(q.moduleId)] || null)
          : null;
        await tx.question.create({
          data: {
            examId: newExam.id,
            text: extractAndSaveBase64Images(sanitizeHtml(q.text || '')),
            type: q.type ? sanitizeHtml(q.type) : 'MCQ',
            options: extractAndSaveBase64Images(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])),
            correctAnswer: formatCorrectAnswer(q),
            points: parseInt(q.points) || 1,
            xpPoints: parseInt(q.xpPoints) || 10,
            skill: q.skill ? sanitizeHtml(q.skill) : null,
            standard: q.standard ? sanitizeHtml(q.standard) : null,
            learningOutcome: q.learningOutcome ? sanitizeHtml(q.learningOutcome) : null,
            indicator: q.indicator ? sanitizeHtml(q.indicator) : null,
            videoUrl: q.videoUrl ? sanitizeHtml(q.videoUrl) : null,
            level: q.level ? sanitizeHtml(q.level) : 'Medium',
            dok: q.dok ? sanitizeHtml(q.dok) : null,
            course: q.course ? sanitizeHtml(q.course) : null,
            section: q.section ? sanitizeHtml(q.section) : null,
            domain: q.domain ? sanitizeHtml(q.domain) : null,
            subskill: q.subskill ? sanitizeHtml(q.subskill) : null,
            microSkill: q.microSkill ? sanitizeHtml(q.microSkill) : null,
            gradeTarget: q.gradeTarget ? sanitizeHtml(q.gradeTarget) : null,
            errorPattern: q.errorPattern ? sanitizeHtml(q.errorPattern) : null,
            estimatedTime: q.estimatedTime ? sanitizeHtml(q.estimatedTime) : null,
            explanation: formatExplanation(q),
            imageUrl: q.imageUrl ? extractAndSaveBase64Images(sanitizeHtml(q.imageUrl)) : null,
            moduleId: resolvedModuleId,
            subExamId: q.subExamId ? sanitizeHtml(q.subExamId) : null,
            order: index
          }
        });
      }

      // Step 4: Return full exam with modules and questions
      const fullExam = await tx.exam.findUnique({
        where: { id: newExam.id },
        include: {
          questions: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
          },
          modules: {
            orderBy: { order: 'asc' },
            include: { subExams: { orderBy: { order: 'asc' } } }
          }
        }
      });
      return sanitizeExam(fullExam);
    }, { maxWait: 15000, timeout: 120000 });`;

const hasOldModules = content.includes(OLD_MODULES_NESTED.substring(0, 100));
console.log('Found old modules code:', hasOldModules);

if (hasOldModules) {
  content = content.replace(OLD_MODULES_NESTED, NEW_SEQUENTIAL);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Successfully patched exams.ts POST handler');
  console.log('Modules will now be created sequentially BEFORE questions');
} else {
  console.log('❌ Could not find the exact pattern to replace');
  console.log('Showing content around "modules: {" in POST...');
  const idx = content.indexOf('modules: {\n            create: Array.isArray(req.body.modules)');
  if (idx > -1) {
    console.log(content.substring(idx, idx + 500));
  }
}
