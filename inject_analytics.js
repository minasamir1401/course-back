const fs = require('fs');

const routeCode = `
router.get('/api/exams/:id/analytics', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const exam = await prisma.exam.findUnique({
      where: { id },
      include: {
        schools: true,
        modules: {
          include: {
            subExams: true
          },
          orderBy: { order: 'asc' }
        },
        questions: {
          select: { id: true, text: true, moduleId: true, subExamId: true, type: true, points: true }
        }
      }
    });

    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    
    // Check permission
    if (
      (req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'TEACHER') &&
      exam.schoolId !== req.user.schoolId &&
      !exam.schools.some(s => s.id === req.user.schoolId)
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const where = { examId: id };
    if (req.user.role === 'SCHOOL_ADMIN' || req.user.role === 'TEACHER') {
      where.user = { schoolId: req.user.schoolId };
    }

    const submissions = await prisma.examSubmission.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, schoolId: true, school: { select: { name: true } } }
        },
        answers: {
          select: { questionId: true, isCorrect: true }
        }
      }
    });

    // 1. Overall Stats
    const totalSubmissions = submissions.length;
    const passCount = submissions.filter(s => (s.percentage || 0) >= (exam.passingScore || 50)).length;
    const passRate = totalSubmissions > 0 ? (passCount / totalSubmissions) * 100 : 0;
    const avgScore = totalSubmissions > 0 ? submissions.reduce((acc, s) => acc + (s.percentage || 0), 0) / totalSubmissions : 0;
    const totalExamPoints = exam.questions.reduce((acc, q) => acc + (q.points || 1), 0);

    // 2. Module Stats
    const moduleStats = exam.modules.map(mod => {
      const modQuestions = exam.questions.filter(q => q.moduleId === mod.id).map(q => q.id);
      let correctAnswers = 0;
      let totalAnswers = 0;
      
      submissions.forEach(sub => {
        sub.answers.forEach(ans => {
          if (modQuestions.includes(ans.questionId)) {
            totalAnswers++;
            if (ans.isCorrect) correctAnswers++;
          }
        });
      });
      
      return {
        id: mod.id,
        title: mod.title,
        correctRate: totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0,
        totalAnswers
      };
    });

    // 3. SubExam Stats
    const subExamStats = exam.modules.flatMap(m => m.subExams || []).map(se => {
      const seQuestions = exam.questions.filter(q => q.subExamId === se.id).map(q => q.id);
      let correctAnswers = 0;
      let totalAnswers = 0;
      
      submissions.forEach(sub => {
        sub.answers.forEach(ans => {
          if (seQuestions.includes(ans.questionId)) {
            totalAnswers++;
            if (ans.isCorrect) correctAnswers++;
          }
        });
      });
      
      return {
        id: se.id,
        title: se.title,
        moduleId: se.moduleId,
        correctRate: totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0,
        totalAnswers
      };
    });

    // 4. Question Stats
    const questionStats = exam.questions.map(q => {
      let correctAnswers = 0;
      let totalAnswers = 0;
      
      submissions.forEach(sub => {
        const ans = sub.answers.find(a => a.questionId === q.id);
        if (ans) {
          totalAnswers++;
          if (ans.isCorrect) correctAnswers++;
        }
      });
      
      return {
        id: q.id,
        text: q.text,
        type: q.type,
        moduleId: q.moduleId,
        subExamId: q.subExamId,
        correctRate: totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0
      };
    }).sort((a, b) => b.correctRate - a.correctRate); // Easiest to hardest

    // 5. School Stats (For Super Admin)
    const schoolStats = [];
    if (req.user.role === 'SUPER_ADMIN') {
      const schoolsMap = {};
      submissions.forEach(sub => {
        const sId = sub.user.schoolId || 'unassigned';
        const sName = sub.user.school?.name || 'Unassigned';
        
        if (!schoolsMap[sId]) {
          schoolsMap[sId] = { id: sId, name: sName, count: 0, totalScore: 0 };
        }
        schoolsMap[sId].count++;
        schoolsMap[sId].totalScore += (sub.percentage || 0);
      });
      
      for (const key in schoolsMap) {
        schoolStats.push({
          id: schoolsMap[key].id,
          name: schoolsMap[key].name,
          count: schoolsMap[key].count,
          avgScore: schoolsMap[key].totalScore / schoolsMap[key].count
        });
      }
    }

    res.json({
      exam: {
        id: exam.id,
        title: exam.title,
        totalPoints: totalExamPoints,
        questionsCount: exam.questions.length
      },
      overall: {
        totalSubmissions,
        passRate,
        avgScore
      },
      modules: moduleStats,
      subExams: subExamStats,
      questions: questionStats,
      schools: schoolStats,
      students: submissions.map(s => ({
        id: s.id,
        userId: s.user.id,
        name: s.user.name,
        schoolName: s.user.school?.name,
        score: s.totalScore,
        percentage: s.percentage,
        createdAt: s.createdAt
      }))
    });
  } catch (error) {
    console.error('Error generating analytics:', error);
    res.status(500).json({ error: 'Failed to generate analytics' });
  }
});
`;

let content = fs.readFileSync('src/routes/exams.ts', 'utf8');
content = content.replace('// ==========================================\n// ♻️ RESTORE ENDPOINTS', '// ==========================================\n// 📊 REPORTS & ANALYTICS\n' + routeCode + '\n// ==========================================\n// ♻️ RESTORE ENDPOINTS');
fs.writeFileSync('src/routes/exams.ts', content);
console.log('Done injecting analytics route');
