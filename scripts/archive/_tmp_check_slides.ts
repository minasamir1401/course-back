import prisma from './src/lib/prisma';

async function check() {
  const lessons = await prisma.lesson.findMany({
    select: { id: true, title: true, slides: true, course: { select: { title: true } } }
  });

  let emptyCount = 0;
  let arrayCount = 0;
  let stringCount = 0;
  
  for (const l of lessons) {
    if (!l.slides) {
      emptyCount++;
    } else if (Array.isArray(l.slides)) {
      arrayCount++;
      if (l.slides.length === 0) emptyCount++;
    } else if (typeof l.slides === 'string') {
      stringCount++;
      try {
        const p = JSON.parse(l.slides);
        if (Array.isArray(p) && p.length === 0) emptyCount++;
      } catch (e) {}
    }
  }

  console.log(`Total Lessons: ${lessons.length}`);
  console.log(`Empty/No Slides: ${emptyCount}`);
  console.log(`Array Slides: ${arrayCount}`);
  console.log(`String Slides: ${stringCount}`);
  
  // Show a few that have slides
  const withSlides = lessons.filter(l => {
    if (!l.slides) return false;
    if (Array.isArray(l.slides)) return l.slides.length > 0;
    if (typeof l.slides === 'string') {
        try { const p = JSON.parse(l.slides); return Array.isArray(p) && p.length > 0; } catch { return false; }
    }
    return false;
  }).slice(0, 5);
  
  for (const w of withSlides) {
      let count = 0;
      if (Array.isArray(w.slides)) count = w.slides.length;
      else if (typeof w.slides === 'string') count = JSON.parse(w.slides).length;
      console.log(`- Course: ${w.course.title} | Lesson: ${w.title} | Slides: ${count}`);
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
