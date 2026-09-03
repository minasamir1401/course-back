import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import { 
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields, 
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses
} from '../shared';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const router = Router();

// --- Extracted from lines 4383-5216 ---
router.get('/api/skills-hub/clusters', verifyToken, async (req: any, res: any) => {
  try {
    const { grade, subject } = req.query;
    const user = req.user;

    const where: any = {};
    if (subject) where.subject = subject as string;

    if (grade) {
      const studentGrades = getStudentGradeAndStage(grade as string);
      const gradeOrConditions: any[] = [];
      for (const g of studentGrades) {
        gradeOrConditions.push({ grade: { contains: g } });
      }
      where.AND = [
        ...(where.AND || []),
        { OR: gradeOrConditions }
      ];
    }

    if (user.role === 'SUPER_ADMIN') {
      const { schoolId } = req.query;
      if (schoolId) {
        where.OR = [
          { schoolId: schoolId as string },
          { schoolId: { contains: schoolId as string } }
        ];
      }
    } else if (user.role === 'TEACHER') {
      where.OR = [
        { creatorId: user.id }
      ];
    } else if (user.role === 'SCHOOL_ADMIN' || user.schoolId) {
      where.OR = [
        { isCentral: true },
        { schoolId: user.schoolId },
        { schoolId: { contains: user.schoolId } }
      ];
    } else {
      where.isCentral = true;
    }

    const clusters = await prisma.skillCluster.findMany({
      where,
      include: {
        _count: {
          select: { skills: true }
        },
        school: {
          select: { id: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(clusters);
  } catch (error: any) {
    console.error('Error fetching skill clusters:', error);
    res.status(500).json({ error: 'Error fetching skill clusters', details: error.message });
  }
});

// Create a Skill Cluster
router.post('/api/skills-hub/clusters', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const { name, description, subject, isCentral } = req.body;
    const rawGrade = req.body.grades || req.body.grade;
    const grade = Array.isArray(rawGrade) ? JSON.stringify(rawGrade) : String(rawGrade || '');

    const rawSchool = req.body.schoolIds !== undefined ? req.body.schoolIds : req.body.schoolId;
    let schoolId: string | null = null;
    if (req.user.role === 'SUPER_ADMIN') {
      if (!isCentral) {
        if (Array.isArray(rawSchool)) {
          schoolId = rawSchool[0] || null;
        } else if (typeof rawSchool === 'string' && rawSchool.startsWith('[')) {
          try {
            const parsed = JSON.parse(rawSchool);
            schoolId = Array.isArray(parsed) ? (parsed[0] || null) : rawSchool;
          } catch {
            schoolId = rawSchool || null;
          }
        } else {
          schoolId = rawSchool || null;
        }
      }
    } else {
      schoolId = req.user.schoolId || null;
    }

    if (!name || !subject || !grade) {
      return res.status(400).json({ error: 'Missing required fields: name, subject, grade' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && isCentral) {
      return res.status(403).json({ error: 'Only Super Admin can create central skill clusters.' });
    }

    const isGrade123 = (g?: any) => {
      if (!g) return false;
      const str = typeof g === 'string' ? g : JSON.stringify(g);
      return [
        "الصف الأول الابتدائي",
        "الصف الثاني الابتدائي",
        "الصف الثالث الابتدائي"
      ].some(gr => str.includes(gr));
    };

    if (subject === 'العلوم' && isGrade123(grade)) {
      return res.status(400).json({ error: 'Science (العلوم) is not allowed for Grade 1, 2, and 3 Primary.' });
    }

    const cluster = await prisma.skillCluster.create({
      data: {
        name,
        description,
        subject,
        grade,
        isCentral: req.user.role === 'SUPER_ADMIN' ? !!isCentral : false,
        creatorId: req.user.id,
        schoolId
      }
    });

    res.json({ message: 'Skill Cluster created successfully', cluster });
  } catch (error: any) {
    console.error('Error creating skill cluster:', error);
    res.status(500).json({ error: 'Error creating skill cluster', details: error.message });
  }
});

// Update a Skill Cluster
router.put('/api/skills-hub/clusters/:id', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { name, description, subject, isCentral } = req.body;
    const rawGrade = req.body.grades !== undefined ? req.body.grades : req.body.grade;
    const grade = rawGrade !== undefined ? (Array.isArray(rawGrade) ? JSON.stringify(rawGrade) : String(rawGrade || '')) : undefined;

    const existingCluster = await prisma.skillCluster.findUnique({ where: { id } });
    if (!existingCluster) {
      return res.status(404).json({ error: 'Skill Cluster not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && existingCluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied: You can only edit your school\'s clusters.' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && isCentral !== undefined && isCentral !== existingCluster.isCentral) {
      return res.status(403).json({ error: 'Only Super Admin can modify centrality of clusters.' });
    }

    const rawSchool = req.body.schoolIds !== undefined ? req.body.schoolIds : req.body.schoolId;
    let schoolId: string | null | undefined = undefined;
    if (req.user.role === 'SUPER_ADMIN') {
      const checkIsCentral = isCentral !== undefined ? !!isCentral : existingCluster.isCentral;
      if (checkIsCentral) {
        schoolId = null;
      } else if (rawSchool !== undefined) {
        if (Array.isArray(rawSchool)) {
          schoolId = rawSchool[0] || null;
        } else if (typeof rawSchool === 'string' && rawSchool.startsWith('[')) {
          try {
            const parsed = JSON.parse(rawSchool);
            schoolId = Array.isArray(parsed) ? (parsed[0] || null) : rawSchool;
          } catch {
            schoolId = rawSchool || null;
          }
        } else {
          schoolId = rawSchool || null;
        }
      }
    }

    const checkSubject = subject !== undefined ? subject : existingCluster.subject;
    const checkGrade = grade !== undefined ? grade : existingCluster.grade;
    const isGrade123 = (g?: any) => {
      if (!g) return false;
      const str = typeof g === 'string' ? g : JSON.stringify(g);
      return [
        "الصف الأول الابتدائي",
        "الصف الثاني الابتدائي",
        "الصف الثالث الابتدائي"
      ].some(gr => str.includes(gr));
    };
    if (checkSubject === 'العلوم' && checkGrade && isGrade123(checkGrade)) {
      return res.status(400).json({ error: 'Science (العلوم) is not allowed for Grade 1, 2, and 3 Primary.' });
    }

    const cluster = await prisma.skillCluster.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(subject !== undefined && { subject }),
        ...(grade !== undefined && { grade }),
        ...(isCentral !== undefined && req.user.role === 'SUPER_ADMIN' && { isCentral: !!isCentral }),
        ...(schoolId !== undefined && req.user.role === 'SUPER_ADMIN' && { schoolId })
      }
    });

    res.json({ message: 'Skill Cluster updated successfully', cluster });
  } catch (error: any) {
    console.error('Error updating skill cluster:', error);
    res.status(500).json({ error: 'Error updating skill cluster', details: error.message });
  }
});

// Delete a Skill Cluster
router.delete('/api/skills-hub/clusters/:id', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const existingCluster = await prisma.skillCluster.findUnique({ where: { id } });
    if (!existingCluster) {
      return res.status(404).json({ error: 'Skill Cluster not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && existingCluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied: You can only delete your school\'s clusters.' });
    }

    await prisma.skillCluster.delete({ where: { id } });
    res.json({ message: 'Skill Cluster deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting skill cluster:', error);
    res.status(500).json({ error: 'Error deleting skill cluster', details: error.message });
  }
});


// --- 2. SKILL LESSONS CRUD ---

// Get all lessons for a cluster
router.get('/api/skills-hub/clusters/:clusterId/lessons', verifyToken, async (req: any, res: any) => {
  try {
    const { clusterId } = req.params;

    const cluster = await prisma.skillCluster.findUnique({ where: { id: clusterId } });
    if (!cluster) {
      return res.status(404).json({ error: 'Skill Cluster not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && !cluster.isCentral && cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const lessons = await prisma.skillLesson.findMany({
      where: { clusterId },
      include: {
        _count: {
          select: { activities: true }
        }
      },
      orderBy: { order: 'asc' }
    });

    res.json(lessons);
  } catch (error: any) {
    console.error('Error fetching skill lessons:', error);
    res.status(500).json({ error: 'Error fetching skill lessons', details: error.message });
  }
});

// Create a Skill Lesson
router.post('/api/skills-hub/lessons', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const { clusterId, name, description, order } = req.body;
    const missing = hasRequiredFields(req.body, ['clusterId', 'name']);
    if (missing) {
      return res.status(400).json({ error: `يرجى إدخال اسم الدرس أو المهارة الفرعية المطلوبة ⚠️ (Missing: ${missing.join(', ')})` });
    }

    const cluster = await prisma.skillCluster.findUnique({ where: { id: clusterId } });
    if (!cluster) {
      return res.status(404).json({ error: 'Skill Cluster not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && cluster.schoolId && cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied: Cannot add lessons to this cluster.' });
    }

    const lesson = await prisma.skillLesson.create({
      data: {
        clusterId,
        name,
        description,
        order: order !== undefined ? Number(order) : 0
      }
    });

    res.json({ message: 'Skill Lesson created successfully', lesson });
  } catch (error: any) {
    console.error('Error creating skill lesson:', error);
    res.status(500).json({ error: 'Error creating skill lesson', details: error.message });
  }
});

// Update a Skill Lesson
router.put('/api/skills-hub/lessons/:id', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { name, description, order } = req.body;

    const existingLesson = await prisma.skillLesson.findUnique({
      where: { id },
      include: { cluster: true }
    });
    if (!existingLesson) {
      return res.status(404).json({ error: 'Skill Lesson not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && existingLesson.cluster.schoolId && existingLesson.cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied: Cannot edit lessons in this cluster.' });
    }

    const lesson = await prisma.skillLesson.update({
      where: { id },
      data: {
        name,
        description,
        order: order !== undefined ? Number(order) : existingLesson.order
      }
    });

    res.json({ message: 'Skill Lesson updated successfully', lesson });
  } catch (error: any) {
    console.error('Error updating skill lesson:', error);
    res.status(500).json({ error: 'Error updating skill lesson', details: error.message });
  }
});

// Delete a Skill Lesson
router.delete('/api/skills-hub/lessons/:id', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const existingLesson = await prisma.skillLesson.findUnique({
      where: { id },
      include: { cluster: true }
    });
    if (!existingLesson) {
      return res.status(404).json({ error: 'Skill Lesson not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && existingLesson.cluster.schoolId && existingLesson.cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied: Cannot delete lessons in this cluster.' });
    }

    await prisma.skillLesson.delete({ where: { id } });
    res.json({ message: 'Skill Lesson deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting skill lesson:', error);
    res.status(500).json({ error: 'Error deleting skill lesson', details: error.message });
  }
});


// --- 3. INTERACTIVE ACTIVITIES CRUD ---

// Get all activities for a lesson
router.get('/api/skills-hub/lessons/:lessonId/activities', verifyToken, async (req: any, res: any) => {
  try {
    const { lessonId } = req.params;

    const lesson = await prisma.skillLesson.findUnique({
      where: { id: lessonId },
      include: { cluster: true }
    });
    if (!lesson) {
      return res.status(404).json({ error: 'Skill Lesson not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && !lesson.cluster.isCentral && lesson.cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const activities = await prisma.interactiveActivity.findMany({
      where: { lessonId },
      orderBy: { createdAt: 'asc' }
    });

    const parsedActivities = activities.map((act) => ({
      ...act,
      options: typeof act.options === 'string' && (act.options.startsWith('{') || act.options.startsWith('[')) ? JSON.parse(act.options) : act.options,
      correctAnswer: typeof act.correctAnswer === 'string' && (act.correctAnswer.startsWith('{') || act.correctAnswer.startsWith('[')) ? JSON.parse(act.correctAnswer) : act.correctAnswer
    }));

    res.json(parsedActivities);
  } catch (error: any) {
    console.error('Error fetching interactive activities:', error);
    res.status(500).json({ error: 'Error fetching interactive activities', details: error.message });
  }
});

// Get a single activity (for play mode)
router.get('/api/skills-hub/activities/:id', verifyToken, async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const activity = await prisma.interactiveActivity.findUnique({
      where: { id },
      include: {
        lesson: {
          include: { cluster: true }
        }
      }
    });

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && !activity.lesson.cluster.isCentral && activity.lesson.cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const responseData = {
      ...activity,
      options: typeof activity.options === 'string' && (activity.options.startsWith('{') || activity.options.startsWith('[')) ? JSON.parse(activity.options) : activity.options,
      correctAnswer: typeof activity.correctAnswer === 'string' && (activity.correctAnswer.startsWith('{') || activity.correctAnswer.startsWith('[')) ? JSON.parse(activity.correctAnswer) : activity.correctAnswer
    };

    res.json(responseData);
  } catch (error: any) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: 'Error fetching activity', details: error.message });
  }
});

// Create an Interactive Activity
router.post('/api/skills-hub/activities', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const {
      lessonId, title, type, options, correctAnswer, points, xpPoints, difficulty, dok, estimatedTime,
      standard, indicator, learningOutcome, skill, hint, tip, explanation, keyInsight
    } = req.body;

    const missing = hasRequiredFields(req.body, ['lessonId', 'title', 'type', 'options', 'correctAnswer']);
    if (missing) {
      const fieldMap: Record<string, string> = {
        title: 'عنوان السؤال (Question Title)',
        type: 'نوع السؤال (Question Type)',
        options: 'الخيارات (Options)',
        correctAnswer: 'الإجابة الصحيحة (Correct Answer)',
        lessonId: 'الدرس (Lesson ID)'
      };
      const translatedMissing = missing.map(m => fieldMap[m] || m).join('، ');
      return res.status(400).json({ error: `يرجى إكمال الحقول المطلوبة لحفظ السؤال ⚠️: ${translatedMissing}` });
    }

    const lesson = await prisma.skillLesson.findUnique({
      where: { id: lessonId },
      include: { cluster: true }
    });
    if (!lesson) {
      return res.status(404).json({ error: 'Skill Lesson not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && lesson.cluster.schoolId && lesson.cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied: Cannot add activities in this cluster.' });
    }

    const activity = await prisma.interactiveActivity.create({
      data: {
        lessonId,
        title,
        type,
        options: typeof options === 'string' ? options : JSON.stringify(options),
        correctAnswer: typeof correctAnswer === 'string' ? correctAnswer : JSON.stringify(correctAnswer),
        points: points !== undefined ? Number(points) : 10,
        xpPoints: xpPoints !== undefined ? Number(xpPoints) : 10,
        difficulty: difficulty || 'Medium',
        dok: dok || null,
        estimatedTime: estimatedTime !== undefined ? Number(estimatedTime) : 60,
        standard: standard || null,
        indicator: indicator || null,
        learningOutcome: learningOutcome || null,
        skill: skill || null,
        hint: hint || null,
        tip: tip || null,
        explanation: explanation || null,
        keyInsight: keyInsight || null
      }
    });

    res.json({ message: 'Interactive Activity created successfully', activity });
  } catch (error: any) {
    console.error('Error creating activity:', error);
    res.status(500).json({ error: 'Error creating activity', details: error.message });
  }
});

// Update an Interactive Activity
router.put('/api/skills-hub/activities/:id', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const {
      title, type, options, correctAnswer, points, xpPoints, difficulty, dok, estimatedTime,
      standard, indicator, learningOutcome, skill, hint, tip, explanation, keyInsight
    } = req.body;

    const existingActivity = await prisma.interactiveActivity.findUnique({
      where: { id },
      include: { lesson: { include: { cluster: true } } }
    });
    if (!existingActivity) {
      return res.status(404).json({ error: 'Interactive Activity not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && existingActivity.lesson.cluster.schoolId && existingActivity.lesson.cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied: Cannot edit activities in this cluster.' });
    }

    const activity = await prisma.interactiveActivity.update({
      where: { id },
      data: {
        title: title !== undefined ? title : existingActivity.title,
        type: type !== undefined ? type : existingActivity.type,
        options: options !== undefined ? (typeof options === 'string' ? options : JSON.stringify(options)) : existingActivity.options,
        correctAnswer: correctAnswer !== undefined ? (typeof correctAnswer === 'string' ? correctAnswer : JSON.stringify(correctAnswer)) : existingActivity.correctAnswer,
        points: points !== undefined ? Number(points) : existingActivity.points,
        xpPoints: xpPoints !== undefined ? Number(xpPoints) : existingActivity.xpPoints,
        difficulty: difficulty !== undefined ? difficulty : existingActivity.difficulty,
        dok: dok !== undefined ? dok : existingActivity.dok,
        estimatedTime: estimatedTime !== undefined ? Number(estimatedTime) : existingActivity.estimatedTime,
        standard: standard !== undefined ? standard : existingActivity.standard,
        indicator: indicator !== undefined ? indicator : existingActivity.indicator,
        learningOutcome: learningOutcome !== undefined ? learningOutcome : existingActivity.learningOutcome,
        skill: skill !== undefined ? skill : existingActivity.skill,
        hint: hint !== undefined ? hint : existingActivity.hint,
        tip: tip !== undefined ? tip : existingActivity.tip,
        explanation: explanation !== undefined ? explanation : existingActivity.explanation,
        keyInsight: keyInsight !== undefined ? keyInsight : existingActivity.keyInsight
      }
    });

    res.json({ message: 'Interactive Activity updated successfully', activity });
  } catch (error: any) {
    console.error('Error updating activity:', error);
    res.status(500).json({ error: 'Error updating activity', details: error.message });
  }
});

// Delete an Interactive Activity
router.delete('/api/skills-hub/activities/:id', verifyToken, checkRole(['SUPER_ADMIN']), async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const existingActivity = await prisma.interactiveActivity.findUnique({
      where: { id },
      include: { lesson: { include: { cluster: true } } }
    });
    if (!existingActivity) {
      return res.status(404).json({ error: 'Interactive Activity not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && existingActivity.lesson.cluster.schoolId && existingActivity.lesson.cluster.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied: Cannot delete activities in this cluster.' });
    }

    await prisma.interactiveActivity.delete({ where: { id } });
    res.json({ message: 'Interactive Activity deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting activity:', error);
    res.status(500).json({ error: 'Error deleting activity', details: error.message });
  }
});


// --- 4. ATTEMPT & GRADING EVALUATION ---

router.post('/api/skills-hub/activities/:id/attempt', verifyToken, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { selectedAnswer, timeTaken, hintsUsed = 0, attemptCount = 1 } = req.body;
    const user = req.user;

    const activity = await prisma.interactiveActivity.findUnique({
      where: { id },
      include: { lesson: { include: { cluster: true } } }
    });

    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    if (user.role !== 'SUPER_ADMIN' && !activity.lesson.cluster.isCentral && activity.lesson.cluster.schoolId !== user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const mockQuestion = {
      type: activity.type,
      correctAnswer: activity.correctAnswer,
      options: activity.options  // ✅ required for MCQ grading in isAnswerCorrect
    };
    const isCorrect = isAnswerCorrect(mockQuestion, selectedAnswer);

    let stars = 0;
    if (isCorrect) {
      const parsedHints = Number(hintsUsed) || 0;
      const parsedAttempts = Number(attemptCount) || 1;
      if (parsedAttempts <= 1 && parsedHints === 0) {
        stars = 3;
      } else if (parsedAttempts <= 2 && parsedHints <= 1) {
        stars = 2;
      } else {
        stars = 1;
      }
    }

    const basePoints = activity.points || 10;
    const score = Math.round(basePoints * (stars === 3 ? 1.0 : stars === 2 ? 0.7 : stars === 1 ? 0.5 : 0.0));

    const prevAttempts = await prisma.activityAttempt.count({
      where: { userId: user.id, activityId: activity.id }
    });

    const attempt = await prisma.activityAttempt.create({
      data: {
        userId: user.id,
        activityId: activity.id,
        selectedAnswer: typeof selectedAnswer === 'string' ? selectedAnswer : JSON.stringify(selectedAnswer),
        isCorrect,
        score,
        stars,
        timeTaken: timeTaken !== undefined ? Number(timeTaken) : null
      }
    });

    const isFirstAttempt = prevAttempts === 0;
    const earnedXP = (isFirstAttempt && isCorrect) ? (activity.xpPoints !== undefined ? Number(activity.xpPoints) : 10) : 0;

    await prisma.xPHistory.create({
      data: {
        userId: user.id,
        xp: earnedXP,
        sourceType: "INTERACTIVE_ACTIVITY",
        sourceId: activity.lessonId,
        questionId: activity.id,
        isCorrect,
        attemptNum: prevAttempts + 1
      }
    });

    const activities = await prisma.interactiveActivity.findMany({
      where: { lessonId: activity.lessonId },
      orderBy: { createdAt: 'asc' }
    });

    const firstAttempts = await prisma.xPHistory.findMany({
      where: {
        userId: user.id,
        sourceId: activity.lessonId,
        sourceType: "INTERACTIVE_ACTIVITY",
        attemptNum: 1,
        isBonus: false
      }
    });
    const attemptsMap = new Map(firstAttempts.map(a => [a.questionId, a]));

    let currentStreak = 0;
    for (const act of activities) {
      const att = attemptsMap.get(act.id);
      if (!att) break;
      if (att.isCorrect) {
        currentStreak++;
      } else {
        currentStreak = 0;
      }
    }

    let bonusXP = 0;
    if (isFirstAttempt && isCorrect && (currentStreak === 5 || currentStreak === 10)) {
      const bonusType = `streak_${currentStreak}`;
      const alreadyHasBonus = await prisma.xPHistory.count({
        where: {
          userId: user.id,
          sourceId: activity.lessonId,
          sourceType: "INTERACTIVE_ACTIVITY",
          questionId: bonusType,
          isBonus: true
        }
      }) > 0;

      if (!alreadyHasBonus) {
        bonusXP = currentStreak === 5 ? 10 : 30;
        await prisma.xPHistory.create({
          data: {
            userId: user.id,
            xp: bonusXP,
            sourceType: "INTERACTIVE_ACTIVITY",
            sourceId: activity.lessonId,
            questionId: bonusType,
            isCorrect: true,
            attemptNum: 1,
            isBonus: true
          }
        });
      }
    }

    const totalXPToAward = earnedXP + bonusXP;
    if (totalXPToAward > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { xp: { increment: totalXPToAward } }
      });
    }

    if (typeof statsCache !== 'undefined') {
      statsCache.delete(`student_stats_${user.id}`);
    }

    res.json({
      message: 'Attempt logged successfully',
      attemptId: attempt.id,
      isCorrect,
      stars,
      score,
      earnedXP,
      bonusXP,
      currentStreak: isFirstAttempt ? currentStreak : 0,
      correctAnswer: typeof activity.correctAnswer === 'string' && (activity.correctAnswer.startsWith('{') || activity.correctAnswer.startsWith('[')) ? JSON.parse(activity.correctAnswer) : activity.correctAnswer,
      explanation: activity.explanation,
      keyInsight: activity.keyInsight
    });
  } catch (error: any) {
    console.error('Error logging activity attempt:', error);
    res.status(500).json({ error: 'Error logging activity attempt', details: error.message });
  }
});


// --- 5. PROGRESS & MASTERY REPORTS ---

router.get('/api/skills-hub/progress', verifyToken, async (req: any, res: any) => {
  try {
    const { subject, grade } = req.query;
    const user = req.user;

    const targetUserId = req.query.userId && ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes(user.role)
      ? (req.query.userId as string)
      : user.id;

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const clusterWhere: any = {};
    if (subject) clusterWhere.subject = subject as string;

    const targetGrade = (grade as string) || targetUser.grade;
    const isGrade123 = (g: string) => [
      "الصف الأول الابتدائي",
      "الصف الثاني الابتدائي",
      "الصف الثالث الابتدائي"
    ].includes(g);
    if (subject === 'العلوم' && targetGrade && isGrade123(targetGrade)) {
      return res.status(400).json({ error: 'Science (العلوم) is not available for Grade 1, 2, and 3 Primary.' });
    }
    if (targetGrade) clusterWhere.grade = targetGrade;

    if (targetUser.schoolId) {
      clusterWhere.OR = [
        { isCentral: true },
        { schoolId: targetUser.schoolId }
      ];
    } else {
      clusterWhere.isCentral = true;
    }

    const clusters = await prisma.skillCluster.findMany({
      where: clusterWhere,
      include: {
        skills: {
          include: {
            activities: true
          }
        }
      }
    });

    const attempts = await prisma.activityAttempt.findMany({
      where: { userId: targetUserId }
    });

    const bestAttemptsMap = new Map<string, any>();
    attempts.forEach(att => {
      const prev = bestAttemptsMap.get(att.activityId);
      if (!prev || att.stars > prev.stars) {
        bestAttemptsMap.set(att.activityId, att);
      }
    });

    const clusterProgressReport = clusters.map(cluster => {
      let totalActivities = 0;
      let completedActivities = 0;
      let totalStarsEarned = 0;
      let totalXPEarned = 0;

      const skillsReport = cluster.skills.map(skill => {
        const activitiesReport = skill.activities.map(act => {
          totalActivities++;
          const bestAttempt = bestAttemptsMap.get(act.id);
          let bestAttemptStars = 0;
          let bestAttemptCorrect = false;

          if (bestAttempt) {
            bestAttemptStars = bestAttempt.stars;
            bestAttemptCorrect = bestAttempt.isCorrect;
            totalStarsEarned += bestAttempt.stars;
            totalXPEarned += bestAttempt.score;
            if (bestAttempt.isCorrect) {
              completedActivities++;
            }
          }

          return {
            id: act.id,
            title: act.title,
            type: act.type,
            difficulty: act.difficulty,
            dok: act.dok,
            points: act.points,
            estimatedTime: act.estimatedTime,
            standard: act.standard,
            indicator: act.indicator,
            learningOutcome: act.learningOutcome,
            bestAttemptStars,
            bestAttemptCorrect
          };
        });

        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          order: skill.order,
          activities: activitiesReport
        };
      });

      const maxPossibleStars = totalActivities * 3;
      const masteryPercent = maxPossibleStars > 0 ? Math.round((totalStarsEarned / maxPossibleStars) * 100) : 0;
      const completionPercent = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;

      return {
        id: cluster.id,
        name: cluster.name,
        description: cluster.description,
        subject: cluster.subject,
        grade: cluster.grade,
        isCentral: cluster.isCentral,
        skills: skillsReport,
        stats: {
          totalActivities,
          completedActivities,
          completionPercent,
          totalStarsEarned,
          maxPossibleStars,
          masteryPercent,
          totalXPEarned
        }
      };
    });

    res.json({
      userId: targetUserId,
      grade: targetGrade,
      subject,
      clusters: clusterProgressReport
    });
  } catch (error: any) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Error fetching progress', details: error.message });
  }
});

router.get('/api/skills-hub/classroom-mastery', verifyToken, checkRole(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']), async (req: any, res: any) => {
  try {
    const { classroomId, subject } = req.query;
    if (!classroomId) {
      return res.status(400).json({ error: 'classroomId is required' });
    }

    const classroom = await prisma.classroom.findUnique({
      where: { id: classroomId as string },
      include: {
        students: {
          select: { id: true, name: true, username: true }
        }
      }
    });

    if (!classroom) {
      return res.status(404).json({ error: 'Classroom not found' });
    }

    if (req.user.role !== 'SUPER_ADMIN' && classroom.schoolId !== req.user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const clusterWhere: any = { grade: classroom.grade };
    if (subject) clusterWhere.subject = subject as string;

    if (classroom.schoolId) {
      clusterWhere.OR = [
        { isCentral: true },
        { schoolId: classroom.schoolId }
      ];
    } else {
      clusterWhere.isCentral = true;
    }

    const clusters = await prisma.skillCluster.findMany({
      where: clusterWhere,
      include: {
        skills: {
          include: {
            activities: {
              select: { id: true, points: true }
            }
          }
        }
      }
    });

    const activityIds: string[] = [];
    clusters.forEach(c => {
      c.skills.forEach(s => {
        s.activities.forEach(a => {
          activityIds.push(a.id);
        });
      });
    });

    const studentIds = classroom.students.map(s => s.id);
    const attempts = await prisma.activityAttempt.findMany({
      where: {
        userId: { in: studentIds },
        activityId: { in: activityIds }
      }
    });

    const studentAttemptsMap = new Map<string, Map<string, any>>();
    studentIds.forEach(sid => studentAttemptsMap.set(sid, new Map()));

    attempts.forEach(att => {
      const userMap = studentAttemptsMap.get(att.userId);
      if (userMap) {
        const prev = userMap.get(att.activityId);
        if (!prev || att.stars > prev.stars) {
          userMap.set(att.activityId, att);
        }
      }
    });

    const studentsReport = classroom.students.map(student => {
      const userMap = studentAttemptsMap.get(student.id);

      const clusterMasteryList = clusters.map(cluster => {
        let totalActivities = 0;
        let totalStars = 0;

        cluster.skills.forEach(skill => {
          skill.activities.forEach(act => {
            totalActivities++;
            const bestAttempt = userMap?.get(act.id);
            if (bestAttempt) {
              totalStars += bestAttempt.stars;
            }
          });
        });

        const maxStars = totalActivities * 3;
        const masteryPercent = maxStars > 0 ? Math.round((totalStars / maxStars) * 100) : 0;

        return {
          clusterId: cluster.id,
          clusterName: cluster.name,
          masteryPercent
        };
      });

      return {
        id: student.id,
        name: student.name,
        username: student.username,
        clusters: clusterMasteryList
      };
    });

    res.json({
      classroomId,
      className: classroom.name,
      grade: classroom.grade,
      subject,
      students: studentsReport
    });
  } catch (error: any) {
    console.error('Error fetching classroom mastery:', error);
    res.status(500).json({ error: 'Error fetching classroom mastery', details: error.message });
  }
});


export default router;
