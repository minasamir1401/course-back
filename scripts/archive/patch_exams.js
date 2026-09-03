const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'routes', 'exams.ts');
let content = fs.readFileSync(filePath, 'utf8');

const startIndex = content.indexOf('const exam = await prisma.$transaction(async (tx) => {');
const endIndexStr = "res.json({ message: 'Exam created successfully', exam });";
const endIndex = content.indexOf(endIndexStr);

if (startIndex > -1 && endIndex > -1) {
  const replacement = `const sanitizedModulesInput = Array.isArray(req.body.modules) ? req.body.modules : [];

    const exam = await prisma.$transaction(async (tx) => {
      const newExam = await tx.exam.create({
        data: {
          title: sanitizeHtml(title),
          description: description ? extractAndSaveBase64Images(sanitizeHtml(description)) : null,
          type: type ? sanitizeHtml(type) : undefined,
          courseId: courseId ? sanitizeHtml(courseId) : null,
          folderId: folderId ? sanitizeHtml(folderId) : null,

          isCentral: req.user.role === 'SUPER_ADMIN' ? !!isCentral : false,
          creatorId: req.user.id,
          schoolId: ownerSchoolId,
          duration: parseInt(duration) || 30,
          passingScore: parseInt(passingScore) || 50,
          skill: req.body.skill ? sanitizeHtml(req.body.skill) : null,
          level: req.body.level ? sanitizeHtml(req.body.level) : "Medium",
          showAnswers: showAnswers !== undefined ? showAnswers : true,
          resultVisibility: req.body.resultVisibility || "SHOW_SCORE",
          password: req.body.password || null,
          startDate: req.body.startDate ? new Date(req.body.startDate) : null,
          endDate: req.body.endDate ? new Date(req.body.endDate) : null,
          attemptsAllowed: parseInt(req.body.attemptsAllowed) || 1,
          status: req.body.status || "PUBLISHED",
          category: req.body.category ? sanitizeHtml(req.body.category) : null,
          grade: grade ? sanitizeHtml(grade) : null,
          grades: Array.isArray(grades) ? JSON.stringify(grades) : (grade ? JSON.stringify([grade]) : null),
          subjects: Array.isArray(subjects) ? JSON.stringify(subjects) : (req.body.category ? JSON.stringify([req.body.category]) : null),
          schools: {
            connect: finalSchoolIds.filter((id: string) => id).map((id: string) => ({ id }))
          }
        }
      });

      // Sequential Module Creation
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

      // Sequential Question Creation
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

      // Return full exam
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
    }, { maxWait: 15000, timeout: 120000 });

    `;

  const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log('Success!');
} else {
  console.log('Failed to find markers.');
}
