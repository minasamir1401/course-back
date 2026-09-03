import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function cleanWordHtml(html: string): string {
  if (!html || typeof html !== 'string') return html;
  
  let result = html;
  
  // 1. Remove MSO conditional comments
  result = result.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');

  // 2. Remove <o:p>
  result = result.replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, '');
  result = result.replace(/<\/o:p>/gi, '');

  // 3. Convert Symbol font
  result = result.replace(
    /<span[^>]*font-family:\s*Symbol[^>]*>([\s\S]*?)<\/span>/gi,
    (_match: string, inner: string) => {
      return inner.replace(/·/g, '•').replace(/\uFFFD/g, '•');
    }
  );

  // 4. Convert · to ²
  result = result.replace(/([0-9a-zA-Z)])·(?=\s|=|<|,|\.|\)|$)/g, '$1²');

  // 5. Remove mso-* style properties
  result = result.replace(/\s*mso-[^;:"']+:[^;]*(;|(?="))/gi, '$1');

  // 6. Global smart replacement for remaining \uFFFD (Unicode Replacement Character)
  result = result.replace(/\uFFFD+/g, (match, offset, str) => {
    const before = str.slice(Math.max(0, offset - 10), offset);
    const after = str.slice(offset + match.length, offset + match.length + 10);
    const stripped = (before + after).replace(/<[^>]*>/g, '').trim();

    const beforeDigit = /[\d\s]$/.test(before.replace(/<[^>]*>/g, ''));
    const afterDigit  = /^[\d\s(]/.test(after.replace(/<[^>]*>/g, ''));

    if (beforeDigit && afterDigit) {
      if (/divis|قسم|÷|\//i.test(stripped)) return '÷';
      return '÷'; 
    }

    if (/[\d)a-zA-Z]$/.test(before.replace(/<[^>]*>/g, '')) && /^[\s<,.]/.test(after)) {
      if (match.length === 1) return '²';
      if (match.length === 2) return '³';
    }

    return '';
  });

  return result;
}

function cleanJson(data: any): any {
  if (typeof data === 'string') {
    return cleanWordHtml(data);
  }
  if (Array.isArray(data)) {
    return data.map(item => cleanJson(item));
  }
  if (data !== null && typeof data === 'object') {
    const cleaned: any = {};
    for (const key in data) {
      cleaned[key] = cleanJson(data[key]);
    }
    return cleaned;
  }
  return data;
}

function cleanJsonString(str: string | null): string | null {
  if (!str) return str;
  try {
    const parsed = JSON.parse(str);
    const cleaned = cleanJson(parsed);
    return JSON.stringify(cleaned);
  } catch (e) {
    // If it's not valid JSON, just clean it as a regular string
    return cleanWordHtml(str);
  }
}

async function main() {
  console.log('Starting database repair script to clean \\uFFFD characters...');

  // 1. Clean Questions
  const questions = await prisma.question.findMany();
  let qUpdated = 0;
  for (const q of questions) {
    const cleanedText = cleanWordHtml(q.text);
    const cleanedExplanation = q.explanation ? cleanWordHtml(q.explanation) : null;
    const cleanedOptions = cleanJsonString(q.options);
    const cleanedCorrectAnswer = cleanJsonString(q.correctAnswer);

    if (
      cleanedText !== q.text || 
      cleanedExplanation !== q.explanation ||
      cleanedOptions !== q.options ||
      cleanedCorrectAnswer !== q.correctAnswer
    ) {
      await prisma.question.update({
        where: { id: q.id },
        data: {
          text: cleanedText,
          explanation: cleanedExplanation,
          options: cleanedOptions || '',
          correctAnswer: cleanedCorrectAnswer || ''
        }
      });
      qUpdated++;
    }
  }
  console.log(`Updated ${qUpdated} questions.`);

  // 2. Clean Lessons
  const lessons = await prisma.lesson.findMany();
  let lUpdated = 0;
  for (const l of lessons) {
    const cleanedContent = l.content ? cleanWordHtml(l.content) : null;
    const cleanedSummary = l.summary ? cleanWordHtml(l.summary) : null;
    const cleanedNotes = l.notes ? cleanWordHtml(l.notes) : null;
    
    // JSON fields
    const cleanedQuestions = l.questions ? cleanJson(l.questions) : null;
    const cleanedSlides = l.slides ? cleanJson(l.slides) : null;
    const cleanedAssignments = l.assignments ? cleanJson(l.assignments) : null;
    const cleanedAttachments = l.attachments ? cleanJson(l.attachments) : null;

    if (
      cleanedContent !== l.content ||
      cleanedSummary !== l.summary ||
      cleanedNotes !== l.notes ||
      JSON.stringify(cleanedQuestions) !== JSON.stringify(l.questions) ||
      JSON.stringify(cleanedSlides) !== JSON.stringify(l.slides) ||
      JSON.stringify(cleanedAssignments) !== JSON.stringify(l.assignments) ||
      JSON.stringify(cleanedAttachments) !== JSON.stringify(l.attachments)
    ) {
      await prisma.lesson.update({
        where: { id: l.id },
        data: {
          content: cleanedContent,
          summary: cleanedSummary,
          notes: cleanedNotes,
          questions: cleanedQuestions || undefined,
          slides: cleanedSlides || undefined,
          assignments: cleanedAssignments || undefined,
          attachments: cleanedAttachments || undefined
        }
      });
      lUpdated++;
    }
  }
  console.log(`Updated ${lUpdated} lessons.`);

  // 3. Clean LessonBlocks
  const blocks = await prisma.lessonBlock.findMany();
  let bUpdated = 0;
  for (const b of blocks) {
    const cleanedContent = b.content ? cleanWordHtml(b.content) : null;
    const cleanedOptions = b.options ? cleanJsonString(b.options) : null;
    const cleanedCorrectAnswer = b.correctAnswer ? cleanJsonString(b.correctAnswer) : null;

    if (
      cleanedContent !== b.content ||
      cleanedOptions !== b.options ||
      cleanedCorrectAnswer !== b.correctAnswer
    ) {
      await prisma.lessonBlock.update({
        where: { id: b.id },
        data: {
          content: cleanedContent,
          options: cleanedOptions,
          correctAnswer: cleanedCorrectAnswer
        }
      });
      bUpdated++;
    }
  }
  console.log(`Updated ${bUpdated} lesson blocks.`);

  // 4. Clean DynamicSections
  const sections = await prisma.dynamicSection.findMany();
  let sUpdated = 0;
  for (const s of sections) {
    const cleanedContent = cleanWordHtml(s.content);
    if (cleanedContent !== s.content) {
      await prisma.dynamicSection.update({
        where: { id: s.id },
        data: { content: cleanedContent }
      });
      sUpdated++;
    }
  }
  console.log(`Updated ${sUpdated} dynamic sections.`);

  // 5. Clean InteractiveActivities
  const activities = await prisma.interactiveActivity.findMany();
  let aUpdated = 0;
  for (const a of activities) {
    const cleanedTitle = cleanWordHtml(a.title);
    const cleanedOptions = cleanJsonString(a.options);
    const cleanedCorrectAnswer = cleanJsonString(a.correctAnswer);
    const cleanedHint = a.hint ? cleanWordHtml(a.hint) : null;
    const cleanedTip = a.tip ? cleanWordHtml(a.tip) : null;
    const cleanedExplanation = a.explanation ? cleanWordHtml(a.explanation) : null;
    const cleanedKeyInsight = a.keyInsight ? cleanWordHtml(a.keyInsight) : null;

    if (
      cleanedTitle !== a.title ||
      cleanedOptions !== a.options ||
      cleanedCorrectAnswer !== a.correctAnswer ||
      cleanedHint !== a.hint ||
      cleanedTip !== a.tip ||
      cleanedExplanation !== a.explanation ||
      cleanedKeyInsight !== a.keyInsight
    ) {
      await prisma.interactiveActivity.update({
        where: { id: a.id },
        data: {
          title: cleanedTitle,
          options: cleanedOptions || '',
          correctAnswer: cleanedCorrectAnswer || '',
          hint: cleanedHint,
          tip: cleanedTip,
          explanation: cleanedExplanation,
          keyInsight: cleanedKeyInsight
        }
      });
      aUpdated++;
    }
  }
  console.log(`Updated ${aUpdated} interactive activities.`);

  console.log('Database repair completed successfully.');
}

main()
  .catch(e => {
    console.error('Error in database repair script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
