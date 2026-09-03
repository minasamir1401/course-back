const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:1j7nhre9vncufdgh@course-course-mmxhlr:5432/postgres' } }
});

async function main() {
  console.log('🔗 Connecting to database...');
  
  const lessons = await prisma.lesson.findMany({
    select: { id: true, title: true, courseId: true, slides: true },
    orderBy: { createdAt: 'asc' }
  });
  
  console.log(`\n📚 Found ${lessons.length} lessons:\n`);
  
  let missingCount = 0;
  for (const l of lessons) {
    let count = 0;
    try { count = l.slides ? JSON.parse(l.slides).length : 0; } catch(e) {}
    const status = count === 0 ? '🔴 MISSING' : count < 5 ? '🟡 FEW   ' : '🟢 OK    ';
    console.log(`${status} | ${count.toString().padStart(3)} slides | [${l.id}] "${l.title}"`);
    if (count === 0) missingCount++;
  }
  
  console.log(`\n📊 Summary: ${lessons.length} total | ${missingCount} missing slides | ${lessons.length - missingCount} have slides`);
  await prisma.$disconnect();
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
