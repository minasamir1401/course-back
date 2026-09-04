import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import {
  buildQuestionFingerprint,
  pickReconciliationCandidate,
  sortPersistedOrder,
} from '../lib/contentReconciliation';
import { verifyToken, checkRole, checkSchoolAccess } from '../middleware/auth';
import { countModuleContent, getAvailability, mergeStudentProfile, resolveExamAccessPassword } from '../utils/examWorkflow';
import { logExamRequestError } from '../utils/examErrorLog';
import { resolveExplicitExamDeletions } from '../utils/examDeletionPolicy';
import { resolvePassingScore } from '../utils/examPassingScore';
import { canManageExamRecord } from '../utils/examAccessPolicy';
import {
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields,
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses, acquireLock, releaseLock, extractAndSaveBase64Images
} from '../shared';


const normalizeBackendDok = (raw: any): string | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(?:dok\s*|level\s*|مستوى\s*)?([1-4])(?:\.0)?$/i);
  if (m) return `DOK ${m[1]}`;
  return sanitizeHtml(s);
};

export const canManageExam = async (
  user: any,
  exam: {
    isCentral?: boolean | null;
    schoolId?: string | null;
    creatorId?: string | null;
    courseId?: string | null;
    schools?: Array<{ id: string }>;
  },
) => {
  let hasTeacherCourseAccess = false;
  if (user.role === 'TEACHER' && exam.courseId) {
    const teacherCourse = await prisma.teacherCourse.findFirst({
      where: {
        teacherId: user.id,
        courseId: exam.courseId,
      },
      select: { id: true },
    });

    hasTeacherCourseAccess = Boolean(teacherCourse);
  }
  return canManageExamRecord(user, exam, hasTeacherCourseAccess);
};



export const getExamHandler1 = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    // 1. Get total XP from User model
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true, name: true, avatar: true, grade: true }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // 2. Get recent exams
    const submissions = await prisma.examSubmission.findMany({
      where: { userId },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            type: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    const portfolio = submissions.map(sub => ({
      examId: sub.exam.id,
      examTitle: sub.exam.title,
      score: sub.totalScore,
      date: sub.createdAt
    }));

    res.json({
      user,
      portfolio
    });
  } catch (error: any) {
    console.error('Error fetching student portfolio:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
};


export const postExamHandler2 = async (req: Request, res: Response) => {
  try {
    const { title, description, type, duration, passingScore, showAnswers, isCentral, schoolIds, schoolId, grade, grades, subjects, courseId, folderId, questions, courseName, section, domain, learningOutcomes, indicators, skills, gradeTarget } = req.body;
    const missing = hasRequiredFields(req.body, ['title']);
    if (missing) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }
    if (questions && !Array.isArray(questions)) {
      return res.status(400).json({ error: 'questions must be an array.' });
    }

    // Prepare target schools
    const effectiveIsCentral = !!isCentral;
    const finalSchoolIds = (req as any).user.role === 'SCHOOL_ADMIN'
      ? (effectiveIsCentral ? [] : [(req as any).user.schoolId])
      : (effectiveIsCentral ? [] : (schoolIds || (schoolId ? [schoolId] : [(req as any).user.schoolId])).filter(Boolean));
    const ownerSchoolId = (req as any).user.role === 'SCHOOL_ADMIN'
      ? (effectiveIsCentral ? null : (req as any).user.schoolId)
      : (effectiveIsCentral ? null : (schoolId || (req as any).user.schoolId));

    // Check if duplicate exam already exists in the same target school
    if (req.body.status !== 'DRAFT') {
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
    }

    const sanitizedQuestions = sanitizeDeep(questions || []);

    const sanitizedModulesInput = Array.isArray(req.body.modules) ? req.body.modules : [];

    const exam = await prisma.$transaction(async (tx) => {
      const newExam = await tx.exam.create({
        data: {
          title: sanitizeHtml(title),
          description: description ? extractAndSaveBase64Images(sanitizeHtml(description)) : null,
          // The exam workflow exposes one assessment type only; normalize legacy Quiz input.
          type: type ? (String(type).toLowerCase() === 'quiz' ? 'Exam' : sanitizeHtml(type)) : 'Exam',
          courseId: courseId ? sanitizeHtml(courseId) : null,
          folderId: folderId ? sanitizeHtml(folderId) : null,

          isCentral: effectiveIsCentral,
          creatorId: (req as any).user.id,
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
            connect: finalSchoolIds.filter((id: string) => id && id !== 'null').map((id: string) => ({ id }))
          },
          courseName: courseName ? sanitizeHtml(courseName) : null,
          section: section ? sanitizeHtml(section) : null,
          domain: domain ? sanitizeHtml(domain) : null,
          learningOutcomes: learningOutcomes ? sanitizeHtml(learningOutcomes) : null,
          indicators: indicators ? sanitizeHtml(indicators) : null,
          skills: skills ? sanitizeHtml(skills) : null,
          gradeTarget: gradeTarget ? sanitizeHtml(gradeTarget) : null
        }
      });

      // Sequential Module Creation
      const moduleIdMap: Record<string, string> = {};
      const subExamIdMap: Record<string, string> = {};
      for (let i = 0; i < sanitizedModulesInput.length; i++) {
        const m = sanitizedModulesInput[i];
        const frontendModuleId = m.id;
        const createdMod = await tx.examModule.create({
          data: {
            examId: newExam.id,
            title: m.title ? sanitizeHtml(m.title) : `Module ${i + 1}`,
            description: m.description ? sanitizeHtml(m.description) : null,
            order: m.order !== undefined ? parseInt(m.order) : i,
            duration: m.duration ? parseInt(m.duration) : null,
            passingScore: m.passingScore ? parseInt(m.passingScore) : null,
            gradeTarget: m.gradeTarget ? sanitizeHtml(m.gradeTarget) : null,
            publishDate: m.publishDate ? new Date(m.publishDate) : null,
            cutOffDate: m.cutOffDate ? new Date(m.cutOffDate) : null,
          }
        });
        if (frontendModuleId) moduleIdMap[frontendModuleId] = createdMod.id;

        const subExamsInput = Array.isArray(m.subExams) ? m.subExams : [];
        for (let j = 0; j < subExamsInput.length; j++) {
          const s = subExamsInput[j];
          const createdSubExam = await tx.subExam.create({
            data: {
              moduleId: createdMod.id,
              title: s.title ? sanitizeHtml(s.title) : `Sub-Exam ${j + 1}`,
              password: s.password ? sanitizeHtml(s.password) : null,
              duration: s.duration ? parseInt(s.duration) : null,
              passingScore: s.passingScore ? parseInt(s.passingScore) : null,
              attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
              order: s.order !== undefined ? parseInt(s.order) : j,
              publishDate: s.publishDate ? new Date(s.publishDate) : null,
              cutOffDate: s.cutOffDate ? new Date(s.cutOffDate) : null,
            }
          });
          if (s.id) subExamIdMap[s.id] = createdSubExam.id;
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
            type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(q.type) ? sanitizeHtml(q.type) : 'MCQ',
            options: extractAndSaveBase64Images(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])),
            correctAnswer: formatCorrectAnswer(q),
            points: parseInt(q.points) || 1,
            xpPoints: parseInt(q.xpPoints) || 10,
            skill: q.skill ? sanitizeHtml(q.skill) : null,
            learningOutcome: (q.standard || q.learningOutcome) ? sanitizeHtml(q.standard || q.learningOutcome) : null,
            standard: (q.standard || q.learningOutcome) ? sanitizeHtml(q.standard || q.learningOutcome) : null,
            indicator: q.indicator ? sanitizeHtml(q.indicator) : null,
            videoUrl: q.videoUrl ? sanitizeHtml(q.videoUrl) : null,
            level: q.level ? sanitizeHtml(q.level) : 'Medium',
            dok: normalizeBackendDok(q.dok),
            cognitive: q.cognitive ? sanitizeHtml(q.cognitive) : null,
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
            subExamId: q.subExamId
              ? (subExamIdMap[sanitizeHtml(q.subExamId)] || null)
              : null,
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

    res.json({ message: 'Exam created successfully', exam });
  } catch (error: any) {
    console.error('❌ Exam creation error:', error);
    res.status(500).json({ error: 'Error creating exam', details: error.message });
  }
};


export const getExamHandler3 = async (req: Request, res: Response) => {
  try {
    const { schoolId, isCentral, grade, folderId } = req.query;

    const where: any = { deletedAt: null };
    if (folderId) {
      where.folderId = folderId;
    }
    if (isCentral === 'true') {
      where.isCentral = true;
    } else if ((req as any).user.role === 'SUPER_ADMIN') {
      if (schoolId) {
        where.OR = [
          { isCentral: true },
          { schoolId: schoolId },
          { schools: { some: { id: schoolId } } }
        ];
      }
      if (grade) where.grade = grade as string;
    } else if ((req as any).user.role === 'SCHOOL_ADMIN') {
      where.OR = [
        { isCentral: true },
        { schoolId: (req as any).user.schoolId },
        { schools: { some: { id: (req as any).user.schoolId } } }
      ];
      if (grade) where.grade = grade as string;
    } else if ((req as any).user.role === 'TEACHER') {
      where.OR = [
        { creatorId: (req as any).user.id },
        { course: { teachers: { some: { teacherId: (req as any).user.id } } } }
      ];
      if (grade) where.grade = grade as string;
    } else if ((req as any).user.role === 'STUDENT') {
      // Fetch latest user info to get current grade if not in token
      let currentGrade = (req as any).user.grade;
      const schoolId = (req as any).user.schoolId;

      if (currentGrade === undefined) {
        const student = await prisma.user.findUnique({ where: { id: (req as any).user.id } });
        currentGrade = student?.grade || null;
      }

      // Base filters
      const orFilters: any[] = [{ isCentral: true }];

      // Only add school filters if student belongs to a school
      if (schoolId) {
        orFilters.push({ schoolId: schoolId });
        orFilters.push({ schools: { some: { id: schoolId } } });
      }

      const studentGrades = getStudentGradeAndStage(currentGrade);
      const gradeOrConditions: any[] = [{ grade: null }];
      for (const g of studentGrades) {
        gradeOrConditions.push({ grade: g });
        gradeOrConditions.push({ grades: { contains: `"${g}"` } });
      }

      where.AND = [
        { OR: orFilters },
        { OR: gradeOrConditions }
      ];
      where.status = 'PUBLISHED';
    } else if ((req as any).user.role === 'TEACHER') {
      const teacherCourses = await prisma.teacherCourse.findMany({
        where: { teacherId: (req as any).user.id },
        select: { courseId: true }
      });
      const courseIds = teacherCourses.map(tc => tc.courseId);
      where.courseId = { in: courseIds };
    }

    let exams = await prisma.exam.findMany({
      where,
      include: {
        school: { select: { name: true } },
        schools: { select: { name: true, id: true } },
        creator: { select: { name: true } },
        _count: { select: { questions: { where: { deletedAt: null } } } },
        modules: { include: { subExams: { include: { _count: { select: { questions: { where: { deletedAt: null } } } } } }, _count: { select: { questions: { where: { deletedAt: null } } } } } }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    res.json(exams.map((exam: any) => ({
      ...exam,
      modules: (exam.modules || []).map((module: any) => ({
        ...module,
        ...countModuleContent(module),
        availability: getAvailability(module),
        subExams: (module.subExams || []).map((subExam: any) => ({
          ...subExam,
          questionsCount: subExam._count?.questions || 0,
          availability: getAvailability(subExam),
        })),
      })),
    })));
  } catch (error) {
    logExamRequestError('list', req, error);
    res.status(500).json({ error: 'Error fetching exams' });
  }
};


export const getExamHandler4 = async (req: any, res: any) => {
  try {
    const { grade, search } = req.query;

    const questions = await prisma.question.findMany({
      where: {
        exam: { isCentral: true },
        deletedAt: null,
        ...(grade ? { exam: { grade: grade as string } } : {}),
        ...(search ? { text: { contains: search as string } } : {})
      },
      include: {
        exam: { select: { title: true, grade: true } }
      },
      take: 50,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    // Parse options for each question
    const parsedQuestions = questions.map(q => ({
      ...q,
      options: JSON.parse(q.options || "[]")
    }));

    res.json(parsedQuestions);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching question bank' });
  }
};


export const putExamHandler5 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, type, isCentral, schoolIds, duration, passingScore, showAnswers, questions, deletedQuestionIds, grade, grades, subjects, password, startDate, endDate, attemptsAllowed, status, courseId, folderId, courseName, section, domain, learningOutcomes, indicators, skills, gradeTarget } = req.body;
    if (questions !== undefined && !Array.isArray(questions)) {
      return res.status(400).json({ error: 'questions must be an array when provided.' });
    }
    const existingExam = await prisma.exam.findUnique({
      where: { id },
      include: {
        schools: { select: { id: true } },
        _count: { select: { submissions: true } }
      }
    });
    if (!existingExam) return res.status(404).json({ error: 'Exam not found' });

    if (!await canManageExam((req as any).user, existingExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to edit this exam.' });
    }

    const sanitizedQuestions = sanitizeDeep(questions || []);

    const updateData: any = {
      title: title !== undefined ? sanitizeHtml(title) : undefined,
      description: description !== undefined ? (description ? extractAndSaveBase64Images(sanitizeHtml(description)) : null) : undefined,
      type: type !== undefined ? (String(type).toLowerCase() === 'quiz' ? 'Exam' : sanitizeHtml(type)) : undefined,
      courseId: courseId !== undefined ? (courseId ? sanitizeHtml(courseId) : null) : undefined,

      showAnswers: showAnswers !== undefined ? showAnswers : undefined,
      resultVisibility: req.body.resultVisibility,
      password: req.body.password !== undefined ? (req.body.password || null) : undefined,
      startDate: req.body.startDate !== undefined ? (req.body.startDate ? new Date(req.body.startDate) : null) : undefined,
      endDate: req.body.endDate !== undefined ? (req.body.endDate ? new Date(req.body.endDate) : null) : undefined,
      status,
      category: req.body.category !== undefined ? (req.body.category ? sanitizeHtml(req.body.category) : null) : undefined,
      grade: grade !== undefined ? (grade ? sanitizeHtml(grade) : null) : undefined,
      grades: grades !== undefined ? (Array.isArray(grades) ? JSON.stringify(grades) : (grade ? JSON.stringify([grade]) : null)) : undefined,
      subjects: subjects !== undefined ? (Array.isArray(subjects) ? JSON.stringify(subjects) : (req.body.category ? JSON.stringify([req.body.category]) : null)) : undefined,
      courseName: courseName !== undefined ? (courseName ? sanitizeHtml(courseName) : null) : undefined,
      section: section !== undefined ? (section ? sanitizeHtml(section) : null) : undefined,
      domain: domain !== undefined ? (domain ? sanitizeHtml(domain) : null) : undefined,
      learningOutcomes: learningOutcomes !== undefined ? (learningOutcomes ? sanitizeHtml(learningOutcomes) : null) : undefined,
      indicators: indicators !== undefined ? (indicators ? sanitizeHtml(indicators) : null) : undefined,
      skills: skills !== undefined ? (skills ? sanitizeHtml(skills) : null) : undefined,
      gradeTarget: gradeTarget !== undefined ? (gradeTarget ? sanitizeHtml(gradeTarget) : null) : undefined
    };
    if (folderId !== undefined) updateData.folderId = folderId === null ? null : sanitizeHtml(folderId);
    if (duration !== undefined) updateData.duration = parseInt(duration);
    if (passingScore !== undefined) updateData.passingScore = parseInt(passingScore);
    if (attemptsAllowed !== undefined) updateData.attemptsAllowed = parseInt(attemptsAllowed) || 1;

    if ((req as any).user.role === 'SUPER_ADMIN') {
      const effectiveIsCentral = isCentral !== undefined ? !!isCentral : existingExam.isCentral;
      updateData.isCentral = effectiveIsCentral;
      updateData.schoolId = effectiveIsCentral ? null : (req.body.schoolId || existingExam.schoolId);
      if (schoolIds !== undefined) {
        updateData.schools = {
          set: [],
          connect: (schoolIds || []).filter((sid: any) => sid && sid !== 'null').map((sid: string) => ({ id: sid }))
        };
      }
    } else {
      const effectiveIsCentral = isCentral !== undefined ? !!isCentral : existingExam.isCentral;
      updateData.isCentral = effectiveIsCentral;
      updateData.schoolId = effectiveIsCentral ? null : (existingExam.schoolId || (req as any).user.schoolId);
    }

    const exam = await prisma.$transaction(async (tx) => {
      // --- MODULES UPSERT LOGIC ---
      let incomingModuleIds: string[] = [];
      let incomingSubExamIds: string[] = [];
      let modulesProvided = false;

      if (req.body.modules !== undefined) {
        modulesProvided = true;
        const sanitizedModules = Array.isArray(req.body.modules) ? req.body.modules : [];
        incomingModuleIds = sanitizedModules.map((m: any) => m.id).filter(Boolean);

        // 1. Gather all incoming SubExams across all modules
        incomingSubExamIds = sanitizedModules.flatMap((m: any) => (m.subExams || []).map((s: any) => s.id)).filter(Boolean);

        const { moduleIds: deletedModuleIds, subExamIds: deletedSubExamIds } = resolveExplicitExamDeletions(req.body);

        // A collection snapshot can be stale during autosave. Only an explicit
        // deletion request is allowed to unlink or remove persisted content.
        if (deletedSubExamIds.length > 0) {
          await tx.question.updateMany({
            where: { examId: id, subExamId: { in: deletedSubExamIds } },
            data: { subExamId: null }
          });
        }

        if (deletedModuleIds.length > 0) {
          await tx.question.updateMany({
            where: { examId: id, moduleId: { in: deletedModuleIds } },
            data: { moduleId: null }
          });
        }

        if (deletedSubExamIds.length > 0) {
          await tx.subExam.deleteMany({
            where: {
              module: { examId: id },
              id: { in: deletedSubExamIds }
            }
          });
        }

        if (deletedModuleIds.length > 0) {
          await tx.examModule.deleteMany({
            where: {
              examId: id,
              id: { in: deletedModuleIds }
            }
          });
        }

        // Upsert incoming modules
        for (let i = 0; i < sanitizedModules.length; i++) {
          const m = sanitizedModules[i];
          const mData = {
            title: m.title ? sanitizeHtml(m.title) : `Module ${i + 1}`,
            description: m.description ? sanitizeHtml(m.description) : null,
            order: m.order !== undefined ? parseInt(m.order) : i,
            duration: m.duration ? parseInt(m.duration) : null,
            passingScore: m.passingScore ? parseInt(m.passingScore) : null,
            gradeTarget: m.gradeTarget ? sanitizeHtml(m.gradeTarget) : null
            , publishDate: m.publishDate ? new Date(m.publishDate) : null
            , cutOffDate: m.cutOffDate ? new Date(m.cutOffDate) : null
          };
          let moduleId = m.id;
          if (m.id) {
            await tx.examModule.upsert({
              where: { id: m.id },
              update: mData,
              create: { id: m.id, examId: id, ...mData }
            });
          } else {
            const newMod = await tx.examModule.create({
              data: { examId: id, ...mData }
            });
            moduleId = newMod.id;
          }

          const sanitizedSubExams = Array.isArray(m.subExams) ? m.subExams : [];
          for (let j = 0; j < sanitizedSubExams.length; j++) {
            const s = sanitizedSubExams[j];
            const sData = {
              title: s.title ? sanitizeHtml(s.title) : `Sub-Exam ${j + 1}`,
              password: s.password ? sanitizeHtml(s.password) : null,
              duration: s.duration ? parseInt(s.duration) : null,
              passingScore: s.passingScore ? parseInt(s.passingScore) : null,
              attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
              order: s.order !== undefined ? parseInt(s.order) : j,
              publishDate: s.publishDate ? new Date(s.publishDate) : null,
              cutOffDate: s.cutOffDate ? new Date(s.cutOffDate) : null
            };
            if (s.id) {
              await tx.subExam.upsert({
                where: { id: s.id },
                update: sData,
                create: { id: s.id, moduleId: moduleId, ...sData }
              });
            } else {
              await tx.subExam.create({
                data: { moduleId: moduleId, ...sData }
              });
            }
          }
        }
      }
      // -----------------------------

      // 1. Update basic info and schools
      await tx.exam.update({
        where: { id },
        data: updateData
      });

      // 2. Handle questions safely without causing CASCADE DELETION of StudentAnswers
      if (Array.isArray(questions)) {
        // Fetch existing questions with their current explanation values for preservation
        const existingQuestionsWithExp = await tx.question.findMany({
          where: { examId: id, deletedAt: null },
          select: {
            id: true,
            text: true,
            type: true,
            options: true,
            correctAnswer: true,
            explanation: true,
            order: true,
            createdAt: true
          }
        });
        const existingIds = new Set(existingQuestionsWithExp.map(q => q.id));
        const existingExplanationMap = new Map(existingQuestionsWithExp.map(q => [q.id, q.explanation]));
        const explicitDeletedIds = new Set<string>(
          (Array.isArray(deletedQuestionIds) ? deletedQuestionIds : [])
            .filter((questionId: any): questionId is string => typeof questionId === 'string' && existingIds.has(questionId))
        );
        const existingCandidates = existingQuestionsWithExp.map((question) => ({
          id: question.id,
          order: question.order,
          createdAt: question.createdAt,
          fingerprint: buildQuestionFingerprint(question)
        }));
        const reservedIncomingIds = new Set<string>(
          sanitizedQuestions
            .map((question: any) => typeof question?.id === 'string' ? question.id : null)
            .filter((questionId: string | null): questionId is string =>
              !!questionId && existingIds.has(questionId) && !explicitDeletedIds.has(questionId)
            )
        );
        const usedExistingIds = new Set<string>();
        const incomingQuestionIds: string[] = [];

        // Pre-query all currently valid modules and subExams for this exam to ensure 100% FK safety
        const existingExamModules = await tx.examModule.findMany({
          where: { examId: id },
          select: { id: true }
        });
        const existingSubExams = await tx.subExam.findMany({
          where: { module: { examId: id } },
          select: { id: true }
        });

        const validModuleIdSet = new Set<string>([
          ...existingExamModules.map(m => m.id),
          ...(modulesProvided ? incomingModuleIds : [])
        ]);

        const validSubExamIdSet = new Set<string>([
          ...existingSubExams.map(s => s.id),
          ...(modulesProvided ? incomingSubExamIds : [])
        ]);

        // ✅ KEY FIX: Track which IDs the client explicitly sent in the payload
        // We only soft-delete questions the client KNEW about (had their ID) but chose to remove.
        // Questions sent without an ID are new — they never trigger deletions.
        for (let i = 0; i < sanitizedQuestions.length; i++) {
          const q = sanitizedQuestions[i];
          if (typeof q?.id === 'string' && explicitDeletedIds.has(q.id)) {
            console.warn(`[Exam Update] Deletion wins over conflicting question payload: ${q.id}`);
            continue;
          }
          const newExplanation = formatExplanation(q);

          const cleanModuleId = q.moduleId ? sanitizeHtml(q.moduleId) : null;
          const cleanSubExamId = q.subExamId ? sanitizeHtml(q.subExamId) : null;

          const qData = {
            text: extractAndSaveBase64Images(sanitizeHtml(q.text || '')),
            type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(q.type === 'QUESTION' && q.label ? q.label : q.type) ? sanitizeHtml(q.type === 'QUESTION' && q.label ? q.label : q.type) : 'MCQ',
            options: extractAndSaveBase64Images(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])),
            correctAnswer: formatCorrectAnswer(q),
            points: parseInt(q.points) || 1,
            xpPoints: parseInt(q.xpPoints) || 10,
            skill: q.skill !== undefined ? (q.skill ? sanitizeHtml(q.skill) : null) : undefined,
            learningOutcome: (q.standard !== undefined || q.learningOutcome !== undefined) ? ((q.standard || q.learningOutcome) ? sanitizeHtml(q.standard || q.learningOutcome) : null) : undefined,
            standard: (q.standard !== undefined || q.learningOutcome !== undefined) ? ((q.standard || q.learningOutcome) ? sanitizeHtml(q.standard || q.learningOutcome) : null) : undefined,
            indicator: q.indicator !== undefined ? (q.indicator ? sanitizeHtml(q.indicator) : null) : undefined,
            videoUrl: q.videoUrl !== undefined ? (q.videoUrl ? sanitizeHtml(q.videoUrl) : null) : undefined,
            level: q.level ? sanitizeHtml(q.level) : 'Medium',
            dok: q.dok !== undefined ? normalizeBackendDok(q.dok) : undefined,
            cognitive: q.cognitive !== undefined ? (q.cognitive ? sanitizeHtml(q.cognitive) : null) : undefined,
            course: q.course !== undefined ? (q.course ? sanitizeHtml(q.course) : null) : undefined,
            section: q.section !== undefined ? (q.section ? sanitizeHtml(q.section) : null) : undefined,
            domain: q.domain !== undefined ? (q.domain ? sanitizeHtml(q.domain) : null) : undefined,
            subskill: q.subskill !== undefined ? (q.subskill ? sanitizeHtml(q.subskill) : null) : undefined,
            microSkill: q.microSkill !== undefined ? (q.microSkill ? sanitizeHtml(q.microSkill) : null) : undefined,
            gradeTarget: q.gradeTarget !== undefined ? (q.gradeTarget ? sanitizeHtml(q.gradeTarget) : null) : undefined,
            errorPattern: q.errorPattern !== undefined ? (q.errorPattern ? sanitizeHtml(q.errorPattern) : null) : undefined,
            estimatedTime: q.estimatedTime !== undefined ? (q.estimatedTime ? sanitizeHtml(q.estimatedTime) : null) : undefined,
            explanation: newExplanation,
            imageUrl: q.imageUrl ? extractAndSaveBase64Images(sanitizeHtml(q.imageUrl)) : null,
            // ✅ FK-SAFE: strictly ensure moduleId and subExamId exist in validModuleIdSet / validSubExamIdSet.
            // If stale ID, deleted module, or autosave race without modules payload, set to null to avoid P2003.
            moduleId: cleanModuleId && validModuleIdSet.has(cleanModuleId) ? cleanModuleId : null,
            subExamId: cleanSubExamId && validSubExamIdSet.has(cleanSubExamId) ? cleanSubExamId : null,
            order: i
          };

          const incomingFingerprint = buildQuestionFingerprint(qData);
          let targetQuestionId = typeof q.id === 'string' && existingIds.has(q.id) ? q.id : undefined;

          // POST/PUT autosave responses can be interrupted before the editor receives
          // database IDs. Reconcile an identical ID-less row instead of inserting it again.
          if (!targetQuestionId) {
            targetQuestionId = pickReconciliationCandidate(
              existingCandidates.filter((candidate) => !explicitDeletedIds.has(candidate.id)),
              i,
              incomingFingerprint,
              reservedIncomingIds,
              usedExistingIds,
              existingExam._count.submissions === 0
            )?.id;
          }

          if (targetQuestionId && usedExistingIds.has(targetQuestionId)) {
            console.warn(`[Exam Update] Ignoring duplicate question ID in payload: ${targetQuestionId}`);
            continue;
          }

          if (targetQuestionId) {
            // Update existing question to preserve StudentAnswers
            const updatePayload: any = { ...qData };
            // ✅ ROOT CAUSE FIX: If the new explanation is null (frontend sent empty/[])
            // AND the DB has an existing non-null explanation → preserve it.
            // Only overwrite explanation if the incoming payload has real content.
            if (updatePayload.explanation === null) {
              const preservedExplanation = existingExplanationMap.get(targetQuestionId);
              if (preservedExplanation) {
                // Keep the existing explanation — don't wipe it
                delete updatePayload.explanation;
              }
            }
            await tx.question.update({
              where: { id: targetQuestionId },
              data: updatePayload
            });
            usedExistingIds.add(targetQuestionId);
            incomingQuestionIds.push(targetQuestionId);
          } else {
            // Last-resort duplicate guard: before creating a new question, check if an
            // existing un-used question already has the same normalized text. This handles
            // the race where two concurrent autosaves each sent the same ID-less question
            // before the DB id was reconciled back to the frontend.
            const incomingTextNorm = String(qData.text || '').replace(/<[^>]+>/g, '').trim().toLowerCase();
            const textDuplicateId = incomingTextNorm
              ? existingQuestionsWithExp.find(
                (eq) =>
                  !usedExistingIds.has(eq.id) &&
                  !explicitDeletedIds.has(eq.id) &&
                  String(eq.text || '').replace(/<[^>]+>/g, '').trim().toLowerCase() === incomingTextNorm,
              )?.id
              : undefined;

            if (textDuplicateId) {
              console.warn(`[Exam Update] Prevented duplicate question creation – updating existing row instead: ${textDuplicateId}`);
              await tx.question.update({
                where: { id: textDuplicateId },
                data: qData,
              });
              usedExistingIds.add(textDuplicateId);
              incomingQuestionIds.push(textDuplicateId);
            } else {
              // Create new question (no ID = brand new question)
              const createdQuestion = await tx.question.create({
                data: { ...qData, examId: id }
              });
              usedExistingIds.add(createdQuestion.id);
              incomingQuestionIds.push(createdQuestion.id);
            }
          }
        }

        // SAFE Soft-delete: only remove questions explicitly deleted by the editor UI.
        // Never infer deletes from a missing question in the payload; that can happen when
        // frontend IDs are lost, and would hide existing StudentAnswers in reports.
        // ONLY Super Admin is allowed to delete questions!
        const isSuperAdmin = (req as any).user?.role === 'SUPER_ADMIN';
        if (isSuperAdmin) {
          for (const existingId of Array.from(explicitDeletedIds)) {
            await tx.question.update({
              where: { id: existingId },
              data: { deletedAt: new Date() }
            });
          }
        }

        // A partial autosave must not delete unseen rows. Keep those rows and append
        // them deterministically after the sequence sent by the editor, then persist
        // unique contiguous order values so every reader sees the same order.
        const activeQuestions = await tx.question.findMany({
          where: { examId: id, deletedAt: null },
          select: { id: true, order: true, createdAt: true }
        });
        const retainedIncomingQuestionIds = incomingQuestionIds.filter((questionId) => !explicitDeletedIds.has(questionId));
        const incomingIdSet = new Set(retainedIncomingQuestionIds);
        const orderedQuestionIds = [
          ...retainedIncomingQuestionIds,
          ...sortPersistedOrder(activeQuestions)
            .filter((question) => !incomingIdSet.has(question.id))
            .map((question) => question.id)
        ];
        for (let order = 0; order < orderedQuestionIds.length; order++) {
          await tx.question.update({
            where: { id: orderedQuestionIds[order] },
            data: { order }
          });
        }
      }

      // Return the updated questions with their IDs so the frontend can sync
      return tx.exam.findUnique({
        where: { id },
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
    }, { maxWait: 15000, timeout: 120000 });

    res.json({ message: 'Exam updated successfully', exam, modules: exam?.modules, questions: exam?.questions });
  } catch (error: any) {
    console.error('❌ Exam update error:', error); require('fs').writeFileSync('error_log.txt', String(error) + '\n' + error.stack);
    res.status(500).json({ error: 'Error updating exam', details: error.message });
  }
};


export const deleteExamHandler6 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const exam = await prisma.exam.findUnique({
      where: { id },
      include: { schools: { select: { id: true } } }
    });

    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    // Authorization check
    if ((req as any).user.role === 'SCHOOL_ADMIN' && exam.schoolId !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied: You can only delete exams belonging to your school.' });
    }

    await prisma.exam.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ error: 'Error deleting exam' });
  }
};


export const postExamHandler7 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    if ((req as any).user.role === 'SCHOOL_ADMIN' && exam.schoolId !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied: You can only restore exams belonging to your school.' });
    }

    await prisma.exam.update({
      where: { id },
      data: { deletedAt: null }
    });

    res.json({ message: 'Exam restored successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error restoring exam' });
  }
};


export const postExamHandler8 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const question = await prisma.question.findUnique({
      where: { id },
      include: { exam: { select: { schoolId: true } } }
    });
    if (!question) return res.status(404).json({ error: 'Question not found' });

    if ((req as any).user.role === 'SCHOOL_ADMIN' && question.exam?.schoolId !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied: You can only restore questions belonging to your school.' });
    }

    await prisma.question.update({
      where: { id },
      data: { deletedAt: null }
    });

    res.json({ message: 'Question restored successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error restoring question' });
  }
};


export const getExamHandler9 = async (req: Request, res: Response) => {
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
    if (!await canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const where: any = { examId: id };
    if ((req as any).user.role === 'SCHOOL_ADMIN' || (req as any).user.role === 'TEACHER') {
      where.user = { schoolId: (req as any).user.schoolId };
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
    const schoolStats: any[] = [];
    if ((req as any).user.role === 'SUPER_ADMIN') {
      const schoolsMap: any = {};
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
};


export const getExamHandler10 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : null;
    const queryStartTime = Date.now();
    const exam = await prisma.exam.findUnique({
      where: { id, deletedAt: null },
      include: {
        schools: { select: { id: true, name: true } },
        modules: { orderBy: { order: 'asc' }, include: { subExams: { orderBy: { order: 'asc' }, include: { _count: { select: { questions: { where: { deletedAt: null } } } } } } } },
        questions: {
          where: subExamId ? { subExamId, deletedAt: null } : { deletedAt: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
        }
      }
    });
    const queryDuration = Date.now() - queryStartTime;
    if (queryDuration > 1000) {
      console.log(`[Exam GET] Exam "${exam?.title || id}" query took ${queryDuration}ms (${exam?.questions?.length || 0} questions)`);
    }

    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    const role = (req as any).user.role;
    const userId = (req as any).user.id;
    const userSchoolId = (req as any).user.schoolId;

    const isPrivilegedRole = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR', 'STUDENT'].includes(role);
    if (!isPrivilegedRole) {
      return res.status(403).json({ error: 'Access denied (Role: ' + role + ')' });
    }

    if (role === 'STUDENT') {
      const accessUser = mergeStudentProfile((req as any).user, await prisma.user.findUnique({ where: { id: userId }, select: { grade: true, schoolId: true } }));
      if (!examMatchesStudent(exam, accessUser)) {
        return res.status(403).json({ error: 'Access denied (Student)' });
      }
    } else if (['SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR'].includes(role)) {
      const canAccessExam = await canManageExam((req as any).user, exam);
      if (!canAccessExam) {
        return res.status(403).json({ error: 'Access denied (Role: ' + role + ', isCentral: ' + exam.isCentral + ')' });
      }
    }

    const selectedSubExam = subExamId
      ? exam.modules.flatMap((module: any) => module.subExams || []).find((subExam: any) => subExam.id === subExamId)
      : null;
    if (subExamId && !selectedSubExam) return res.status(404).json({ error: 'Exam section not found' });

    let parsedQuestions = exam.questions.map(q => {
      let options = [];
      try {
        options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
      } catch (e) {
        options = [];
      }
      return { ...q, options };
    });

    // If student, hide correct answers
    const activePassword = resolveExamAccessPassword(exam, selectedSubExam);

    if ((req as any).user.role === 'STUDENT') {
      const sanitizedQuestions = parsedQuestions.map(q => {
        const { correctAnswer, explanation, ...rest } = q;
        return rest;
      });
      return res.json({ ...sanitizeExam(exam), selectedSubExam, password: activePassword ? true : null, questions: sanitizedQuestions });
    }

    res.json({ ...sanitizeExam(exam), selectedSubExam, password: activePassword, questions: parsedQuestions });
  } catch (error) {
    logExamRequestError('detail', req, error);
    res.status(500).json({ error: 'Error fetching exam details' });
  }
};


export const postExamHandler11 = async (req: any, res: any) => {
  try {
    const { id: examId } = req.params;
    const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : (req.body?.subExamId || null);
    const { password } = req.body;
    const userId = (req as any).user.id;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        schools: { select: { id: true } },
        modules: { include: { subExams: true } },
        _count: {
          select: { submissions: { where: { userId } } }
        }
      }
    });

    if (!exam) return res.status(404).json({ error: 'الامتحان غير موجود' });
    const selectedSubExam = subExamId
      ? exam.modules.flatMap((module: any) => module.subExams || []).find((subExam: any) => subExam.id === subExamId)
      : null;
    if (subExamId && !selectedSubExam) return res.status(404).json({ error: 'الاختبار غير موجود داخل هذا الموديول.' });
    const accessUser = (req as any).user.role === 'STUDENT'
      ? mergeStudentProfile((req as any).user, await prisma.user.findUnique({ where: { id: (req as any).user.id }, select: { grade: true, schoolId: true } }))
      : (req as any).user;
    if ((req as any).user.role === 'STUDENT' && !examMatchesStudent(exam, accessUser)) {
      return res.status(403).json({ error: 'This exam is not assigned to you.', type: 'ACCESS_DENIED' });
    }

    // 1. Check Dates (skip for admins and teachers testing)
    const isAdminOrTeacher = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR'].includes((req as any).user.role);
    const now = new Date();
    if (!isAdminOrTeacher && exam.startDate && now < new Date(exam.startDate)) {
      return res.status(403).json({ error: 'The exam has not started yet.', type: 'EARLY_ACCESS' });
    }
    if (!isAdminOrTeacher && exam.endDate && now > new Date(exam.endDate)) {
      return res.status(403).json({ error: 'The exam has expired.', type: 'EXPIRED' });
    }
    if (!isAdminOrTeacher && selectedSubExam && getAvailability(selectedSubExam, now) !== 'AVAILABLE') {
      return res.status(403).json({ error: getAvailability(selectedSubExam, now) === 'UPCOMING' ? 'This exam has not started yet.' : 'This exam has expired.', type: getAvailability(selectedSubExam, now) });
    }

    // 2. Check Attempts (999 means unlimited)
    const submissionCount = await prisma.examSubmission.count({ where: { examId, userId, ...(subExamId ? { subExamId } : {}) } });
    const attemptsAllowed = selectedSubExam?.attemptsAllowed ?? exam.attemptsAllowed;
    if (!isAdminOrTeacher && attemptsAllowed !== 999 && submissionCount >= attemptsAllowed) {
      return res.status(403).json({ error: 'You have reached the maximum number of attempts allowed for this exam.', type: 'ATTEMPTS_EXCEEDED' });
    }

    // 3. Check Password
    const requiredPassword = resolveExamAccessPassword(exam, selectedSubExam);
    if (!isAdminOrTeacher && requiredPassword && requiredPassword !== password) {
      return res.status(403).json({ error: 'Incorrect password.', type: 'INVALID_PASSWORD' });
    }

    res.json({ success: true, message: 'Access verified successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Error verifying access.' });
  }
};


export const getExamHandler12 = async (req: any, res: any) => {
  try {
    const { id: examId } = req.params;
    const userId = (req as any).user.id;
    const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : null;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: { attemptsAllowed: true, modules: { select: { subExams: { where: subExamId ? { id: subExamId } : undefined, select: { attemptsAllowed: true } } } } }
    });

    const submissionCount = await prisma.examSubmission.count({
      where: { examId, userId, ...(subExamId ? { subExamId } : {}) }
    });

    const lastSubmission = await prisma.examSubmission.findFirst({
      where: { examId, userId, ...(subExamId ? { subExamId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    const selectedAttemptsAllowed = exam?.modules.flatMap((module: any) => module.subExams || [])[0]?.attemptsAllowed;
    res.json({
      taken: submissionCount > 0,
      submissionId: lastSubmission?.id,
      attemptsUsed: submissionCount,
      attemptsAllowed: selectedAttemptsAllowed ?? exam?.attemptsAllowed ?? 1,
      canTakeAgain: submissionCount < (selectedAttemptsAllowed ?? exam?.attemptsAllowed ?? 1)
    });
  } catch (error) {
    res.status(500).json({ error: 'Error checking exam status' });
  }
};


export const postExamHandler13 = async (req: Request, res: Response) => {
  const { id: examId } = req.params;
  const userId = (req as any).user.id;
  const { subExamId = null } = req.body || {};
  const lockKey = `submit_exam_${userId}_${examId}_${subExamId || 'root'}`;

  if (!acquireLock(lockKey)) {
    return res.status(429).json({ error: 'Submitting exam... please wait.' });
  }

  try {
    const { answers, totalTime, password } = req.body; // Array of { questionId, selectedAnswer }, totalTime in seconds
    if (!Array.isArray(answers)) {
      releaseLock(lockKey);
      return res.status(400).json({ error: 'answers array is required.' });
    }

    // Check attempts limit
    const submissionCount = await prisma.examSubmission.count({
      where: { examId, userId, ...(subExamId ? { subExamId } : {}) }
    });

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true, attemptsAllowed: true, isCentral: true, schoolId: true,
        startDate: true, endDate: true, resultVisibility: true, password: true,
        grade: true, grades: true,
        schools: { select: { id: true } },
        modules: { include: { subExams: true } },
        questions: {
          where: { deletedAt: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, points: true, correctAnswer: true, type: true, order: true, xpPoints: true, options: true, subExamId: true }
        }
      }
    });

    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    const selectedSubExam = subExamId
      ? exam.modules.flatMap((module: any) => module.subExams || []).find((subExam: any) => subExam.id === subExamId)
      : null;
    if (subExamId && !selectedSubExam) return res.status(404).json({ error: 'Exam section not found' });
    const accessUser = (req as any).user.role === 'STUDENT'
      ? mergeStudentProfile((req as any).user, await prisma.user.findUnique({ where: { id: (req as any).user.id }, select: { grade: true, schoolId: true } }))
      : (req as any).user;
    if ((req as any).user.role === 'STUDENT' && !examMatchesStudent(exam, accessUser)) {
      return res.status(403).json({ error: 'This exam is not assigned to you.' });
    }

    const isAdminOrTeacher = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'].includes((req as any).user.role);

    const attemptsAllowed = selectedSubExam?.attemptsAllowed ?? exam.attemptsAllowed;
    if (!isAdminOrTeacher && attemptsAllowed !== 999 && submissionCount >= attemptsAllowed) {
      return res.status(400).json({ error: 'You have reached the maximum number of attempts allowed for this exam.' });
    }

    // Check dates again on submission (skip for admins and teachers testing)
    const now = new Date();
    if (!isAdminOrTeacher && exam.startDate && now < new Date(exam.startDate)) {
      return res.status(403).json({ error: 'The exam has not started yet.' });
    }
    if (!isAdminOrTeacher && exam.endDate && now > new Date(exam.endDate)) {
      return res.status(403).json({ error: 'The exam has expired.' });
    }
    if (!isAdminOrTeacher && selectedSubExam && getAvailability(selectedSubExam, now) !== 'AVAILABLE') {
      return res.status(403).json({ error: getAvailability(selectedSubExam, now) === 'UPCOMING' ? 'This exam has not started yet.' : 'This exam has expired.' });
    }
    const requiredPassword = resolveExamAccessPassword(exam, selectedSubExam);
    if (requiredPassword && requiredPassword !== password) {
      return res.status(403).json({ error: 'Incorrect password.' });
    }
    exam.questions = subExamId ? exam.questions.filter((question: any) => question.subExamId === subExamId) : exam.questions;
    if (exam.questions.length === 0) {
      return res.status(400).json({ error: 'Cannot submit an exam without questions.' });
    }

    let totalScore = 0;
    let maxPossibleScore = 0;
    const studentAnswersData: any[] = [];

    exam.questions.forEach(q => {
      maxPossibleScore += q.points;
      const studentAnswer = answers.find((a: any) => a.questionId === q.id);
      const selectedAnswer = studentAnswer?.selectedAnswer;
      const isCorrect = isAnswerCorrect(q, selectedAnswer);

      if (isCorrect) totalScore += q.points;

      studentAnswersData.push({
        userId,
        questionId: q.id,
        selectedAnswer: Array.isArray(selectedAnswer) ? JSON.stringify(selectedAnswer) : (selectedAnswer || ''),
        isCorrect
      });
    });

    if (maxPossibleScore <= 0) {
      return res.status(400).json({ error: 'Cannot grade an exam without points.' });
    }
    const percentage = (totalScore / maxPossibleScore) * 100;

    // Gamification System calculation
    const isFirstExamAttempt = submissionCount === 0;
    let regularXP = 0;

    // Sort questions by order to ensure streak is computed in order
    const sortedQuestions = [...exam.questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    let hasStreak5 = false;
    let hasStreak10 = false;
    let tempStreak = 0;
    let maxStreak = 0;

    sortedQuestions.forEach(q => {
      const sa = studentAnswersData.find((a: any) => a.questionId === q.id);
      const isCorrect = sa?.isCorrect || false;
      if (isCorrect) {
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
        if (tempStreak === 5) hasStreak5 = true;
        if (tempStreak === 10) hasStreak10 = true;
        if (isFirstExamAttempt) {
          regularXP += q.xpPoints !== undefined ? Number(q.xpPoints) : 10;
        }
      } else {
        tempStreak = 0;
      }
    });

    const bonusXP = isFirstExamAttempt ? ((hasStreak5 ? 10 : 0) + (hasStreak10 ? 30 : 0)) : 0;
    const totalXPToAward = regularXP + bonusXP;

    const submission = await prisma.examSubmission.create({
      data: {
        examId,
        subExamId,
        userId,
        totalScore,
        percentage,
        totalTime: totalTime || 0,
        answers: {
          create: studentAnswersData.map(a => ({
            userId,
            questionId: a.questionId,
            selectedAnswer: a.selectedAnswer,
            isCorrect: a.isCorrect
          }))
        }
      },
      include: {
        answers: {
          include: {
            question: true
          }
        }
      }
    });

    // Save XPHistory log entries in bulk
    const xpHistoryData = exam.questions.map(q => {
      const sa = studentAnswersData.find((a: any) => a.questionId === q.id);
      const isCorrect = sa?.isCorrect || false;
      const earnedXP = (isFirstExamAttempt && isCorrect) ? (q.xpPoints !== undefined ? Number(q.xpPoints) : 10) : 0;
      return {
        userId,
        xp: earnedXP,
        sourceType: 'EXAM',
        sourceId: examId,
        questionId: q.id,
        isCorrect,
        attemptNum: submissionCount + 1,
        isBonus: false
      };
    });

    if (xpHistoryData.length > 0) {
      await prisma.xPHistory.createMany({
        data: xpHistoryData
      });
    }

    // Save streak bonuses
    if (isFirstExamAttempt) {
      if (hasStreak5) {
        await prisma.xPHistory.create({
          data: {
            userId,
            xp: 10,
            sourceType: 'EXAM',
            sourceId: examId,
            questionId: 'streak_5',
            isCorrect: true,
            attemptNum: 1,
            isBonus: true
          }
        });
      }
      if (hasStreak10) {
        await prisma.xPHistory.create({
          data: {
            userId,
            xp: 30,
            sourceType: 'EXAM',
            sourceId: examId,
            questionId: 'streak_10',
            isCorrect: true,
            attemptNum: 1,
            isBonus: true
          }
        });
      }

      if (totalXPToAward > 0) {
        await prisma.user.update({
          where: { id: userId },
          data: { xp: { increment: totalXPToAward } }
        });
      }
    }

    // Invalidate student stats cache
    statsCache.delete(`student_stats_${userId}`);

    res.json({
      message: 'Exam submitted successfully',
      submissionId: submission.id,
      score: totalScore,
      percentage: percentage,
      earnedXP: regularXP,
      bonusXP,
      currentStreak: isFirstExamAttempt ? maxStreak : 0,
      resultVisibility: exam.resultVisibility,
      details: (exam.resultVisibility === 'SHOW_ANSWERS' || exam.resultVisibility === 'SHOW_ALL') ? submission.answers : null
    });
  } catch (error: any) {
    console.error('❌ Submission error:', error);
    res.status(500).json({ error: 'Error submitting exam', details: error.message });
  } finally {
    releaseLock(lockKey);
  }
};


export const getExamHandler14 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const submission = await prisma.examSubmission.findUnique({
      where: { id },
      include: {
        exam: {
          include: {
            questions: {
              where: { deletedAt: null },
              orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
            }
          }
        },
        user: { select: { name: true, role: true, schoolId: true } },
        answers: {
          where: { question: { deletedAt: null } },
          include: { question: true }
        }
      }
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    let subExamDetails = null;
    if (submission.subExamId) {
      subExamDetails = await prisma.subExam.findUnique({
        where: { id: submission.subExamId }
      });
    }

    // Authorization check
    const role = (req as any).user.role;
    if (!['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR', 'STUDENT'].includes(role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'STUDENT' && submission.userId !== (req as any).user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'SCHOOL_ADMIN' && submission.user.schoolId !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if ((role === 'TEACHER' || role === 'SUPERVISOR') && submission.user.schoolId !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const buildSubmissionXpStats = async (targetSubmission: any, targetAnswers: any[]) => {
      const answerQuestionIds = targetAnswers.map((answer: any) => answer.questionId);
      const relevantQuestions = targetSubmission.exam.questions.filter((question: any) => {
        if (targetSubmission.subExamId) {
          return question.subExamId === targetSubmission.subExamId && answerQuestionIds.includes(question.id);
        }
        return answerQuestionIds.includes(question.id);
      });

      const previousAttemptsCount = await prisma.examSubmission.count({
        where: {
          userId: targetSubmission.userId,
          examId: targetSubmission.examId,
          subExamId: targetSubmission.subExamId || null,
          createdAt: { lt: targetSubmission.createdAt }
        }
      });
      const isFirstAttemptForThisSubmission = previousAttemptsCount === 0;

      const orderedAnswers = [...targetAnswers].sort((a: any, b: any) => {
        const aOrder = relevantQuestions.find((question: any) => question.id === a.questionId)?.order ?? 0;
        const bOrder = relevantQuestions.find((question: any) => question.id === b.questionId)?.order ?? 0;
        return aOrder - bOrder;
      });

      let regularXP = 0;
      let dynamicTotalScore = 0;
      let streakCounter = 0;
      let hasStreak5 = false;
      let hasStreak10 = false;

      orderedAnswers.forEach((answer: any) => {
        const answerQuestion = relevantQuestions.find((question: any) => question.id === answer.questionId);
        if (!answerQuestion) return;

        if (answer.isCorrect) {
          streakCounter++;
          dynamicTotalScore += Number(answerQuestion.points) || 0;
          if (streakCounter === 5) hasStreak5 = true;
          if (streakCounter === 10) hasStreak10 = true;
          if (isFirstAttemptForThisSubmission) {
            regularXP += answerQuestion.xpPoints !== undefined ? Number(answerQuestion.xpPoints) : 10;
          }
        } else {
          streakCounter = 0;
        }
      });

      const bonusXP = isFirstAttemptForThisSubmission ? ((hasStreak5 ? 10 : 0) + (hasStreak10 ? 30 : 0)) : 0;

      return {
        earnedXP: regularXP + bonusXP,
        dynamicTotalScore,
        totalPoints: relevantQuestions.reduce((acc: number, question: any) => acc + (Number(question.points) || 0), 0),
        correctAnswers: orderedAnswers.filter((answer: any) => answer.isCorrect).length,
        totalQuestions: relevantQuestions.length,
      };
    };

    // Apply Result Policy for Students
    if ((req as any).user.role === 'STUDENT') {
      const policy = submission.exam.resultVisibility;

      if (policy === 'HIDE_ALL') {
        return res.json({
          id: submission.id,
          createdAt: submission.createdAt,
          exam: { title: subExamDetails?.title || submission.exam.title, skill: submission.exam.skill, level: submission.exam.level },
          subExam: subExamDetails,
          message: 'Results will be revealed later',
          policy: 'HIDE_ALL'
        });
      }

      const sanitizedAnswers = submission.answers.map(ans => {
        let options = [];
        try {
          options = typeof ans.question.options === 'string' ? JSON.parse(ans.question.options) : ans.question.options;
        } catch (e) {
          options = [];
        }

        const baseAnswer = {
          id: ans.id,
          selectedAnswer: ans.selectedAnswer,
          isCorrect: ans.isCorrect,
          question: {
            text: ans.question.text,
            options,
            points: ans.question.points,
            explanation: (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') ? ans.question.explanation : null
          }
        };

        if (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') {
          return { ...baseAnswer, question: { ...baseAnswer.question, correctAnswer: ans.question.correctAnswer } };
        }

        if (policy === 'SHOW_MARK_ONLY') {
          return baseAnswer;
        }

        return { id: ans.id }; // For SHOW_SCORE, we don't return answers
      });

      const submissionXpStats = await buildSubmissionXpStats(submission, submission.answers);
      const safeExam = { ...submission.exam } as any;
      safeExam.totalPoints = submissionXpStats.totalPoints;

      if (subExamDetails) {
        safeExam.title = subExamDetails.title || safeExam.title;
        safeExam.passingScore = resolvePassingScore(safeExam.passingScore, subExamDetails.passingScore);
        safeExam.duration = subExamDetails.duration;
      }

      delete safeExam.questions;

      const dynamicPercentage = submissionXpStats.totalPoints > 0 ? (submissionXpStats.dynamicTotalScore / submissionXpStats.totalPoints) * 100 : 0;

      return res.json({
        ...submission,
        totalScore: submissionXpStats.dynamicTotalScore,
        percentage: dynamicPercentage,
        exam: safeExam,
        subExam: subExamDetails,
        answers: policy === 'SHOW_SCORE' ? [] : sanitizedAnswers,
        earnedXP: submissionXpStats.earnedXP,
        correctAnswers: submissionXpStats.correctAnswers,
        totalQuestions: submissionXpStats.totalQuestions,
      });
    }

    // Admins see everything
    const parsedAnswers = submission.answers.map(ans => {
      let options = [];
      try {
        options = typeof ans.question.options === 'string' ? JSON.parse(ans.question.options) : ans.question.options;
      } catch (e) {
        options = [];
      }
      return { ...ans, question: { ...ans.question, options } };
    });

    const submissionXpStats = await buildSubmissionXpStats(submission, submission.answers);

    if (subExamDetails) {
      (submission as any).exam.title = subExamDetails.title || (submission as any).exam.title;
      (submission as any).exam.passingScore = resolvePassingScore(
        (submission as any).exam.passingScore,
        subExamDetails.passingScore,
      );
      (submission as any).exam.duration = subExamDetails.duration;
    }
    (submission as any).exam.totalPoints = submissionXpStats.totalPoints;

    const dynamicPercentage = submissionXpStats.totalPoints > 0 ? (submissionXpStats.dynamicTotalScore / submissionXpStats.totalPoints) * 100 : 0;

    res.json({
      ...submission,
      subExam: subExamDetails,
      totalScore: submissionXpStats.dynamicTotalScore,
      percentage: dynamicPercentage,
      answers: parsedAnswers,
      earnedXP: submissionXpStats.earnedXP,
      correctAnswers: submissionXpStats.correctAnswers,
      totalQuestions: submissionXpStats.totalQuestions,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching submission' });
  }
};


export const getExamHandler15 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const exam = await prisma.exam.findUnique({
      where: { id },
      include: { schools: { select: { id: true } } }
    });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (!await canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const where: any = { examId: id };
    if ((req as any).user.role === 'SCHOOL_ADMIN' || (req as any).user.role === 'TEACHER') {
      where.user = { schoolId: (req as any).user.schoolId };
    }

    const submissions = await prisma.examSubmission.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            username: true,
            schoolId: true,
            school: { select: { name: true } }
          }
        },
        exam: { select: { title: true, type: true, passingScore: true } },
        answers: { select: { isCorrect: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    res.json(submissions.map(({ answers, ...submission }) => ({
      ...submission,
      correctAnswers: answers.filter((answer) => answer.isCorrect).length,
      totalQuestions: answers.length,
    })));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching submissions' });
  }
};


export const postExamHandler16 = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const exam = await prisma.exam.update({
      where: { id },
      data: { deletedAt: null }
    });
    res.json({ message: 'Exam restored successfully', exam });
  } catch (error) {
    console.error('❌ Restore exam error:', error);
    res.status(500).json({ error: 'Error restoring exam' });
  }
};


export const postExamHandler17 = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const question = await prisma.question.update({
      where: { id },
      data: { deletedAt: null }
    });
    res.json({ message: 'Question restored successfully', question });
  } catch (error) {
    console.error('❌ Restore question error:', error);
    res.status(500).json({ error: 'Error restoring question' });
  }
};


export const postExamHandler18 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, order, duration, passingScore } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    const exam = await prisma.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    if (!await canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
    }

    const module = await prisma.examModule.create({
      data: {
        examId: id,
        title,
        description,
        order: order || 0,
        duration: duration ? parseInt(duration) : null,
        passingScore: passingScore ? parseInt(passingScore) : null
      }
    });
    res.status(201).json(module);
  } catch (error: any) {
    console.error('Error creating exam module:', error);
    res.status(500).json({ error: 'Failed to create exam module' });
  }
};


export const putExamHandler19 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const { title, description, order, duration, passingScore, gradeTarget } = req.body;

    const exam = await prisma.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    if (!await canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
    }

    const module = await prisma.examModule.update({
      where: { id: moduleId },
      data: {
        title: title !== undefined ? title : undefined,
        description: description !== undefined ? description : undefined,
        order: order !== undefined ? parseInt(order) : undefined,
        duration: duration !== undefined ? (duration ? parseInt(duration) : null) : undefined,
        passingScore: passingScore !== undefined ? (passingScore ? parseInt(passingScore) : null) : undefined,
        gradeTarget: gradeTarget !== undefined ? (gradeTarget ? sanitizeHtml(gradeTarget) : null) : undefined,
      }
    });
    res.json(module);
  } catch (error: any) {
    console.error('Error updating exam module:', error);
    res.status(500).json({ error: 'Failed to update exam module' });
  }
};


export const deleteExamHandler20 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;

    if ((req as any).user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied: Only Super Admin can delete modules.' });
    }

    const exam = await prisma.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    if (!await canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
    }

    const module = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true }
    });
    if (!module) return res.status(404).json({ error: 'Exam module not found' });

    await prisma.$transaction(async (tx) => {
      const subExamIds = (
        await tx.subExam.findMany({
          where: { moduleId },
          select: { id: true }
        })
      ).map((subExam) => subExam.id);

      // Clear question links first so module/sub-exam deletion never hits FK constraints.
      await tx.question.updateMany({
        where: {
          examId: id,
          OR: [
            { moduleId },
            ...(subExamIds.length > 0 ? [{ subExamId: { in: subExamIds } }] : [])
          ]
        },
        data: {
          moduleId: null,
          subExamId: null
        }
      });

      if (subExamIds.length > 0) {
        await tx.subExam.deleteMany({
          where: { id: { in: subExamIds } }
        });
      }

      await tx.examModule.delete({ where: { id: moduleId } });
      const remainingModules = await tx.examModule.count({ where: { examId: id } });
      if (remainingModules === 0) {
        await tx.exam.update({ where: { id }, data: { deletedAt: new Date() } });
      }
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting exam module:', error);
    res.status(500).json({ error: 'Failed to delete exam module' });
  }
};

export const postExamHandler28 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const { title, password, duration, passingScore, attemptsAllowed, publishDate, cutOffDate } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Exam title is required' });

    const module = await prisma.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
    if (!module) return res.status(404).json({ error: 'Exam module not found' });

    const subExam = await prisma.subExam.create({
      data: {
        moduleId,
        title: sanitizeHtml(String(title).trim()),
        password: password ? sanitizeHtml(String(password).trim()) : null,
        duration: duration ? parseInt(duration) : null,
        passingScore: passingScore ? parseInt(passingScore) : null,
        attemptsAllowed: attemptsAllowed ? parseInt(attemptsAllowed) || 1 : 1,
        order: await prisma.subExam.count({ where: { moduleId } }),
        publishDate: publishDate ? new Date(publishDate) : null,
        cutOffDate: cutOffDate ? new Date(cutOffDate) : null,
      }
    });
    res.status(201).json(subExam);
  } catch (error) {
    console.error('Error creating child exam:', error);
    res.status(500).json({ error: 'Failed to create exam inside module' });
  }
};

export const postExamHandler33 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId, subExamId } = req.params;
    const includeStandalone = req.body?.includeStandalone === true;
    const includeModuleQuestions = req.body?.includeModuleQuestions !== false;
    const module = await prisma.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
    if (!module) return res.status(404).json({ error: 'Exam module not found' });

    const subExam = await prisma.subExam.findFirst({ where: { id: subExamId, moduleId }, select: { id: true } });
    if (!subExam) return res.status(404).json({ error: 'Exam not found inside module' });

    const sourceFilters: any[] = [];
    if (includeModuleQuestions) sourceFilters.push({ moduleId, subExamId: null });
    if (includeStandalone) sourceFilters.push({ moduleId: null });

    const sourceQuestions = await prisma.question.findMany({
      where: {
        examId: id,
        deletedAt: null,
        OR: sourceFilters,
      },
      select: { id: true },
    });

    if (sourceQuestions.length > 0) {
      await prisma.question.updateMany({
        where: { id: { in: sourceQuestions.map((question) => question.id) } },
        data: { moduleId, subExamId },
      });
    }

    res.json({ movedQuestionIds: sourceQuestions.map((question) => question.id) });
  } catch (error) {
    console.error('Error collecting module questions into exam:', error);
    res.status(500).json({ error: 'Failed to collect questions into exam' });
  }
};

export const putExamHandler29 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId, subExamId } = req.params;
    const parent = await prisma.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
    if (!parent) return res.status(404).json({ error: 'Exam module not found' });
    const data: any = {};
    if (req.body.title !== undefined) data.title = sanitizeHtml(String(req.body.title).trim());
    if (req.body.password !== undefined) data.password = req.body.password ? sanitizeHtml(String(req.body.password).trim()) : null;
    if (req.body.duration !== undefined) data.duration = req.body.duration ? parseInt(req.body.duration) : null;
    if (req.body.passingScore !== undefined) data.passingScore = req.body.passingScore ? parseInt(req.body.passingScore) : null;
    if (req.body.attemptsAllowed !== undefined) data.attemptsAllowed = parseInt(req.body.attemptsAllowed) || 1;
    if (req.body.publishDate !== undefined) data.publishDate = req.body.publishDate ? new Date(req.body.publishDate) : null;
    if (req.body.cutOffDate !== undefined) data.cutOffDate = req.body.cutOffDate ? new Date(req.body.cutOffDate) : null;
    const subExam = await prisma.subExam.updateMany({ where: { id: subExamId, moduleId }, data });
    if (!subExam.count) return res.status(404).json({ error: 'Exam not found inside module' });
    res.json(await prisma.subExam.findUnique({ where: { id: subExamId } }));
  } catch (error) {
    console.error('Error updating child exam:', error);
    res.status(500).json({ error: 'Failed to update exam inside module' });
  }
};

export const deleteExamHandler30 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId, subExamId } = req.params;

    if ((req as any).user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied: Only Super Admin can delete exams.' });
    }

    const parent = await prisma.examModule.findFirst({ where: { id: moduleId, examId: id }, select: { id: true } });
    if (!parent) return res.status(404).json({ error: 'Exam module not found' });

    await prisma.$transaction(async (tx) => {
      await tx.question.updateMany({
        where: { examId: id, subExamId },
        data: { subExamId: null },
      });

      await tx.subExam.delete({
        where: { id: subExamId },
      });
    });

    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    console.error('Error deleting child exam:', error);
    res.status(500).json({ error: 'Failed to delete exam inside module' });
  }
};

export const getExamHandler31 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId, subExamId } = req.params;

    const parent = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true, title: true, examId: true }
    });
    if (!parent) return res.status(404).json({ error: 'Exam module not found' });

    const subExam = await prisma.subExam.findFirst({
      where: { id: subExamId, moduleId },
      include: {
        questions: {
          where: { deletedAt: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
        }
      }
    });
    if (!subExam) return res.status(404).json({ error: 'Exam not found inside module' });

    const payload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      module: {
        id: parent.id,
        title: parent.title,
      },
      exam: {
        title: subExam.title,
        password: subExam.password,
        duration: subExam.duration,
        passingScore: subExam.passingScore,
        attemptsAllowed: subExam.attemptsAllowed,
        publishDate: subExam.publishDate ? subExam.publishDate.toISOString() : null,
        cutOffDate: subExam.cutOffDate ? subExam.cutOffDate.toISOString() : null,
      },
      questions: subExam.questions.map((question: any) => ({
        text: question.text,
        type: question.type,
        options: question.options,
        correctAnswer: question.correctAnswer,
        points: question.points,
        xpPoints: question.xpPoints,
        skill: question.skill,
        learningOutcome: question.standard || question.learningOutcome || null,
        indicator: question.indicator,
        videoUrl: question.videoUrl,
        level: question.level,
        dok: normalizeBackendDok(question.dok),
        cognitive: question.cognitive,
        course: question.course,
        section: question.section,
        domain: question.domain,
        standard: question.standard || question.learningOutcome || null,
        subskill: question.subskill,
        microSkill: question.microSkill,
        gradeTarget: question.gradeTarget,
        errorPattern: question.errorPattern,
        estimatedTime: question.estimatedTime,
        explanation: question.explanation,
        imageUrl: question.imageUrl,
        order: question.order,
      })),
    };

    const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    const fileName = `${String(subExam.title || 'exam').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'exam'}_backup.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting module exam JSON:', error);
    res.status(500).json({ error: 'Failed to export exam JSON' });
  }
};

export const postExamHandler32 = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const rawPayload = req.body?.exportData;
    const parsedPayload = typeof rawPayload === 'string'
      ? JSON.parse(rawPayload)
      : rawPayload;

    if (!parsedPayload?.exam?.title) {
      return res.status(400).json({ error: 'Invalid exam JSON payload' });
    }

    const parent = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true }
    });
    if (!parent) return res.status(404).json({ error: 'Exam module not found' });

    const questions = Array.isArray(parsedPayload.questions) ? parsedPayload.questions : [];
    const createdSubExam = await prisma.$transaction(async (tx) => {
      const created = await tx.subExam.create({
        data: {
          moduleId,
          title: sanitizeHtml(String(parsedPayload.exam.title).trim()),
          password: parsedPayload.exam.password ? sanitizeHtml(String(parsedPayload.exam.password).trim()) : null,
          duration: parsedPayload.exam.duration ? parseInt(parsedPayload.exam.duration) : null,
          passingScore: parsedPayload.exam.passingScore ? parseInt(parsedPayload.exam.passingScore) : null,
          attemptsAllowed: parsedPayload.exam.attemptsAllowed ? parseInt(parsedPayload.exam.attemptsAllowed) || 1 : 1,
          order: await tx.subExam.count({ where: { moduleId } }),
          publishDate: parsedPayload.exam.publishDate ? new Date(parsedPayload.exam.publishDate) : null,
          cutOffDate: parsedPayload.exam.cutOffDate ? new Date(parsedPayload.exam.cutOffDate) : null,
        }
      });

      for (let index = 0; index < questions.length; index++) {
        const question = sanitizeDeep(questions[index] || {});
        await tx.question.create({
          data: {
            examId: id,
            moduleId,
            subExamId: created.id,
            text: extractAndSaveBase64Images(sanitizeHtml(question.text || '')),
            type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(question.type) ? sanitizeHtml(question.type) : 'MCQ',
            options: extractAndSaveBase64Images(typeof question.options === 'string' ? question.options : JSON.stringify(question.options || [])),
            correctAnswer: formatCorrectAnswer(question),
            points: parseInt(question.points) || 1,
            xpPoints: parseInt(question.xpPoints) || 10,
            skill: question.skill ? sanitizeHtml(question.skill) : null,
            learningOutcome: (question.standard || question.learningOutcome) ? sanitizeHtml(question.standard || question.learningOutcome) : null,
            indicator: question.indicator ? sanitizeHtml(question.indicator) : null,
            videoUrl: question.videoUrl ? sanitizeHtml(question.videoUrl) : null,
            level: question.level ? sanitizeHtml(question.level) : 'Medium',
            dok: normalizeBackendDok(question.dok),
            cognitive: question.cognitive ? sanitizeHtml(question.cognitive) : null,
            course: question.course ? sanitizeHtml(question.course) : null,
            section: question.section ? sanitizeHtml(question.section) : null,
            domain: question.domain ? sanitizeHtml(question.domain) : null,
            standard: (question.standard || question.learningOutcome) ? sanitizeHtml(question.standard || question.learningOutcome) : null,
            subskill: question.subskill ? sanitizeHtml(question.subskill) : null,
            microSkill: question.microSkill ? sanitizeHtml(question.microSkill) : null,
            gradeTarget: question.gradeTarget ? sanitizeHtml(question.gradeTarget) : null,
            errorPattern: question.errorPattern ? sanitizeHtml(question.errorPattern) : null,
            estimatedTime: question.estimatedTime ? sanitizeHtml(question.estimatedTime) : null,
            explanation: formatExplanation(question),
            imageUrl: question.imageUrl ? extractAndSaveBase64Images(sanitizeHtml(question.imageUrl)) : null,
            order: question.order !== undefined ? parseInt(question.order) : index,
          }
        });
      }

      return tx.subExam.findUnique({
        where: { id: created.id },
        include: {
          _count: { select: { questions: { where: { deletedAt: null } } } },
          questions: {
            where: { deletedAt: null },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
          }
        }
      });
    });

    res.status(201).json(createdSubExam);
  } catch (error) {
    console.error('Error importing module exam JSON:', error);
    res.status(500).json({ error: 'Failed to import exam JSON' });
  }
};


export const getExamHandler21 = async (req: Request, res: Response) => {
  try {
    const { isCentral, status, grade, search, courseId, folderId } = req.query;

    const where: any = { deletedAt: null };
    if (folderId) {
      where.folderId = folderId;
    }

    if ((req as any).user.role === 'SUPER_ADMIN') {
      if (isCentral === 'true') where.isCentral = true;
      if (isCentral === 'false') {
        where.isCentral = false;
        if (req.query.schoolId) where.schoolId = req.query.schoolId;
      }
    } else if ((req as any).user.role === 'SCHOOL_ADMIN') {
      where.OR = [
        { isCentral: true },
        { schoolId: (req as any).user.schoolId }
      ];
    } else if ((req as any).user.role === 'TEACHER') {
      where.OR = [
        { creatorId: (req as any).user.id }
      ];
    } else if ((req as any).user.role === 'STUDENT') {
      where.OR = [
        { isCentral: true },
        { schoolId: (req as any).user.schoolId }
      ];
      if (grade) {
        where.grade = grade;
      }
    }

    const folders = await prisma.examFolder.findMany({
      where,
      include: {
        exams: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(folders);
  } catch (error: any) {
    console.error('Error fetching exam folders:', error);
    res.status(500).json({ error: 'Failed to fetch exam folders' });
  }
};


export const postExamHandler22 = async (req: Request, res: Response) => {
  try {
    const { title, description, grade, subject, isCentral, schoolId } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const folder = await prisma.examFolder.create({
      data: {
        title,
        description,
        grade,
        subject,
        isCentral: (req as any).user.role === 'SUPER_ADMIN' ? !!isCentral : false,
        creatorId: (req as any).user.id,
        schoolId: (req as any).user.role === 'SCHOOL_ADMIN' ? (req as any).user.schoolId : (isCentral ? null : schoolId)
      }
    });

    res.json(folder);
  } catch (error: any) {
    console.error('Error creating exam folder:', error);
    res.status(500).json({ error: 'Failed to create exam folder' });
  }
};


export const putExamHandler23 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, grade, subject } = req.body;

    const existingFolder = await prisma.examFolder.findUnique({ where: { id }, select: { id: true, schoolId: true, isCentral: true, creatorId: true } });
    if (!existingFolder) return res.status(404).json({ error: 'Exam folder not found' });

    if ((req as any).user.role !== 'SUPER_ADMIN') {
      const isOwner =
        existingFolder.schoolId === (req as any).user.schoolId ||
        existingFolder.isCentral ||
        existingFolder.creatorId === (req as any).user.id;
      if (!isOwner) return res.status(403).json({ error: 'Access denied: You do not have permission to edit this folder.' });
    }

    const folder = await prisma.examFolder.update({
      where: { id },
      data: { title, description, grade, subject }
    });

    res.json(folder);
  } catch (error: any) {
    console.error('Error updating exam folder:', error);
    res.status(500).json({ error: 'Failed to update exam folder' });
  }
};


export const deleteExamHandler24 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingFolder = await prisma.examFolder.findUnique({ where: { id }, select: { id: true, schoolId: true, isCentral: true, creatorId: true } });
    if (!existingFolder) return res.status(404).json({ error: 'Exam folder not found' });

    if ((req as any).user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Access denied: Only Super Admin can delete exam folders.' });
    }

    await prisma.examFolder.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting exam folder:', error);
    res.status(500).json({ error: 'Failed to delete exam folder' });
  }
};


export const postExamHandler25 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetExamId, targetModuleId, targetSubExamId } = req.body;

    if (!targetExamId) {
      return res.status(400).json({ error: 'targetExamId is required' });
    }

    // 1. Get source exam
    const sourceExam = await prisma.exam.findUnique({
      where: { id },
      include: { schools: { select: { id: true } } }
    });

    if (!sourceExam) {
      return res.status(404).json({ error: 'Source exam not found' });
    }

    if (!await canManageExam((req as any).user, sourceExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move questions from this exam.' });
    }

    // 2. Get target exam
    const targetExam = await prisma.exam.findUnique({
      where: { id: targetExamId },
      include: { modules: { orderBy: { order: 'desc' }, take: 1 }, schools: { select: { id: true } } }
    });

    if (!targetExam) {
      return res.status(404).json({ error: 'Target exam not found' });
    }

    if (!await canManageExam((req as any).user, targetExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
    }

    const newOrder = targetExam.modules.length > 0 ? (targetExam.modules[0].order || 0) + 1 : 0;

    await prisma.$transaction(async (tx) => {
      let finalModuleId = targetModuleId;

      // If no specific module is provided, create a new one
      if (!finalModuleId) {
        // 3. Create a new module in target exam using source exam title
        const newModule = await tx.examModule.create({
          data: {
            examId: targetExam.id,
            title: sourceExam.title,
            order: newOrder,
            description: sourceExam.description
          }
        });
        finalModuleId = newModule.id;
      }

      // 4. Move all STANDALONE questions to the module/subexam in the target exam
      await tx.question.updateMany({
        where: {
          examId: id,
          moduleId: null
        },
        data: {
          examId: targetExam.id,
          moduleId: finalModuleId,
          ...(targetSubExamId !== undefined ? { subExamId: targetSubExamId } : {})
        }
      });
    });

    res.json({ message: 'Standalone questions moved successfully' });
  } catch (error) {
    console.error('Error moving standalone questions:', error);
    res.status(500).json({ error: 'Failed to move standalone questions' });
  }
};


export const postExamHandler26 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetExamId, targetModuleId, targetSubExamId } = req.body;

    if (!targetExamId) {
      return res.status(400).json({ error: 'targetExamId is required' });
    }

    // 1. Get source exam
    const sourceExam = await prisma.exam.findUnique({
      where: { id },
      include: { questions: { where: { deletedAt: null } }, schools: { select: { id: true } } }
    });

    if (!sourceExam) {
      return res.status(404).json({ error: 'Source exam not found' });
    }

    // Ownership check on SOURCE exam — prevent stealing/deleting another school's exam
    if (!await canManageExam((req as any).user, sourceExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move this exam.' });
    }

    // 2. Get target exam
    const targetExam = await prisma.exam.findUnique({
      where: { id: targetExamId },
      include: { modules: { orderBy: { order: 'desc' }, take: 1 }, schools: { select: { id: true } } }
    });

    if (!targetExam) {
      return res.status(404).json({ error: 'Target exam not found' });
    }

    if (!await canManageExam((req as any).user, targetExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to move content into this exam.' });
    }

    const newOrder = targetExam.modules.length > 0 ? (targetExam.modules[0].order || 0) + 1 : 0;

    await prisma.$transaction(async (tx) => {
      let finalModuleId = targetModuleId;

      // If no specific module is provided, create a new one
      if (!finalModuleId) {
        // 3. Create a new module in target exam
        const newModule = await tx.examModule.create({
          data: {
            examId: targetExam.id,
            title: sourceExam.title,
            order: newOrder,
            description: sourceExam.description
          }
        });
        finalModuleId = newModule.id;
      }

      // 4. Move all questions to the module/subexam in the target exam
      await tx.question.updateMany({
        where: { examId: id },
        data: {
          examId: targetExam.id,
          moduleId: finalModuleId,
          ...(targetSubExamId !== undefined ? { subExamId: targetSubExamId } : {})
        }
      });

      // 5. Soft Delete the old exam
      await tx.exam.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
    });

    res.json({ success: true, message: 'Exam content successfully moved to module.' });
  } catch (error: any) {
    console.error('Error moving exam to module:', error);
    res.status(500).json({ error: 'Failed to move exam to module' });
  }
};


export function formatCorrectAnswer(q: any): string {
  const ans = (Array.isArray(q.correctAnswers) && q.correctAnswers.length > 0)
    ? q.correctAnswers
    : (q.correctAnswer !== undefined && q.correctAnswer !== null && q.correctAnswer !== "" ? q.correctAnswer : q.correctAnswers);
  if (ans === null || ans === undefined) return "";
  if (typeof ans === 'string') return ans;
  if (Array.isArray(ans) || typeof ans === 'object') {
    return JSON.stringify(ans);
  }
  return String(ans);
}

export function formatExplanation(q: any): string | null {
  if (!q) return null;
  // 1. Check structured sections array — takes highest priority
  if (q.sections && Array.isArray(q.sections)) {
    const validSections = q.sections.filter((s: any) => s && (String(s.content || s.text || '').trim() !== ''));
    if (validSections.length > 0) {
      const sanitizedValid = validSections.map((s: any) => ({
        ...s,
        content: s.content ? sanitizeHtml(s.content) : s.content,
        text: s.text ? sanitizeHtml(s.text) : s.text,
      }));
      return extractAndSaveBase64Images(JSON.stringify(sanitizedValid));
    } else {
      // The user edited the question and provided an empty sections array (or all invalid).
      // This means they explicitly deleted the explanation.
      return null;
    }
  }
  // 2. Check explanation field
  if (q.explanation !== undefined && q.explanation !== null) {
    // 🔒 SECURITY FIX: Always sanitize HTML regardless of input type.
    // Convert non-strings to string safely before sanitizing.
    const rawExplanation: string =
      typeof q.explanation === 'string'
        ? q.explanation
        : JSON.stringify(q.explanation);

    const trimmed = rawExplanation.trim();
    // These are "explicitly empty" values — treat as empty explanation
    if (!trimmed || trimmed === '[]' || trimmed === '""' || trimmed === '[{"type":"EXPLANATION","content":""}]') return null;

    // Try parsing as JSON array
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((s: any) => s && String(s.content || s.text || '').trim() !== '');
        if (valid.length === 0) return null;
        // sanitize each text/content field within array items
        const sanitizedValid = valid.map((s: any) => ({
          ...s,
          content: s.content ? sanitizeHtml(s.content) : s.content,
          text: s.text ? sanitizeHtml(s.text) : s.text,
        }));
        return extractAndSaveBase64Images(JSON.stringify(sanitizedValid));
      }
      // parsed is object (not array)
      if (typeof parsed === 'object' && parsed !== null) {
        return extractAndSaveBase64Images(sanitizeHtml(trimmed));
      }
    } catch { }
    // Plain string explanation
    return extractAndSaveBase64Images(sanitizeHtml(trimmed));
  }
  return null;
}
