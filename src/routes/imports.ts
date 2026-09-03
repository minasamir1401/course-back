import express from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken, checkRole } from '../middleware/auth';
import { sanitizeDeep, multerUpload } from '../shared';
import * as xlsx from 'xlsx';
import { syncCourseToCloud } from '../lib/db-backup';
// runGlobalDeduplication removed — deduplication is now MANUAL ONLY via admin endpoint

const prisma = new PrismaClient();
const router = express.Router();

// Helper to safely parse strings into JSON if they look like JSON, otherwise return text or default structure
// Helper to safely parse strings into JSON if they look like JSON, otherwise return text or default structure
function parseComplexCell(str: string | null | undefined, fieldType: 'slides' | 'assignments' | 'questions' | 'attachments'): any {
  if (!str) return [];
  if (typeof str !== 'string') return str;

  // If it's already JSON, try parsing it
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object') {
      return Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch (e) {
    // Not valid JSON. Let's process simplified text format or default structure based on type.
  }

  // Wrap raw text or tag-based text into a standard format
  if (fieldType === 'slides') {
    // Try splitting multiple slides by || or newlines if tagged with [SLIDE]
    if (str.includes('[SLIDE]') || str.includes('||')) {
      const parts = str.split(/(?:\[SLIDE\]|\|\|)/i).map(s => s.trim()).filter(Boolean);
      return parts.map((content, idx) => ({ id: (Date.now() + idx).toString(), type: 'TEXT', label: 'CONTENT', title: `الشريحة ${idx + 1}`, content, sections: [] }));
    }
    return [{ id: Date.now().toString(), type: 'TEXT', label: 'CONTENT', title: 'الشريحة 1', content: str, sections: [] }];
  } else if (fieldType === 'assignments') {
    return [{ id: Date.now().toString(), title: 'تكليف / واجب', description: str }];
  } else if (fieldType === 'questions') {
    // Parse tag-based questions separated by new lines or block tags like [MCQ], [TRUE_FALSE], etc.
    const blocks = str.split(/\n(?=\[(?:MCQ|MULTIPLE_CHOICE|TRUE_FALSE|MULTI_SELECT|TEXT|ESSAY|MEMORY_GAME|CROSSWORD|COLOR_MATCH|IMAGE_LABEL|FLASH_CARD|WORD_SEARCH|VIDEO_CHECKPOINT)\])/i);
    const parsedQuestions = blocks.map((block, idx) => {
      const qText = block.trim();
      if (!qText) return null;
      try {
        const jsonMatch = qText.match(/^\{[\s\S]*\}$/) || qText.match(/^\[[\s\S]*\]$/);
        if (jsonMatch) {
          const parsedJson = JSON.parse(jsonMatch[0]);
          return Array.isArray(parsedJson) ? parsedJson[0] : parsedJson;
        }
      } catch (e) {}

      // Parse tags like [MCQ] Question text | الخيارات: A, B | الإجابة: A | المستوى: Easy | تصنيف: Remember | التفسير: ...
      const typeMatch = qText.match(/^\[([A-Z_]+)\]\s*(.*?)(?=\s*\||$)/i);
      let type = typeMatch ? typeMatch[1].toUpperCase() : 'MULTIPLE_CHOICE';
      if (type === 'MCQ') type = 'MULTIPLE_CHOICE';
      if (type === 'ESSAY') type = 'TEXT';

      const parts = qText.split('|').map(p => p.trim());
      let text = typeMatch ? typeMatch[2].trim() : parts[0].replace(/^\[[A-Z_]+\]\s*/i, '').trim();
      let options: any = ['A', 'B', 'C', 'D'];
      let correctAnswer: any = 'A';
      let difficulty = 'Medium';
      let bloomLevel = 'Understand';
      let explanation = '';
      let standard = '';
      let indicator = '';
      let learningOutcome = '';
      let skill = '';
      let dok = '';
      let points = 1;
      let videoUrl = '';

      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (p.startsWith('الخيارات:') || p.startsWith('Options:') || p.startsWith('خيارات:')) {
          const optsStr = p.replace(/^(الخيارات:|Options:|خيارات:)\s*/i, '').trim();
          options = optsStr.split(',').map(o => o.trim()).filter(Boolean);
        } else if (p.startsWith('الإجابة:') || p.startsWith('Answer:') || p.startsWith('إجابة:')) {
          const ansStr = p.replace(/^(الإجابة:|Answer:|إجابة:)\s*/i, '').trim();
          if (type === 'MULTI_SELECT' || type === 'WORD_SEARCH') {
            correctAnswer = ansStr.split(',').map(a => a.trim()).filter(Boolean);
          } else if (['MEMORY_GAME', 'CROSSWORD', 'COLOR_MATCH', 'IMAGE_LABEL'].includes(type)) {
            const pairsMap: any = {};
            ansStr.split(',').forEach(pair => {
              const [k, v] = pair.split('=').map(x => x.trim());
              if (k && v) pairsMap[k] = v;
            });
            correctAnswer = pairsMap;
            if (type === 'MEMORY_GAME') {
              options = { pairs: Object.entries(pairsMap).map(([k, v]) => ({ id: Math.random().toString(), left: k, right: v })) };
            }
          } else {
            correctAnswer = ansStr;
          }
        } else if (p.startsWith('المستوى:') || p.startsWith('Difficulty:') || p.startsWith('مستوى:')) {
          difficulty = p.replace(/^(المستوى:|Difficulty:|مستوى:)\s*/i, '').trim();
        } else if (p.startsWith('تصنيف:') || p.startsWith('Bloom:') || p.startsWith('المستوي المعرفي:')) {
          bloomLevel = p.replace(/^(تصنيف:|Bloom:|المستوي المعرفي:)\s*/i, '').trim();
        } else if (p.startsWith('التفسير:') || p.startsWith('Explanation:') || p.startsWith('تفسير:')) {
          explanation = p.replace(/^(التفسير:|Explanation:|تفسير:)\s*/i, '').trim();
        } else if (p.startsWith('المعيار:') || p.startsWith('Standard:')) {
          standard = p.replace(/^(المعيار:|Standard:)\s*/i, '').trim();
        } else if (p.startsWith('المؤشر:') || p.startsWith('Indicator:')) {
          indicator = p.replace(/^(المؤشر:|Indicator:)\s*/i, '').trim();
        } else if (p.startsWith('الناتج:') || p.startsWith('Outcome:')) {
          learningOutcome = p.replace(/^(الناتج:|Outcome:)\s*/i, '').trim();
        } else if (p.startsWith('المهارة:') || p.startsWith('Skill:')) {
          skill = p.replace(/^(المهارة:|Skill:)\s*/i, '').trim();
        } else if (p.startsWith('النقاط:') || p.startsWith('Points:')) {
          points = parseInt(p.replace(/^(النقاط:|Points:)\s*/i, '').trim(), 10) || 1;
        } else if (p.startsWith('العمق:') || p.startsWith('DOK:')) {
          dok = p.replace(/^(العمق:|DOK:)\s*/i, '').trim();
        } else if (p.startsWith('فيديو:') || p.startsWith('Video:')) {
          videoUrl = p.replace(/^(فيديو:|Video:)\s*/i, '').trim();
        } else if (p.startsWith('الوجه:') || p.startsWith('Front:')) {
          text = p.replace(/^(الوجه:|Front:)\s*/i, '').trim();
        } else if (p.startsWith('الظهر:') || p.startsWith('Back:')) {
          correctAnswer = p.replace(/^(الظهر:|Back:)\s*/i, '').trim();
        } else if (p.startsWith('الكلمات:') || p.startsWith('Words:')) {
          const wList = p.replace(/^(الكلمات:|Words:)\s*/i, '').trim().split(',').map(w => w.trim()).filter(Boolean);
          options = wList;
          if (!correctAnswer || correctAnswer === 'A') correctAnswer = wList;
        }
      }

      return {
        id: (Date.now() + idx).toString(),
        type,
        text: text || 'سؤال بدون عنوان',
        options,
        correctAnswer,
        difficulty,
        bloomLevel,
        explanation,
        standard,
        indicator,
        learningOutcome,
        skill,
        dok,
        points,
        videoUrl
      };
    }).filter(Boolean);

    return parsedQuestions.length ? parsedQuestions : [{ id: Date.now().toString(), type: 'MULTIPLE_CHOICE', text: str, options: ['True', 'False'], correctAnswer: 'True', difficulty: 'Medium', bloomLevel: 'Understand' }];
  } else if (fieldType === 'attachments') {
    const lines = str.split('\n').map(l => l.trim()).filter(Boolean);
    const attachments = lines.map((l, i) => {
      const match = l.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
        return { id: Date.now().toString() + i, name: match[1].trim(), url: match[2].trim() };
      }
      return { id: Date.now().toString() + i, name: `ملف ${i+1}`, url: l };
    });
    return attachments;
  }

  return [str];
}

function chunkString(str: string, size: number = 32000): string[] {
  if (!str) return [''];
  const numChunks = Math.ceil(str.length / size);
  if (numChunks === 0) return [''];
  const chunks = new Array(numChunks);
  for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
    chunks[i] = str.substring(o, o + size);
  }
  return chunks;
}

function stripHtml(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') return (html as any) || '';
  return html.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').trim();
}

function formatQuestionsForExcel(qData: any): string {
  let questions = qData;
  if (typeof qData === 'string') {
    try { questions = JSON.parse(qData); } catch { return qData; }
  }
  if (!Array.isArray(questions)) return String(qData || '');
  
  return questions.map((q: any) => {
    let text = `[${q.type || q.label || 'MCQ'}] ${stripHtml(q.text) || ''}`;
    if (q.options && Array.isArray(q.options) && q.options.length > 0) {
      text += ` | Options: ${q.options.join(', ')}`;
    }
    if (q.correctAnswer) {
      if (typeof q.correctAnswer === 'object' && !Array.isArray(q.correctAnswer)) {
        const pairs = Object.entries(q.correctAnswer).map(([k, v]) => `${k}=${v}`).join(', ');
        text += ` | Answer: ${pairs}`;
      } else if (Array.isArray(q.correctAnswer)) {
        text += ` | Answer: ${q.correctAnswer.join(', ')}`;
      } else {
        text += ` | Answer: ${q.correctAnswer}`;
      }
    }
    if (q.difficulty || q.level) text += ` | Difficulty: ${q.difficulty || q.level}`;
    if (q.bloomLevel) text += ` | Bloom: ${q.bloomLevel}`;
    if (q.explanation) text += ` | Explanation: ${q.explanation}`;
    if (q.standard) text += ` | Standard: ${q.standard}`;
    if (q.indicator) text += ` | Indicator: ${q.indicator}`;
    if (q.learningOutcome) text += ` | Outcome: ${q.learningOutcome}`;
    if (q.skill) text += ` | Skill: ${q.skill}`;
    if (q.points) text += ` | Points: ${q.points}`;
    if (q.dok) text += ` | DOK: ${q.dok}`;
    if (q.videoUrl) text += ` | Video: ${q.videoUrl}`;
    return text;
  }).join('\n\n');
}

function formatSlidesForExcel(sData: any): string {
  let slides = sData;
  if (typeof sData === 'string') {
    try { slides = JSON.parse(sData); } catch { return sData; }
  }
  if (!Array.isArray(slides)) return String(sData || '');
  
  return slides.map((s: any) => {
    if (typeof s === 'string') return `[SLIDE]\n${stripHtml(s)}`;
    return `[SLIDE]\n${stripHtml(s.content) || ''}`;
  }).join('\n\n');
}

function formatAssignmentsForExcel(aData: any): string {
  let assignments = aData;
  if (typeof aData === 'string') {
    try { assignments = JSON.parse(aData); } catch { return aData; }
  }
  if (!Array.isArray(assignments)) return String(aData || '');
  
  return assignments.map(a => {
    if (a.type || a.label || a.options) {
      return formatQuestionsForExcel([a]);
    }
    if (typeof a === 'string') return stripHtml(a);
    return stripHtml(a.description || a.text || a.content || '');
  }).join('\n\n');
}

function formatAttachmentsForExcel(aData: any): string {
  let attachments = aData;
  if (typeof aData === 'string') {
    try { attachments = JSON.parse(aData); } catch { return aData; }
  }
  if (!Array.isArray(attachments)) return String(aData || '');
  
  return attachments.map((a: any) => {
    if (typeof a === 'string') return a;
    if (a.name && a.name !== 'Attachment' && !a.name.startsWith('ملف')) {
      return `[${a.name}] ${a.url}`;
    }
    return a.url || '';
  }).filter(Boolean).join('\n');
}

// 1. Download Template
router.get('/api/school/import/template', verifyToken, checkRole(['SCHOOL_ADMIN', 'SUPER_ADMIN']), (req: any, res: any) => {
  try {
    const workbook = xlsx.utils.book_new();

    // Define Headers
    const headers = [
      'Course Title',
      'Course Grade',
      'Course Subject',
      'Course Description',
      'Lesson Title',
      'Lesson Domain',
      'Lesson Summary',
      'Lesson Notes',
      'Lesson Content',
      'Lesson Video URL',
      'Lesson Order',
      'Publish Date (YYYY-MM-DD)',
      'Cut Off Date (YYYY-MM-DD)',
      'Lesson Slides',
      'Lesson Assignments',
      'Lesson Questions',
      'Lesson Attachments',
      'Lesson Standards',
      'Lesson Indicators',
      'Lesson Learning Outcomes',
      'Lesson Duration (Sec)',
      'Lesson Visibility'
    ];

    // Example Row
    const exampleData = [
      headers,
      [
        'Advanced Mathematics',
        '10th Grade',
        'Math',
        'Comprehensive course covering Algebra and Geometry',
        'Lesson 1: Introduction to Algebra',
        'Algebra',
        'Quick summary of algebraic rules and their applications.',
        'Note for teacher: Focus on interactive examples.',
        'Detailed step-by-step explanation of algebraic equations...',
        'https://youtube.com/watch?v=example',
        '1',
        '2026-08-01',
        '2026-12-31',
        '[SLIDE]\nWelcome to the Algebra lesson\n\n[SLIDE]\nSecond Slide: Basic Concepts',
        'Solve exercises on page 15\n\nExtract and write down the basic rules',
        '[MCQ] What is the value of x if x + 2 = 5? | Options: 2, 3, 4, 5 | Answer: 3 | Difficulty: Easy | Bloom: Apply | Explanation: Subtracting 2 from both sides gives x = 3.\n[TRUE_FALSE] The sun revolves around the earth | Answer: False | Difficulty: Easy | Bloom: Remember | Explanation: The earth revolves around the sun.\n[MULTI_SELECT] Which of the following are even numbers? | Options: 2, 3, 4, 5, 6 | Answer: 2, 4, 6 | Difficulty: Medium | Bloom: Apply | Explanation: Even numbers are divisible by 2.\n[COLOR_MATCH] Match the color with the word | Answer: Red=Red, Green=Green, Blue=Blue | Difficulty: Easy | Explanation: Color matching for translation.',
        'https://example.com/worksheet.pdf',
        'National Algebra Standards',
        'First-degree equations indicator',
        'Student can successfully solve mathematical equations',
        '1800',
        'TRUE'
      ],
      [
        'Advanced Mathematics',
        '10th Grade',
        'Math',
        'Comprehensive course covering Algebra and Geometry',
        'Lesson 2: Advanced Applications',
        'Algebra',
        'Practical applications on algebra.',
        'Interact with students.',
        'Explaining real-life examples...',
        'https://youtube.com/watch?v=example2',
        '2',
        '2026-08-05',
        '2026-12-31',
        '[SLIDE]\nReal-life applications of Algebra',
        'Write a report on the importance of Algebra',
        '[ESSAY] Explain the causes and effects of the Industrial Revolution | Difficulty: Hard | Bloom: Analyze | Explanation: The answer depends on the student\'s comprehensive analysis.\n[MEMORY_GAME] Match country to capital | Answer: Egypt=Cairo, France=Paris, Japan=Tokyo | Difficulty: Medium | Bloom: Understand | Explanation: Remembering global capitals.\n[CROSSWORD] Answer with correct word | Answer: Opposite of tall=short, Capital of KSA=Riyadh | Difficulty: Medium | Explanation: Crossword questions.\n[FLASH_CARD] Front: H2O | Back: Water | Difficulty: Easy | Bloom: Remember | Explanation: Chemical name for water.\n[WORD_SEARCH] Search for planets | Words: Mars, Jupiter, Saturn, Earth | Difficulty: Easy | Explanation: Basic planets.',
        'https://example.com/advanced_worksheet.pdf',
        'Application Standards',
        'Real-world connection indicator',
        'Student links concepts to reality',
        '2000',
        'TRUE'
      ]
    ];

    const worksheet = xlsx.utils.aoa_to_sheet(exampleData);
    worksheet['!cols'] = headers.map(() => ({ wch: 26 }));
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Courses and Lessons');

    // Create Sheet 2: Instructions and Examples
    const instructionsData = [
      ['Comprehensive User Guide for Course and Lesson Import'],
      [''],
      ['--- 🟢 General Rules 🟢 ---'],
      ['1. Headers:', 'Do NOT change or delete the first row containing column headers.'],
      ['2. Create New Lesson:', 'Each row represents a lesson. For a course with multiple lessons, repeat the course title in each row and write a different lesson title.'],
      ['3. Multiple lines in one cell:', 'Use (Alt + Enter) to create a new line within the same cell (e.g., for multiple questions or slides).'],
      [''],
      ['--- 🔵 Core Columns Explanation 🔵 ---'],
      ['Course Title', 'Name of the course (Required), e.g.: Advanced Mathematics.'],
      ['Course Grade / Subject', 'Grade level and subject, e.g.: 10th Grade / Math.'],
      ['Course Description', 'Description of the course.'],
      ['Lesson Title', 'Name of the lesson (Required), e.g.: Lesson 1: Algebra.'],
      ['Lesson Domain / Summary / Notes', 'Categories and extra notes for the teacher.'],
      ['Lesson Content', 'The textual explanation for the lesson.'],
      ['Lesson Video URL', 'YouTube or video link for the lesson.'],
      ['Publish Date / Cut Off Date', 'Publish and hide dates. Format must be YYYY-MM-DD (e.g., 2026-08-01).'],
      ['Lesson Duration (Sec) / Visibility', 'Duration in seconds (Number) and visibility status (TRUE or FALSE).'],
      [''],
      ['--- 🟡 Lesson Slides 🟡 ---'],
      ['How to format:', 'Use [SLIDE] to define the start of a new slide. Separate slides with a blank line (Alt+Enter twice).'],
      ['Example:', '[SLIDE]\nWelcome to Lesson 1.\n\n[SLIDE]\nSecond Slide: Basic Rules.'],
      [''],
      ['--- 🟣 Assignments & Attachments 🟣 ---'],
      ['Assignments', 'Write assignment text normally. Separate multiple assignments with a new line (Alt+Enter). Example:\nSolve page 10.\nWrite an essay.'],
      ['Attachments', 'Write file name in brackets [] followed by the link. Use (Alt+Enter) for multiple. Example:\n[Exercises] https://link.com/file.pdf\n[Book] https://link.com/book.pdf'],
      [''],
      ['--- 🔴 Lesson Questions Detailed Guide 🔴 ---'],
      ['Core Rule:', 'Each question must start with the type [TYPE] followed by the question text, then properties separated by | (Pipe symbol). Separate questions with (Alt+Enter).'],
      ['Available Properties:', 'Options: (Comma separated), Answer: (Correct answer), Difficulty: (Easy/Medium/Hard), Skill: (e.g. Math), Points: (Number), Explanation: (Answer rationale).'],
      [''],
      ['1. Multiple Choice (MCQ)'],
      ['Example:', '[MCQ] What is the capital of Egypt? | Options: Cairo, Alexandria, Aswan | Answer: Cairo | Difficulty: Easy | Skill: Geography | Points: 1 | Explanation: It is the current capital.'],
      [''],
      ['2. True or False (TRUE_FALSE)'],
      ['Example:', '[TRUE_FALSE] The sun revolves around the earth | Answer: False | Difficulty: Easy | Explanation: The earth revolves around the sun.'],
      [''],
      ['3. Multiple Select (MULTI_SELECT)'],
      ['Example:', '[MULTI_SELECT] Which are even numbers? | Options: 1, 2, 3, 4 | Answer: 2, 4 | Difficulty: Medium'],
      [''],
      ['4. Essay Question (ESSAY)'],
      ['Example:', '[ESSAY] Explain the greenhouse effect | Difficulty: Hard | Points: 5'],
      [''],
      ['5. Memory / Match Game (MEMORY_GAME / COLOR_MATCH)'],
      ['Example:', '[MEMORY_GAME] Match words to opposites | Answer: tall=short, big=small, white=black'],
      [''],
      ['6. Crossword (CROSSWORD)'],
      ['Example:', '[CROSSWORD] Answer correctly | Answer: opposite of tall=short, capital of Egypt=Cairo'],
      [''],
      ['7. Flash Cards (FLASH_CARD)'],
      ['Example:', '[FLASH_CARD] Front: What is water? | Back: H2O'],
      [''],
      ['8. Word Search (WORD_SEARCH)'],
      ['Example:', '[WORD_SEARCH] Find fruits | Words: Apple, Orange, Banana'],
      [''],
      ['--- 🟢 Standards & Outcomes 🟢 ---'],
      ['How to format:', 'Write as normal text. Example: National Education Standards 2026. For multiple, use (Alt+Enter).']
    ];

    const instructionsSheet = xlsx.utils.aoa_to_sheet(instructionsData);
    instructionsSheet['!cols'] = [{ wch: 35 }, { wch: 110 }];
    xlsx.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions & Examples');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="course_import_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating template:', error);
    res.status(500).json({ error: 'Failed to generate template', details: error.message });
  }
});

// 2. Upload and Parse Excel
router.post('/api/school/import/excel', verifyToken, checkRole(['SCHOOL_ADMIN', 'SUPER_ADMIN']), multerUpload.single('file'), async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const schoolId = req.user.role === 'SUPER_ADMIN' ? undefined : req.user.schoolId;

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    const rows: any[] = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'The uploaded file is empty' });
    }

    let createdCourses = 0;
    let createdLessons = 0;

    // Group rows by Course Title
    const coursesMap = new Map<string, any[]>();
    for (const row of rows) {
      const courseTitle = String(row['Course Title'] || '').trim();
      if (!courseTitle) continue;

      if (!coursesMap.has(courseTitle)) {
        coursesMap.set(courseTitle, []);
      }
      coursesMap.get(courseTitle)?.push(row);
    }

    const syncedCourseIds = new Set<string>();
    await prisma.$transaction(async (tx) => {
      for (const [courseTitle, courseRows] of coursesMap.entries()) {
        const whereClause: any = { title: courseTitle };
        if (schoolId) {
          whereClause.schoolId = schoolId;
        }

        let course = await tx.course.findFirst({ where: whereClause });

        if (!course) {
          const firstRow = courseRows[0];
          course = await tx.course.create({
            data: {
              title: courseTitle,
              grade: firstRow['Course Grade'] || null,
              subject: firstRow['Course Subject'] || null,
              description: firstRow['Course Description'] || null,
              schoolId: schoolId || null
            }
          });
          createdCourses++;
        }
        if (course?.id) syncedCourseIds.add(course.id);

        // Group rows sequentially by Lesson Title
        const allLessonGroups: any[][] = [];
        let currentLessonRows: any[] = [];

        for (const row of courseRows) {
          const lessonTitle = String(row['Lesson Title'] || '').trim();
          if (!lessonTitle) continue;

          // Detect if it's a new lesson or continuation
          const isNewLesson = currentLessonRows.length === 0 || 
                              lessonTitle !== String(currentLessonRows[0]['Lesson Title'] || '').trim() ||
                              row['Lesson Order'] !== '';

          if (isNewLesson && currentLessonRows.length > 0) {
            allLessonGroups.push(currentLessonRows);
            currentLessonRows = [];
          }
          currentLessonRows.push(row);
        }
        if (currentLessonRows.length > 0) {
          allLessonGroups.push(currentLessonRows);
        }

        // Add lessons
        for (const lessonRows of allLessonGroups) {
          const firstRow = lessonRows[0];
          const lessonTitle = String(firstRow['Lesson Title'] || '').trim();
          if (!lessonTitle) continue;

          let fullSlides = '';
          let fullAssignments = '';
          let fullQuestions = '';
          let fullAttachments = '';

          for (const row of lessonRows) {
            fullSlides += String(row['Lesson Slides'] || '');
            fullAssignments += String(row['Lesson Assignments'] || '');
            fullQuestions += String(row['Lesson Questions'] || '');
            fullAttachments += String(row['Lesson Attachments'] || '');
          }

          const publishDateStr = firstRow['Publish Date (YYYY-MM-DD)'];
          const cutOffDateStr = firstRow['Cut Off Date (YYYY-MM-DD)'];
          const orderVal = parseInt(firstRow['Lesson Order'], 10);
          const durationVal = parseInt(firstRow['Lesson Duration (Sec)'], 10);
          const isVisibleStr = String(firstRow['Lesson Visibility'] || 'TRUE').trim().toUpperCase();

          await tx.lesson.create({
            data: {
              title: lessonTitle,
              courseId: course.id,
              domain: firstRow['Lesson Domain'] || null,
              summary: firstRow['Lesson Summary'] || null,
              notes: firstRow['Lesson Notes'] || null,
              content: firstRow['Lesson Content'] || null,
              videoUrl: firstRow['Lesson Video URL'] || null,
              order: isNaN(orderVal) ? 0 : orderVal,
              duration: isNaN(durationVal) ? 0 : durationVal,
              isVisible: isVisibleStr !== 'FALSE' && isVisibleStr !== 'خطأ',
              publishDate: publishDateStr ? new Date(publishDateStr) : null,
              cutOffDate: cutOffDateStr ? new Date(cutOffDateStr) : null,
              slides: parseComplexCell(fullSlides, 'slides'),
              assignments: parseComplexCell(fullAssignments, 'assignments'),
              questions: parseComplexCell(fullQuestions, 'questions'),
              attachments: parseComplexCell(fullAttachments, 'attachments'),
              standards: firstRow['Lesson Standards'] || null,
              indicators: firstRow['Lesson Indicators'] || null,
              learningOutcomes: firstRow['Lesson Learning Outcomes'] || null
            }
          });
          createdLessons++;
        }
      }
    });

    // Real-time Dual-Write: Instantly sync all imported courses to Cloud Backup cloud database
    for (const cId of syncedCourseIds) {
      syncCourseToCloud(cId).catch(() => {});
    }

    // 🔒 SAFETY: Automatic deduplication removed — it soft-deleted real lessons that shared
    //    a title (e.g. two legitimate "Work Energy Power" lessons in the same course).
    //    Deduplication is now MANUAL ONLY via the SUPER_ADMIN endpoint:
    //    POST /api/admin/system/deduplicate-lessons
    //    or via the /api/deduplicate/scan + /api/deduplicate/clean admin UI flow.

    res.json({
      success: true,
      message: `تمت عملية الاستيراد بنجاح! تم إنشاء ${createdCourses} كورس جديد و ${createdLessons} درس.`,
      stats: { courses: createdCourses, lessons: createdLessons }
    });

  } catch (error: any) {
    console.error('Error importing excel:', error);
    res.status(500).json({ error: 'Failed to import data', details: error.message });
  }
});

// 3. Export Course to Excel
router.get('/api/school/export/course/:id', verifyToken, checkRole(['SCHOOL_ADMIN', 'SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const courseId = req.params.id;
    const schoolId = req.user.role === 'SUPER_ADMIN' ? undefined : req.user.schoolId;

    const whereClause: any = { id: courseId };
    if (schoolId) {
      whereClause.schoolId = schoolId;
    }

    const course = await prisma.course.findFirst({
      where: whereClause,
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          include: { blocks: { orderBy: { order: 'asc' } } }
        }
      }
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const headers = [
      'Course Title', 'Course Grade', 'Course Subject', 'Course Description',
      'Lesson Title', 'Lesson Domain', 'Lesson Summary', 'Lesson Notes', 'Lesson Content',
      'Lesson Video URL', 'Lesson Order', 'Publish Date (YYYY-MM-DD)', 'Cut Off Date (YYYY-MM-DD)',
      'Lesson Slides', 'Lesson Assignments', 'Lesson Questions', 'Lesson Attachments',
      'Lesson Standards', 'Lesson Indicators', 'Lesson Learning Outcomes', 'Lesson Duration (Sec)', 'Lesson Visibility'
    ];

    const dataRows = [headers];

    if (course.lessons.length === 0) {
      dataRows.push([
        course.title, course.grade || '', course.subject || '', course.description || '',
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
      ]);
    } else {
      for (const lesson of course.lessons) {
        const blocks = (lesson as any).blocks || [];
        
        let lessonSlidesRaw = lesson.slides;
        if (!lessonSlidesRaw || lessonSlidesRaw === '[]' || lessonSlidesRaw === 'null') {
          const slideBlocks = blocks.filter((b: any) => b.type === 'TEXT');
          if (slideBlocks.length > 0) {
            lessonSlidesRaw = slideBlocks.map((b: any) => ({
              title: b.title || b.label || 'شريحة',
              type: b.type,
              content: b.content
            }));
          }
        }

        let lessonQuestionsRaw = lesson.questions;
        if (!lessonQuestionsRaw || lessonQuestionsRaw === '[]' || lessonQuestionsRaw === 'null') {
          const questionBlocks = blocks.filter((b: any) => b.type === 'QUESTION');
          if (questionBlocks.length > 0) {
            lessonQuestionsRaw = questionBlocks.map((b: any) => {
              let opts = [];
              try { opts = JSON.parse(b.options || '[]'); } catch(e) {}
              return {
                type: b.label || 'MCQ',
                text: b.content || 'سؤال',
                options: opts,
                correctAnswer: b.correctAnswer
              };
            });
          }
        }

        const slidesJSON = formatSlidesForExcel(lessonSlidesRaw);
        const assignmentsJSON = formatAssignmentsForExcel(lesson.assignments);
        const questionsJSON = formatQuestionsForExcel(lessonQuestionsRaw);
        const attachmentsJSON = formatAttachmentsForExcel(lesson.attachments);

        const slidesChunks = chunkString(slidesJSON, 32000);
        const assignChunks = chunkString(assignmentsJSON, 32000);
        const questChunks = chunkString(questionsJSON, 32000);
        const attachChunks = chunkString(attachmentsJSON, 32000);

        const maxRows = Math.max(slidesChunks.length, assignChunks.length, questChunks.length, attachChunks.length, 1);

        for (let i = 0; i < maxRows; i++) {
          dataRows.push([
            course.title,
            course.grade || '',
            course.subject || '',
            course.description || '',
            i === 0 ? (lesson.title || '') : '',
            i === 0 ? (lesson.domain || '') : '',
            i === 0 ? (stripHtml(lesson.summary) || '') : '',
            i === 0 ? (stripHtml(lesson.notes) || '') : '',
            i === 0 ? (stripHtml(lesson.content) || '') : '',
            i === 0 ? (lesson.videoUrl || '') : '',
            i === 0 ? (lesson.order?.toString() || '0') : '',
            i === 0 ? (lesson.publishDate ? lesson.publishDate.toISOString().split('T')[0] : '') : '',
            i === 0 ? (lesson.cutOffDate ? lesson.cutOffDate.toISOString().split('T')[0] : '') : '',
            slidesChunks[i] || '',
            assignChunks[i] || '',
            questChunks[i] || '',
            attachChunks[i] || '',
            i === 0 ? (lesson.standards || '') : '',
            i === 0 ? (lesson.indicators || '') : '',
            i === 0 ? (lesson.learningOutcomes || '') : '',
            i === 0 ? (lesson.duration?.toString() || '0') : '',
            i === 0 ? (lesson.isVisible !== false ? 'TRUE' : 'FALSE') : ''
          ]);
        }
      }
    }

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet(dataRows);
    worksheet['!cols'] = headers.map(() => ({ wch: 25 }));
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Export');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="course_${courseId}_export.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error: any) {
    console.error('Error exporting course:', error);
    res.status(500).json({ error: 'Failed to export course', details: error.message });
  }
});

// 4. Export Single Lesson to Excel
router.get('/api/school/export/lesson/:id', verifyToken, checkRole(['SCHOOL_ADMIN', 'SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const lessonId = req.params.id;
    const schoolId = req.user.role === 'SUPER_ADMIN' ? undefined : req.user.schoolId;

    const lesson = await prisma.lesson.findFirst({
      where: { id: lessonId },
      include: { course: true, blocks: { orderBy: { order: 'asc' } } }
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    if (schoolId && lesson.course?.schoolId !== schoolId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const headers = [
      'Course Title', 'Course Grade', 'Course Subject', 'Course Description',
      'Lesson Title', 'Lesson Domain', 'Lesson Summary', 'Lesson Notes', 'Lesson Content',
      'Lesson Video URL', 'Lesson Order', 'Publish Date (YYYY-MM-DD)', 'Cut Off Date (YYYY-MM-DD)',
      'Lesson Slides', 'Lesson Assignments', 'Lesson Questions', 'Lesson Attachments',
      'Lesson Standards', 'Lesson Indicators', 'Lesson Learning Outcomes', 'Lesson Duration (Sec)', 'Lesson Visibility'
    ];

    const dataRows = [headers];

    const blocks = (lesson as any).blocks || [];
    let lessonSlidesRaw = lesson.slides;
    if (!lessonSlidesRaw || lessonSlidesRaw === '[]' || lessonSlidesRaw === 'null') {
      const slideBlocks = blocks.filter((b: any) => b.type === 'TEXT');
      if (slideBlocks.length > 0) {
        lessonSlidesRaw = slideBlocks.map((b: any) => ({
          title: b.title || b.label || 'شريحة',
          type: b.type,
          content: b.content
        }));
      }
    }
    
    let lessonQuestionsRaw = lesson.questions;
    if (!lessonQuestionsRaw || lessonQuestionsRaw === '[]' || lessonQuestionsRaw === 'null') {
      const questionBlocks = blocks.filter((b: any) => b.type === 'QUESTION');
      if (questionBlocks.length > 0) {
        lessonQuestionsRaw = questionBlocks.map((b: any) => {
          let opts = [];
          try { opts = JSON.parse(b.options || '[]'); } catch(e) {}
          return {
            type: b.label || 'MCQ',
            text: b.content || 'سؤال',
            options: opts,
            correctAnswer: b.correctAnswer
          };
        });
      }
    }

    const slidesJSON = formatSlidesForExcel(lessonSlidesRaw);
    const assignmentsJSON = formatAssignmentsForExcel(lesson.assignments);
    const questionsJSON = formatQuestionsForExcel(lessonQuestionsRaw);
    const attachmentsJSON = formatAttachmentsForExcel(lesson.attachments);

    const slidesChunks = chunkString(slidesJSON, 32000);
    const assignChunks = chunkString(assignmentsJSON, 32000);
    const questChunks = chunkString(questionsJSON, 32000);
    const attachChunks = chunkString(attachmentsJSON, 32000);

    const maxRows = Math.max(slidesChunks.length, assignChunks.length, questChunks.length, attachChunks.length, 1);

    for (let i = 0; i < maxRows; i++) {
      dataRows.push([
        lesson.course?.title || '',
        lesson.course?.grade || '',
        lesson.course?.subject || '',
        lesson.course?.description || '',
        lesson.title || '',
        i === 0 ? (lesson.domain || '') : '',
        i === 0 ? (stripHtml(lesson.summary) || '') : '',
        i === 0 ? (stripHtml(lesson.notes) || '') : '',
        i === 0 ? (stripHtml(lesson.content) || '') : '',
        i === 0 ? (lesson.videoUrl || '') : '',
        i === 0 ? (lesson.order?.toString() || '0') : '',
        i === 0 ? (lesson.publishDate ? lesson.publishDate.toISOString().split('T')[0] : '') : '',
        i === 0 ? (lesson.cutOffDate ? lesson.cutOffDate.toISOString().split('T')[0] : '') : '',
        slidesChunks[i] || '',
        assignChunks[i] || '',
        questChunks[i] || '',
        attachChunks[i] || '',
        i === 0 ? (lesson.standards || '') : '',
        i === 0 ? (lesson.indicators || '') : '',
        i === 0 ? (lesson.learningOutcomes || '') : '',
        i === 0 ? (lesson.duration?.toString() || '0') : '',
        i === 0 ? (lesson.isVisible !== false ? 'TRUE' : 'FALSE') : ''
      ]);
    }

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet(dataRows);
    worksheet['!cols'] = headers.map(() => ({ wch: 25 }));
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Export');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="lesson_${lessonId}_export.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error: any) {
    console.error('Error exporting lesson:', error);
    res.status(500).json({ error: 'Failed to export lesson', details: error.message });
  }
});

// 5. Export Full Course as JSON Backup (v2 — includes lessons, blocks, exams, questions)
router.get('/api/school/export/json/course/:id', verifyToken, checkRole(['SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const courseId = req.params.id;
    const schoolId = req.user.role === 'SUPER_ADMIN' ? undefined : req.user.schoolId;

    // Fix 404 for central courses: don't restrict by schoolId, allow central courses (schoolId=null) too
    const whereClause: any = { id: courseId };
    if (schoolId) {
      whereClause.OR = [
        { schoolId: schoolId },
        { isCentral: true },
        { schools: { some: { id: schoolId } } }
      ];
    }

    const course = await prisma.course.findFirst({
      where: whereClause,
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          include: {
            blocks: {
              orderBy: { order: 'asc' },
              include: { sections: { orderBy: { order: 'asc' } } }
            }
          }
        },
        exams: {
          include: { questions: { orderBy: { order: 'asc' } } }
        },
        schools: { select: { id: true, name: true } },
        school: { select: { id: true, name: true } }
      }
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found or access denied' });
    }

    const safeParse = (val: any, fallback: any = []) => {
      if (!val) return fallback;
      if (typeof val !== 'string') return val;
      try { return JSON.parse(val); } catch { return fallback; }
    };

    const exportData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      course: {
        title: course.title,
        description: course.description,
        coverImage: course.coverImage,
        grade: course.grade,
        grades: safeParse(course.grades, course.grade ? [course.grade] : []),
        subject: course.subject,
        country: course.country,
        isCentral: course.isCentral,
        schoolName: course.school?.name || null,
        assignedSchools: (course.schools as any[])?.map((s: any) => s.name) || []
      },
      lessons: course.lessons.map(l => ({
        title: l.title,
        domain: l.domain,
        videoUrl: l.videoUrl,
        duration: l.duration,
        summary: l.summary,
        notes: l.notes,
        content: l.content,
        slides: safeParse(l.slides),
        questions: safeParse(l.questions),
        assignments: safeParse(l.assignments),
        attachments: safeParse(l.attachments),
        standards: l.standards,
        indicators: l.indicators,
        learningOutcomes: l.learningOutcomes,
        order: l.order,
        isVisible: l.isVisible,
        isCentral: l.isCentral,
        publishDate: l.publishDate ? l.publishDate.toISOString() : null,
        cutOffDate: l.cutOffDate ? l.cutOffDate.toISOString() : null,
        blocks: ((l as any).blocks || []).map((b: any) => ({
          type: b.type,
          label: b.label,
          title: b.title,
          content: b.content,
          options: safeParse(b.options, b.options),
          correctAnswer: b.correctAnswer,
          points: b.points,
          order: b.order,
          isRequired: b.isRequired,
          isVisible: b.isVisible,
          sections: (b.sections || []).map((s: any) => ({
            type: s.type,
            content: s.content,
            order: s.order
          }))
        }))
      })),
      exams: (course.exams || []).map((e: any) => ({
        title: e.title,
        description: e.description,
        type: e.type,
        duration: e.duration,
        passingScore: e.passingScore,
        isCentral: e.isCentral,
        showAnswers: e.showAnswers,
        resultVisibility: e.resultVisibility,
        attemptsAllowed: e.attemptsAllowed,
        status: e.status,
        category: e.category,
        grade: e.grade,
        grades: e.grades,
        subjects: e.subjects,
        skill: e.skill,
        level: e.level,
        startDate: e.startDate ? e.startDate.toISOString() : null,
        endDate: e.endDate ? e.endDate.toISOString() : null,
        questions: (e.questions || []).map((q: any) => ({
          text: q.text,
          type: q.type,
          options: safeParse(q.options, q.options),
          correctAnswer: q.correctAnswer,
          points: q.points,
          xpPoints: q.xpPoints,
          skill: q.skill,
          standard: q.standard,
          learningOutcome: q.learningOutcome,
          indicator: q.indicator,
          videoUrl: q.videoUrl,
          level: q.level,
          dok: q.dok,
          explanation: q.explanation,
          imageUrl: q.imageUrl,
          order: q.order
        }))
      }))
    };

    const buffer = Buffer.from(JSON.stringify(exportData, null, 2), 'utf8');
    res.setHeader('Content-Disposition', `attachment; filename="course_${course.id}_full_backup.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error: any) {
    console.error('Error exporting JSON course backup:', error);
    res.status(500).json({ error: 'Failed to export JSON backup', details: error.message });
  }
});

// 6. Import Full Course from JSON Backup (v1 & v2 compatible)
// Restores: course info + all lessons (slides/questions/assignments/attachments/blocks/sections) + all exams (with questions)
router.post('/api/school/import/json/course', verifyToken, checkRole(['SCHOOL_ADMIN', 'SUPER_ADMIN', 'TEACHER']), multerUpload.single('file'), async (req: any, res: any) => {
  try {
    let jsonData: any = null;

    if (req.file) {
      const fs = require('fs');
      const raw = fs.readFileSync(req.file.path, 'utf8');
      jsonData = JSON.parse(raw);
      try { fs.unlinkSync(req.file.path); } catch {}
    } else if (req.body && req.body.course) {
      jsonData = req.body;
    } else {
      return res.status(400).json({ error: 'No JSON file uploaded or provided' });
    }

    if (!jsonData || !jsonData.course || !jsonData.course.title) {
      return res.status(400).json({ error: 'Invalid course JSON structure' });
    }

    const schoolId = req.user.role === 'SUPER_ADMIN' ? undefined : req.user.schoolId;
    const courseData = jsonData.course;
    const lessonsList = Array.isArray(jsonData.lessons) ? jsonData.lessons : [];

    const createdCourse = await prisma.$transaction(async (tx) => {
      // 1. Check if course already exists by Title and School/Centrality
      let existingCourse = await tx.course.findFirst({
        where: {
          title: courseData.title,
          isCentral: req.user.role === 'SUPER_ADMIN' ? !!courseData.isCentral : false,
          schoolId: schoolId || null,
          deletedAt: null
        }
      });

      let courseId = '';

      if (existingCourse) {
        // UPDATE EXISTING COURSE
        await tx.course.update({
          where: { id: existingCourse.id },
          data: {
            description: courseData.description || null,
            coverImage: courseData.coverImage || null,
            grade: courseData.grade || null,
            grades: courseData.grades ? JSON.stringify(courseData.grades) : null,
            subject: courseData.subject || null,
            country: courseData.country || 'مصر'
          }
        });
        courseId = existingCourse.id;
      } else {
        // CREATE NEW COURSE
        const newCourse = await tx.course.create({
          data: {
            title: courseData.title,
            description: courseData.description || null,
            coverImage: courseData.coverImage || null,
            grade: courseData.grade || null,
            grades: courseData.grades ? JSON.stringify(courseData.grades) : null,
            subject: courseData.subject || null,
            country: courseData.country || 'مصر',
            isCentral: req.user.role === 'SUPER_ADMIN' ? !!courseData.isCentral : false,
            schoolId: schoolId || null
          }
        });
        courseId = newCourse.id;
      }

        // 2. Upsert Lessons
        for (let idx = 0; idx < lessonsList.length; idx++) {
          const l = lessonsList[idx];
          if (!l.title) continue;
  
          // Check if lesson exists in this course
          const existingLesson = await tx.lesson.findFirst({
            where: {
              title: l.title,
              courseId: courseId,
              deletedAt: null
            }
          });

          const lessonData = {
              domain: l.domain || null,
              videoUrl: l.videoUrl || null,
              duration: l.duration || 0,
              summary: l.summary || null,
              notes: l.notes || null,
              content: l.content || null,
              slides: l.slides ? l.slides : null,
              questions: l.questions ? l.questions : null,
              assignments: l.assignments ? l.assignments : null,
              attachments: l.attachments ? l.attachments : null,
              standards: l.standards || null,
              indicators: l.indicators || null,
              learningOutcomes: l.learningOutcomes || null,
              order: l.order !== undefined ? l.order : idx,
              isVisible: l.isVisible !== undefined ? !!l.isVisible : true,
              publishDate: l.publishDate ? new Date(l.publishDate) : null,
              cutOffDate: l.cutOffDate ? new Date(l.cutOffDate) : null
          };

          if (existingLesson) {
            await tx.lesson.update({
              where: { id: existingLesson.id },
              data: lessonData
            });
          } else {
            await tx.lesson.create({
              data: {
                ...lessonData,
                title: l.title,
                courseId: courseId
              }
            });
          }
        }
        return await tx.course.findUnique({ where: { id: courseId } });
      });

    // Real-time Dual-Write: Instantly sync JSON imported course to Cloud Backup cloud database
    if (createdCourse?.id) syncCourseToCloud(createdCourse.id).catch(() => {});

    // 🔒 SAFETY: Automatic deduplication removed — see comment in Excel import above.
    //    Deduplication is MANUAL ONLY via POST /api/admin/system/deduplicate-lessons

    res.json({
      success: true,
      message: `تم استيراد واستعادة الكورس "${courseData.title}" و ${lessonsList.length} درس بنجاح!`
    });
  } catch (error: any) {
    console.error('Error importing JSON course:', error);
    res.status(500).json({ error: 'Failed to import JSON course backup', details: error.message });
  }
});

export default router;
