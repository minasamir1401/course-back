const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Check ALL ExamModules in the DB
  const allModules = await p.examModule.findMany({
    include: { 
      questions: { select: { id: true } }
    }
  });
  console.log('=== ALL EXAM MODULES IN DB ===');
  console.log('Total modules:', allModules.length);
  for (const m of allModules) {
    console.log(`  Module: ${m.id} | examId: ${m.examId} | title: ${m.title} | questions: ${m.questions.length}`);
  }

  // Check the specific exam
  const examId = '9eaa5dab-afb4-4556-b865-f5880e2749b9';
  console.log('\n=== EXAM:', examId, '===');
  
  const exam = await p.exam.findUnique({
    where: { id: examId },
    include: {
      modules: { include: { questions: true } },
      questions: { where: { deletedAt: null }, select: { id: true, moduleId: true, text: true } }
    }
  });
  
  if (!exam) {
    console.log('EXAM NOT FOUND!');
    return;
  }
  
  console.log('Exam title:', exam.title);
  console.log('Exam modules:', exam.modules.length);
  console.log('Exam questions:', exam.questions.length);
  
  for (const q of exam.questions) {
    console.log(`  Q: moduleId=${q.moduleId || 'NULL'} | text=${String(q.text||'').substring(0,30)}`);
  }
  
  // Also check all exams that have modules
  const examsWithModules = await p.examModule.groupBy({
    by: ['examId'],
    _count: { id: true }
  });
  console.log('\n=== EXAMS WITH MODULES ===');
  for (const e of examsWithModules) {
    console.log(`  examId: ${e.examId} | module count: ${e._count.id}`);
  }
}

main().catch(e => console.error('ERROR:', e.message, e.code)).finally(() => p.$disconnect());
