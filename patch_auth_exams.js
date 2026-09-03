const fs = require('fs');

const path = 'd:/mina/back/src/controllers/exams.controller.ts';
let code = fs.readFileSync(path, 'utf8');

// Patch putExamHandler5 (edit exam)
code = code.replace(
  `    if ((req as any).user.role !== 'SUPER_ADMIN') {
      const isOwnerOrAssigned =
        existingExam.schoolId === (req as any).user.schoolId ||
        existingExam.schools?.some((s: any) => s.id === (req as any).user.schoolId) ||
        existingExam.isCentral;

      if (!isOwnerOrAssigned) {
        return res.status(403).json({ error: 'Access denied: You do not have permission to edit this exam.' });
      }
    }`,
  `    if ((req as any).user.role !== 'SUPER_ADMIN') {
      const isCreator = existingExam.creatorId === (req as any).user.id;
      const belongsToSchool = existingExam.schoolId === (req as any).user.schoolId || existingExam.schools?.some((s: any) => s.id === (req as any).user.schoolId);
      
      // Allow if creator, or if it belongs to school (and not central unless created by them)
      if (!isCreator && !belongsToSchool) {
        return res.status(403).json({ error: 'Access denied: You do not have permission to edit this exam.' });
      }
    }`
);

// Patch deleteExamHandler6
code = code.replace(
  `    // Authorization check
    if ((req as any).user.role === 'SCHOOL_ADMIN' && exam.schoolId !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied: You can only delete exams belonging to your school.' });
    }`,
  `    // Authorization check
    if ((req as any).user.role !== 'SUPER_ADMIN') {
      const isCreator = exam.creatorId === (req as any).user.id;
      const belongsToSchool = exam.schoolId === (req as any).user.schoolId || exam.schools?.some((s: any) => s.id === (req as any).user.schoolId);
      if (!isCreator && !belongsToSchool) {
        return res.status(403).json({ error: 'Access denied: You can only delete exams belonging to your school.' });
      }
    }`
);

// Patch postExamHandler7 (restore exam)
code = code.replace(
  `    if ((req as any).user.role === 'SCHOOL_ADMIN' && exam.schoolId !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied: You can only restore exams belonging to your school.' });
    }`,
  `    if ((req as any).user.role !== 'SUPER_ADMIN') {
      const isCreator = exam.creatorId === (req as any).user.id;
      const belongsToSchool = exam.schoolId === (req as any).user.schoolId || exam.schools?.some((s: any) => s.id === (req as any).user.schoolId);
      if (!isCreator && !belongsToSchool) {
        return res.status(403).json({ error: 'Access denied: You can only restore exams belonging to your school.' });
      }
    }`
);

// Patch postExamHandler8 (restore question)
code = code.replace(
  `    if ((req as any).user.role === 'SCHOOL_ADMIN' && question.exam?.schoolId !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied: You can only restore questions belonging to your school.' });
    }`,
  `    if ((req as any).user.role !== 'SUPER_ADMIN') {
      const isCreator = question.exam?.creatorId === (req as any).user.id;
      const belongsToSchool = question.exam?.schoolId === (req as any).user.schoolId || question.exam?.schools?.some((s: any) => s.id === (req as any).user.schoolId);
      if (!isCreator && !belongsToSchool) {
        return res.status(403).json({ error: 'Access denied: You can only restore questions belonging to your school.' });
      }
    }`
);

fs.writeFileSync(path, code);
console.log('Patched exams.controller.ts');
