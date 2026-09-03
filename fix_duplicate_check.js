const fs = require('fs');
const path = 'src/routes/exams.ts';
let content = fs.readFileSync(path, 'utf8');

const updatedContent = content.replace(
  /const existingExam = await prisma\.exam\.findFirst\(\{\s*where: \{\s*title,\s*schoolId: ownerSchoolId,\s*courseId,\s*deletedAt: null\s*\}\s*\}\);\s*if \(existingExam\) \{\s*return res\.status\(400\)\.json\(\{ error: '.*?' \}\);\s*\}/,
  `if (req.body.status !== 'DRAFT') {
      const existingExam = await prisma.exam.findFirst({
        where: {
          title,
          schoolId: ownerSchoolId,
          courseId,
          deletedAt: null,
          status: { not: 'DRAFT' }
        }
      });
      if (existingExam) {
        return res.status(400).json({ error: 'يوجد امتحان بنفس هذا العنوان مسجل مسبقاً.' });
      }
    }`
);

if (content !== updatedContent) {
  fs.writeFileSync(path, updatedContent, 'utf8');
  console.log('Successfully updated exams.ts');
} else {
  console.log('Target not found in exams.ts');
}
