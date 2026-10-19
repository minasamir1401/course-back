import { metadataTranslations, moduleMetadata } from '../utils/bilingualMetadata';
import { persistQuestionUpdates } from '../utils/examQuestionWrites';
import { deduplicateExamQuestionInput } from '../utils/examQuestionInput';
import { randomUUID } from 'node:crypto';
import { changedQuestionFields, changedQuestionOrders, calculateSubmissionStats } from '../utils/examPerformance';
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { runSafeDeduplicationAndEmptyCleanup } from '../scripts/clean-duplicates-and-empty';
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
import { canManageExamRecord, canViewExamRecord, resolveExamSchoolUpdate } from '../utils/examAccessPolicy';
import { isContentDeletionAllowed } from '../services/systemSettings.service';
import {
  JWT_SECRET, JWT_EXPIRES_IN, getVideoDuration, hasRequiredFields,
  isAnswerCorrect, sanitizeDeep, sanitizeUser, sanitizeExam, multerUpload,
  diagnosticLogs, pushDiagnosticLog, ALL_ROLES, SCHOOL_MANAGED_ROLES,
  statsCache, CACHE_TTL, setCache, invalidateCache, getStudentGradeAndStage, examMatchesStudent,
  buildStudentCourseWhere, loginAttempts, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS,
  UPLOADS_DIR, userSafeSelect, isAllowedVideoUrl, sanitizeHtml, parseStringArray,
  normalizeLegacyCourses, acquireLock, releaseLock, extractAndSaveBase64Images,
  robustNormalizeText, getQuestionCoreSignature
} from '../shared';
import { normalizeBackendDok, canViewExam, canManageExam, formatCorrectAnswer, formatExplanation } from './examControllerSupport';

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

    let schoolAdminSchoolId = (req as any).user.schoolId;
    if ((req as any).user.role === 'SCHOOL_ADMIN' && !schoolAdminSchoolId && (req as any).user.id) {
      const u = await prisma.user.findUnique({ where: { id: (req as any).user.id }, select: { schoolId: true } });
      schoolAdminSchoolId = u?.schoolId || null;
    }

    const rawCreateSchoolList = schoolIds !== undefined && Array.isArray(schoolIds) && schoolIds.length > 0
      ? schoolIds
      : (schoolId ? [schoolId] : ((req as any).user.role === 'SCHOOL_ADMIN' ? [schoolAdminSchoolId] : []));

    const sanitizedCreateSchoolIds: string[] = (Array.isArray(rawCreateSchoolList) ? rawCreateSchoolList : [rawCreateSchoolList])
      .map((s: any) => (typeof s === 'object' && s ? s.id : s))
      .filter((id: any): id is string => Boolean(id && typeof id === 'string' && id !== 'null' && id !== 'undefined' && id.trim() !== ''))
      .map((id: string) => id.trim());

    // Prepare target schools — only SUPER_ADMIN may mark an exam as Central, and only when no specific schools are targeted
    const effectiveIsCentral = (req as any).user.role === 'SUPER_ADMIN'
      ? (isCentral === false ? false : (sanitizedCreateSchoolIds.length > 0 ? false : (isCentral !== undefined ? !!isCentral : true)))
      : false;

    const finalSchoolIds: string[] = effectiveIsCentral
      ? []
      : (req as any).user.role === 'SCHOOL_ADMIN'
        ? (schoolAdminSchoolId ? [schoolAdminSchoolId] : sanitizedCreateSchoolIds)
        : sanitizedCreateSchoolIds;

    const ownerSchoolId = effectiveIsCentral
      ? null
      : (finalSchoolIds.length > 0 ? finalSchoolIds[0] : null);

    if (ownerSchoolId && !finalSchoolIds.includes(ownerSchoolId)) {
      finalSchoolIds.push(ownerSchoolId);
    }

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

    const sanitizedQuestions = deduplicateExamQuestionInput(sanitizeDeep(questions || []));

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

      // Sequential Module Creation with Deduplication
      const seenModuleKeys = new Set<string>();
      const deduplicatedModules: any[] = [];
      for (const m of sanitizedModulesInput) {
        if (!m) continue;
        const key = m.id ? String(m.id).trim() : (m.title ? String(m.title).trim().toLowerCase() : `__index_${deduplicatedModules.length}`);
        if (seenModuleKeys.has(key)) continue;
        seenModuleKeys.add(key);

        const seenSubExamKeys = new Set<string>();
        const deduplicatedSubExams: any[] = [];
        for (const s of (Array.isArray(m.subExams) ? m.subExams : [])) {
          if (!s) continue;
          const subKey = s.id ? String(s.id).trim() : (s.title ? String(s.title).trim().toLowerCase() : `__sub_${deduplicatedSubExams.length}`);
          if (seenSubExamKeys.has(subKey)) continue;
          seenSubExamKeys.add(subKey);
          deduplicatedSubExams.push(s);
        }
        deduplicatedModules.push({ ...m, subExams: deduplicatedSubExams });
      }

      const moduleIdMap: Record<string, string> = {};
      const subExamIdMap: Record<string, string> = {};
      for (let i = 0; i < deduplicatedModules.length; i++) {
        const m = deduplicatedModules[i];
        const frontendModuleId = m.id;
        const createdMod = await tx.examModule.create({
          data: {
            examId: newExam.id,
            title: m.title ? sanitizeHtml(m.title) : `Module ${i + 1}`,
            description: m.description ? sanitizeHtml(m.description) : null,
            order: m.order !== undefined ? parseInt(m.order) : i,
            duration: m.duration ? parseInt(m.duration) : null,
            passingScore: m.passingScore ? parseInt(m.passingScore) : null,
            ...moduleMetadata(m, sanitizeHtml),
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

        const subModulesInput = Array.isArray(m.subModules) ? m.subModules : [];
        for (let smIdx = 0; smIdx < subModulesInput.length; smIdx++) {
          const sm = subModulesInput[smIdx];
          if (!sm) continue;
          const frontendSubModId = sm.id;
          const createdSubMod = await tx.examModule.create({
            data: {
              examId: newExam.id,
              parentModuleId: createdMod.id,
              title: sm.title ? sanitizeHtml(sm.title) : `Sub-Module ${smIdx + 1}`,
              description: sm.description ? sanitizeHtml(sm.description) : null,
              order: sm.order !== undefined ? parseInt(sm.order) : smIdx,
              duration: sm.duration ? parseInt(sm.duration) : null,
              passingScore: sm.passingScore ? parseInt(sm.passingScore) : null,
              ...moduleMetadata(sm, sanitizeHtml),
              gradeTarget: sm.gradeTarget ? sanitizeHtml(sm.gradeTarget) : null,
              publishDate: sm.publishDate ? new Date(sm.publishDate) : null,
              cutOffDate: sm.cutOffDate ? new Date(sm.cutOffDate) : null,
            }
          });
          if (frontendSubModId) moduleIdMap[frontendSubModId] = createdSubMod.id;

          const smSubExamsInput = Array.isArray(sm.subExams) ? sm.subExams : [];
          for (let sj = 0; sj < smSubExamsInput.length; sj++) {
            const s = smSubExamsInput[sj];
            if (!s) continue;
            const createdSubExam = await tx.subExam.create({
              data: {
                moduleId: createdSubMod.id,
                title: s.title ? sanitizeHtml(s.title) : `Sub-Exam ${sj + 1}`,
                password: s.password ? sanitizeHtml(s.password) : null,
                duration: s.duration ? parseInt(s.duration) : null,
                passingScore: s.passingScore ? parseInt(s.passingScore) : null,
                attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
                order: s.order !== undefined ? parseInt(s.order) : sj,
                publishDate: s.publishDate ? new Date(s.publishDate) : null,
                cutOffDate: s.cutOffDate ? new Date(s.cutOffDate) : null,
              }
            });
            if (s.id) subExamIdMap[s.id] = createdSubExam.id;
          }
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
            textEn: q.textEn ? extractAndSaveBase64Images(sanitizeHtml(q.textEn)) : null,
            type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(q.type) ? sanitizeHtml(q.type) : 'MCQ',
            options: extractAndSaveBase64Images(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])),
            optionsEn: q.optionsEn ? extractAndSaveBase64Images(typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(q.optionsEn || [])) : null,
            correctAnswer: formatCorrectAnswer(q),
            points: parseInt(q.points) || 1,
            xpPoints: parseInt(q.xpPoints) || 10,
            ...metadataTranslations(q, sanitizeHtml),
            skill: q.skill ? sanitizeHtml(q.skill) : null,
            learningOutcome: (q.learningOutcome ?? q.standard) ? sanitizeHtml(q.learningOutcome ?? q.standard) : null,
            standard: (q.standard ?? q.learningOutcome) ? sanitizeHtml(q.standard ?? q.learningOutcome) : null,
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
            explanationEn: q.explanationEn ? extractAndSaveBase64Images(sanitizeHtml(q.explanationEn)) : null,
            hint: q.hint ? sanitizeHtml(q.hint) : null,
            hintEn: q.hintEn ? sanitizeHtml(q.hintEn) : null,
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
            where: { parentModuleId: null },
            orderBy: { order: 'asc' },
            include: {
              subExams: { orderBy: { order: 'asc' } },
              subModules: {
                orderBy: { order: 'asc' },
                include: { subExams: { orderBy: { order: 'asc' } } }
              }
            }
          }
        }
      });
      return sanitizeExam(fullExam);
    }, { maxWait: 15000, timeout: 120000 });

    res.json({ message: 'Exam created successfully', exam });
  } catch (error: any) {
    console.error(' Exam creation error:', error);
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
    const buildGradeFilter = (g: string) => ({
      OR: [
        { grade: g },
        { grades: { contains: `"${g}"` } }
      ]
    });

    if (isCentral === 'true' && (req as any).user.role === 'SUPER_ADMIN') {
      where.isCentral = true;
    } else if ((req as any).user.role === 'SUPER_ADMIN') {
      if (schoolId) {
        where.OR = [
          { isCentral: true },
          { schoolId: schoolId as string },
          { schools: { some: { id: schoolId as string } } }
        ];
      }
      if (grade) {
        where.AND = [
          ...(where.AND || []),
          buildGradeFilter(grade as string)
        ];
      }
    } else if ((req as any).user.role === 'SCHOOL_ADMIN') {
      let schoolIdToUse = (req as any).user.schoolId;
      if (!schoolIdToUse && (req as any).user.id) {
        const u = await prisma.user.findUnique({ where: { id: (req as any).user.id }, select: { schoolId: true } });
        schoolIdToUse = u?.schoolId || null;
      }
      where.OR = [
        { isCentral: true },
        ...(schoolIdToUse ? [
          { schoolId: schoolIdToUse },
          { schools: { some: { id: schoolIdToUse } } }
        ] : [])
      ];
      if (grade) {
        where.AND = [
          ...(where.AND || []),
          buildGradeFilter(grade as string)
        ];
      }
    } else if ((req as any).user.role === 'TEACHER') {
      where.OR = [
        { creatorId: (req as any).user.id },
        { course: { teachers: { some: { teacherId: (req as any).user.id } } } }
      ];
      if (grade) {
        where.AND = [
          ...(where.AND || []),
          buildGradeFilter(grade as string)
        ];
      }
    } else if ((req as any).user.role === 'STUDENT') {
      const student = await prisma.user.findUnique({ where: { id: (req as any).user.id }, select: { grade: true, schoolId: true } });
      if (!student) return res.status(403).json({ error: 'Student account not found' });
      (req as any).user = mergeStudentProfile((req as any).user, student);
      const currentGrade = student.grade;
      const schoolId = student.schoolId;

      // Base filters: Truly central exams (no specific school restriction)
      const orFilters: any[] = [
        {
          isCentral: true,
          schoolId: null,
          schools: { none: {} }
        }
      ];

      // Only add school filters if student belongs to a school
      if (schoolId) {
        orFilters.push({ schoolId: schoolId });
        orFilters.push({ schools: { some: { id: schoolId } } });
      }

      const studentGrades = getStudentGradeAndStage(currentGrade);
      const gradeOrConditions: any[] = [{ grade: null, OR: [{ grades: null }, { grades: '[]' }, { grades: '' }] }];
      for (const g of studentGrades) {
        gradeOrConditions.push({ grade: g });
        gradeOrConditions.push({ grades: { contains: `"${g}"` } });
      }

      where.AND = [
        { OR: orFilters },
        ...(gradeOrConditions.length > 0 ? [{ OR: gradeOrConditions }] : [])
      ];
      where.status = 'PUBLISHED';
      // Student must only see exams that have at least one module
      where.modules = { some: {} };
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
        ...((req as any).user.role === 'STUDENT' ? {
          submissions: {
            where: { userId: (req as any).user.id },
            select: { id: true, subExamId: true, createdAt: true }
          }
        } : {}),
        school: { select: { name: true } },
        schools: { select: { name: true, id: true } },
        creator: { select: { name: true } },
        _count: { select: { questions: { where: { deletedAt: null } } } },
        modules: {
          where: { parentModuleId: null },
          orderBy: { order: 'asc' },
          include: {
            parentModule: { select: { id: true, title: true } },
            subModules: {
              orderBy: { order: 'asc' },
              include: {
                _count: { select: { questions: { where: { deletedAt: null } } } },
                subExams: {
                  orderBy: { order: 'asc' },
                  include: { _count: { select: { questions: { where: { deletedAt: null } } } } }
                }
              }
            },
            subExams: {
              orderBy: { order: 'asc' },
              include: { _count: { select: { questions: { where: { deletedAt: null } } } } }
            },
            _count: { select: { questions: { where: { deletedAt: null } } } }
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    if ((req as any).user.role === 'STUDENT') {
      exams = exams.filter((exam: any) => {
        // A student must only see exams that contain at least one root module/section
        const rootSections = (exam.modules || []).filter((m: any) => !m.parentModuleId);
        if (rootSections.length === 0) return false;

        // Double check student school and grade access
        return examMatchesStudent(exam, (req as any).user);
      });
    }

    res.json(exams.map((exam: any) => ({
      ...exam,
      modules: (exam.modules || []).map((module: any) => ({
        ...module,
        ...countModuleContent(module),
        availability: getAvailability(module),
        subModules: (module.subModules || []).map((sm: any) => ({
          ...sm,
          ...countModuleContent(sm),
          availability: getAvailability(sm),
          subExams: (sm.subExams || []).map((subExam: any) => ({
            ...subExam,
            questionsCount: subExam._count?.questions || 0,
            availability: getAvailability(subExam),
          })),
        })),
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
    if (!existingExam || existingExam.deletedAt !== null) return res.status(404).json({ error: 'Exam not found or has been deleted' });

    if (!await canManageExam((req as any).user, existingExam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to edit this exam.' });
    }

    const questionScopeId = typeof req.body.questionScopeId === 'string' ? req.body.questionScopeId : null;
    if (questionScopeId) {
      const scope = await prisma.subExam.findFirst({ where: { id: questionScopeId, module: { examId: id } }, select: { id: true } });
      if (!scope || req.body.modules !== undefined || (questions || []).some((q: any) => q.subExamId !== questionScopeId)) {
        return res.status(400).json({ error: 'Invalid child exam save scope' });
      }
      if (Array.isArray(deletedQuestionIds) && deletedQuestionIds.length) {
        const outOfScope = await prisma.question.count({ where: { id: { in: deletedQuestionIds }, examId: id, OR: [{ subExamId: null }, { subExamId: { not: questionScopeId } }] } });
        if (outOfScope) return res.status(400).json({ error: 'Question deletion outside child exam scope' });
      }
    }
    const sanitizedQuestions = deduplicateExamQuestionInput(sanitizeDeep(questions || []));

    if (deletedQuestionIds !== undefined && !Array.isArray(deletedQuestionIds)) {
      return res.status(400).json({ error: 'deletedQuestionIds must be an array.' });
    }
    const requestedDeletes = (deletedQuestionIds || []).filter((value: unknown): value is string => typeof value === 'string');
    const hierarchyDeletes = resolveExplicitExamDeletions(req.body);
    if (req.body.modules !== undefined && (hierarchyDeletes.moduleIds.length || hierarchyDeletes.subExamIds.length) &&
        (req as any).user.role !== 'SUPER_ADMIN' && !await isContentDeletionAllowed()) {
      return res.status(403).json({ error: 'Content deletion is currently disabled by Super Admin. حذف المحتوى معطّل حالياً من الإدارة العامة.' });
    }
    if (requestedDeletes.length > 0 && (req as any).user.role !== 'SUPER_ADMIN') {
      const allowed = await isContentDeletionAllowed();
      if (!allowed) {
        const persistedDeletes = await prisma.question.count({
          where: { examId: id, id: { in: requestedDeletes }, deletedAt: null }
        });
        if (persistedDeletes > 0) {
          return res.status(403).json({
            error: 'حذف الأسئلة والمحتوى معطّل حالياً من قِبل الإدارة العامة. Content and question deletion is currently disabled by Super Admin.'
          });
        }
      }
    }

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
      Object.assign(updateData, resolveExamSchoolUpdate(existingExam, req.body));
    } else {
      const effectiveIsCentral = false;
      updateData.isCentral = effectiveIsCentral;
      let schoolIdToUse = existingExam.schoolId || (req as any).user.schoolId;
      if (!schoolIdToUse && (req as any).user.id) {
        const u = await prisma.user.findUnique({ where: { id: (req as any).user.id }, select: { schoolId: true } });
        schoolIdToUse = u?.schoolId || null;
      }
      updateData.schoolId = schoolIdToUse;
      if (schoolIdToUse) {
        updateData.schools = {
          set: [{ id: schoolIdToUse }]
        };
      }
    }

    const exam = await prisma.$transaction(async (tx) => {
      // --- MODULES UPSERT LOGIC ---
      let incomingModuleIds: string[] = [];
      let incomingSubExamIds: string[] = [];
      let modulesProvided = false;
      const moduleIdMap = new Map<string, string>();
      const subExamIdMap = new Map<string, string>();

      if (req.body.modules !== undefined) {
        modulesProvided = true;
        const sanitizedModules = Array.isArray(req.body.modules) ? req.body.modules : [];
        incomingModuleIds = sanitizedModules.flatMap((m: any) => [
          m?.id,
          ...(Array.isArray(m?.subModules) ? m.subModules.map((sm: any) => sm?.id) : [])
        ]).filter(Boolean);

        // 1. Gather all incoming SubExams across all modules and subModules
        incomingSubExamIds = sanitizedModules.flatMap((m: any) => [
          ...(Array.isArray(m?.subExams) ? m.subExams.map((s: any) => s?.id) : []),
          ...(Array.isArray(m?.subModules) ? m.subModules.flatMap((sm: any) => (Array.isArray(sm?.subExams) ? sm.subExams.map((s: any) => s?.id) : [])) : [])
        ]).filter(Boolean);

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

        // Deduplicate incoming modules by id or title
        const seenModuleKeys = new Set<string>();
        const deduplicatedModules: any[] = [];
        for (const m of sanitizedModules) {
          if (!m) continue;
          const key = m.id ? String(m.id).trim() : (m.title ? String(m.title).trim().toLowerCase() : `__index_${deduplicatedModules.length}`);
          if (seenModuleKeys.has(key)) continue;
          seenModuleKeys.add(key);

          const seenSubExamKeys = new Set<string>();
          const deduplicatedSubExams: any[] = [];
          for (const s of (Array.isArray(m.subExams) ? m.subExams : [])) {
            if (!s) continue;
            const subKey = s.id ? String(s.id).trim() : (s.title ? String(s.title).trim().toLowerCase() : `__sub_${deduplicatedSubExams.length}`);
            if (seenSubExamKeys.has(subKey)) continue;
            seenSubExamKeys.add(subKey);
            deduplicatedSubExams.push(s);
          }
          deduplicatedModules.push({ ...m, subExams: deduplicatedSubExams });
        }

        // Upsert deduplicated modules
        for (let i = 0; i < deduplicatedModules.length; i++) {
          const m = deduplicatedModules[i];
          const mData = {
            title: m.title ? sanitizeHtml(m.title) : `Module ${i + 1}`,
            description: m.description ? sanitizeHtml(m.description) : null,
            order: m.order !== undefined ? parseInt(m.order) : i,
            duration: m.duration ? parseInt(m.duration) : null,
            passingScore: m.passingScore ? parseInt(m.passingScore) : null,
            ...moduleMetadata(m, sanitizeHtml),
            gradeTarget: m.gradeTarget ? sanitizeHtml(m.gradeTarget) : null,
            publishDate: m.publishDate ? new Date(m.publishDate) : null,
            cutOffDate: m.cutOffDate ? new Date(m.cutOffDate) : null
          };
          let moduleId = m.id;
          const existingMod = m.id
            ? await tx.examModule.findFirst({ where: { examId: id, OR: [{ id: m.id }, { title: mData.title }] } })
            : await tx.examModule.findFirst({ where: { examId: id, title: mData.title } });

          const candidateModuleId = existingMod?.id || (m.id ? String(m.id).trim() : null);
          let moduleUpdated = false;

          if (candidateModuleId) {
            const updateRes = await tx.examModule.updateMany({
              where: { id: candidateModuleId, examId: id },
              data: mData
            });
            if (updateRes.count > 0) {
              moduleId = candidateModuleId;
              moduleUpdated = true;
            }
          }

          if (!moduleUpdated) {
            const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateModuleId || '');
            let idToUse: string | undefined = undefined;
            if (isValidUuid && candidateModuleId) {
              const alreadyExists = await tx.examModule.findUnique({ where: { id: candidateModuleId } });
              if (!alreadyExists) {
                idToUse = candidateModuleId;
              }
            }
            const newMod = await tx.examModule.create({
              data: {
                ...(idToUse ? { id: idToUse } : {}),
                examId: id,
                ...mData
              }
            });
            moduleId = newMod.id;
          }

          if (m.id) {
            moduleIdMap.set(String(m.id).trim(), moduleId);
          }
          moduleIdMap.set(moduleId, moduleId);

          // Sub-modules if any
          const sanitizedSubModules = Array.isArray(m.subModules) ? m.subModules : [];
          for (let smIdx = 0; smIdx < sanitizedSubModules.length; smIdx++) {
            const sm = sanitizedSubModules[smIdx];
            if (!sm) continue;
            const smData = {
              examId: id,
              parentModuleId: moduleId,
              title: sm.title ? sanitizeHtml(sm.title) : `Sub-Module ${smIdx + 1}`,
              description: sm.description ? sanitizeHtml(sm.description) : null,
              order: sm.order !== undefined ? parseInt(sm.order) : smIdx,
              duration: sm.duration ? parseInt(sm.duration) : null,
              passingScore: sm.passingScore ? parseInt(sm.passingScore) : null,
              ...moduleMetadata(sm, sanitizeHtml),
              gradeTarget: sm.gradeTarget ? sanitizeHtml(sm.gradeTarget) : null,
            };
            const existingSubMod = sm.id
              ? await tx.examModule.findFirst({ where: { examId: id, OR: [{ id: sm.id }, { title: smData.title }] } })
              : await tx.examModule.findFirst({ where: { examId: id, parentModuleId: moduleId, title: smData.title } });

            const candidateSubModId = existingSubMod?.id || (sm.id ? String(sm.id).trim() : null);
            let subModUpdated = false;
            let subModId = sm.id;

            if (candidateSubModId) {
              const upd = await tx.examModule.updateMany({
                where: { id: candidateSubModId, examId: id },
                data: smData
              });
              if (upd.count > 0) {
                subModId = candidateSubModId;
                subModUpdated = true;
              }
            }

            if (!subModUpdated) {
              const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateSubModId || '');
              let smIdToUse: string | undefined = undefined;
              if (isUuid && candidateSubModId) {
                const ex = await tx.examModule.findUnique({ where: { id: candidateSubModId } });
                if (!ex) smIdToUse = candidateSubModId;
              }
              const createdSm = await tx.examModule.create({
                data: {
                  ...(smIdToUse ? { id: smIdToUse } : {}),
                  ...smData
                }
              });
              subModId = createdSm.id;
            }

            if (sm.id) moduleIdMap.set(String(sm.id).trim(), subModId);
            moduleIdMap.set(subModId, subModId);

            // Sub-exams inside this submodule
            const sanitizedSmSubExams = Array.isArray(sm.subExams) ? sm.subExams : [];
            for (let sj = 0; sj < sanitizedSmSubExams.length; sj++) {
              const s = sanitizedSmSubExams[sj];
              if (!s) continue;
              const sData = {
                title: s.title ? sanitizeHtml(s.title) : `Sub-Exam ${sj + 1}`,
                password: s.password ? sanitizeHtml(s.password) : null,
                duration: s.duration ? parseInt(s.duration) : null,
                passingScore: s.passingScore ? parseInt(s.passingScore) : null,
                attemptsAllowed: s.attemptsAllowed ? parseInt(s.attemptsAllowed) : 1,
                order: s.order !== undefined ? parseInt(s.order) : sj,
                publishDate: s.publishDate ? new Date(s.publishDate) : null,
                cutOffDate: s.cutOffDate ? new Date(s.cutOffDate) : null
              };

              const existingSub = s.id
                ? await tx.subExam.findFirst({ where: { moduleId: subModId, OR: [{ id: s.id }, { title: sData.title }] } })
                : await tx.subExam.findFirst({ where: { moduleId: subModId, title: sData.title } });

              const candidateSubId = existingSub?.id || (s.id ? String(s.id).trim() : null);
              let subUpdated = false;
              let subExamId = s.id;

              if (candidateSubId) {
                const updateSubRes = await tx.subExam.updateMany({
                  where: { id: candidateSubId, moduleId: subModId },
                  data: sData
                });
                if (updateSubRes.count > 0) {
                  subExamId = candidateSubId;
                  subUpdated = true;
                }
              }

              if (!subUpdated) {
                const isValidSubUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateSubId || '');
                let subIdToUse: string | undefined = undefined;
                if (isValidSubUuid && candidateSubId) {
                  const subAlreadyExists = await tx.subExam.findUnique({ where: { id: candidateSubId } });
                  if (!subAlreadyExists) {
                    subIdToUse = candidateSubId;
                  }
                }
                const createdSub = await tx.subExam.create({
                  data: {
                    ...(subIdToUse ? { id: subIdToUse } : {}),
                    moduleId: subModId,
                    ...sData
                  }
                });
                subExamId = createdSub.id;
              }

              if (s.id) subExamIdMap.set(String(s.id).trim(), subExamId);
              subExamIdMap.set(subExamId, subExamId);
            }
          }

          // Sub-exams
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

            const existingSub = s.id
              ? await tx.subExam.findFirst({ where: { moduleId, OR: [{ id: s.id }, { title: sData.title }] } })
              : await tx.subExam.findFirst({ where: { moduleId, title: sData.title } });

            const candidateSubId = existingSub?.id || (s.id ? String(s.id).trim() : null);
            let subUpdated = false;
            let subExamId = s.id;

            if (candidateSubId) {
              const updateSubRes = await tx.subExam.updateMany({
                where: { id: candidateSubId, moduleId },
                data: sData
              });
              if (updateSubRes.count > 0) {
                subExamId = candidateSubId;
                subUpdated = true;
              }
            }

            if (!subUpdated) {
              const isValidSubUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateSubId || '');
              let subIdToUse: string | undefined = undefined;
              if (isValidSubUuid && candidateSubId) {
                const subAlreadyExists = await tx.subExam.findUnique({ where: { id: candidateSubId } });
                if (!subAlreadyExists) {
                  subIdToUse = candidateSubId;
                }
              }
              const createdSub = await tx.subExam.create({
                data: {
                  ...(subIdToUse ? { id: subIdToUse } : {}),
                  moduleId,
                  ...sData
                }
              });
              subExamId = createdSub.id;
            }

            if (s.id) subExamIdMap.set(String(s.id).trim(), subExamId);
            subExamIdMap.set(subExamId, subExamId);
          }
        }

        // Clean up any empty duplicate modules for this exam
        const allModulesInExam = await tx.examModule.findMany({
          where: { examId: id },
          include: { _count: { select: { questions: { where: { deletedAt: null } }, subExams: true, subModules: true } } }
        });
        const seenTitleMap = new Map<string, string>();
        for (const curMod of allModulesInExam) {
          const normTitle = String(curMod.title || '').trim().toLowerCase();
          if (!normTitle) continue;
          const groupKey = `${curMod.parentModuleId || 'root'}:${normTitle}`;
          if (seenTitleMap.has(groupKey)) {
            if (curMod._count.questions === 0 && curMod._count.subExams === 0 && curMod._count.subModules === 0) {
              await tx.examModule.deleteMany({ where: { id: curMod.id, examId: id } });
            }
          } else {
            seenTitleMap.set(groupKey, curMod.id);
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
          where: { examId: id, deletedAt: null, ...(questionScopeId ? { subExamId: questionScopeId } : {}) },
        });
        const existingQuestionMap = new Map(existingQuestionsWithExp.map(q => [q.id, q]));
        const pendingQuestions: any[] = [];
        const pendingUpdates: Array<{ id: string; data: Record<string, any> }> = [];
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

        //  100% FOREIGN KEY SAFE: ONLY real DB IDs confirmed to exist in the database!
        // Unverified client IDs from incomingModuleIds or incomingSubExamIds MUST NEVER be added directly.
        const validModuleIdSet = new Set<string>(existingExamModules.map(m => m.id));
        const validSubExamIdSet = new Set<string>(existingSubExams.map(s => s.id));

        //  KEY FIX: Track which IDs the client explicitly sent in the payload
        // We only soft-delete questions the client KNEW about (had their ID) but chose to remove.
        // Questions sent without an ID are new — they never trigger deletions.
        for (let i = 0; i < sanitizedQuestions.length; i++) {
          const q = sanitizedQuestions[i];
          if (typeof q?.id === 'string' && explicitDeletedIds.has(q.id)) {
            console.warn(`[Exam Update] Deletion wins over conflicting question payload: ${q.id}`);
            continue;
          }
          const newExplanation = formatExplanation(q);
          const newExplanationEn = q.explanationEn !== undefined
            ? (q.explanationEn ? extractAndSaveBase64Images(sanitizeHtml(q.explanationEn)) : null)
            : undefined;

          const cleanModuleId = q.moduleId ? sanitizeHtml(String(q.moduleId).trim()) : null;
          const cleanSubExamId = q.subExamId ? sanitizeHtml(String(q.subExamId).trim()) : null;

          //  Resolve client temporary or mapped IDs to actual DB IDs, strictly verifying FK existence
          const mappedModuleId = cleanModuleId ? (moduleIdMap.get(cleanModuleId) || cleanModuleId) : null;
          const resolvedModuleId = mappedModuleId && validModuleIdSet.has(mappedModuleId) ? mappedModuleId : null;

          const mappedSubExamId = cleanSubExamId ? (subExamIdMap.get(cleanSubExamId) || cleanSubExamId) : null;
          const resolvedSubExamId = mappedSubExamId && validSubExamIdSet.has(mappedSubExamId) ? mappedSubExamId : null;

          const qData = {
            text: extractAndSaveBase64Images(sanitizeHtml(q.text || '')),
            textEn: q.textEn !== undefined ? (q.textEn ? extractAndSaveBase64Images(sanitizeHtml(q.textEn)) : null) : undefined,
            type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(q.type === 'QUESTION' && q.label ? q.label : q.type) ? sanitizeHtml(q.type === 'QUESTION' && q.label ? q.label : q.type) : 'MCQ',
            options: extractAndSaveBase64Images(typeof q.options === 'string' ? q.options : JSON.stringify(q.options || [])),
            optionsEn: q.optionsEn !== undefined ? (q.optionsEn ? extractAndSaveBase64Images(typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(q.optionsEn)) : null) : undefined,
            correctAnswer: formatCorrectAnswer(q),
            points: parseInt(q.points) || 1,
            xpPoints: parseInt(q.xpPoints) || 10,
            ...metadataTranslations(q, sanitizeHtml),
            skill: q.skill !== undefined ? (q.skill ? sanitizeHtml(q.skill) : null) : undefined,
            learningOutcome: q.learningOutcome !== undefined ? (q.learningOutcome ? sanitizeHtml(q.learningOutcome) : null) : undefined,
            standard: q.standard !== undefined ? (q.standard ? sanitizeHtml(q.standard) : null) : undefined,
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
            explanationEn: newExplanationEn,
            hint: q.hint !== undefined ? (q.hint ? sanitizeHtml(q.hint) : null) : undefined,
            hintEn: q.hintEn !== undefined ? (q.hintEn ? sanitizeHtml(q.hintEn) : null) : undefined,
            imageUrl: q.imageUrl ? extractAndSaveBase64Images(sanitizeHtml(q.imageUrl)) : null,
            //  FK-SAFE: strictly ensure moduleId and subExamId exist in DB or fallback to null (avoids P2003 / Question_moduleId_fkey)
            moduleId: resolvedModuleId,
            subExamId: resolvedSubExamId,
            order: questionScopeId && typeof q.id === 'string' ? (existingQuestionMap.get(q.id)?.order ?? i) : i
          };

          // Skip completely empty question rows that have no text in either Arabic or English and no media
          const qNormText = robustNormalizeText(qData.text);
          const qNormTextEn = qData.textEn ? robustNormalizeText(qData.textEn) : '';
          if (qNormText.length < 2 && qNormTextEn.length < 2 && !qData.imageUrl && !qData.videoUrl) {
            console.warn(`[Exam Update] Skipping empty question row with no text or media (index ${i})`);
            continue;
          }

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
            //  ROOT CAUSE FIX: If the new explanation is null (frontend sent empty/[])
            // AND the DB has an existing non-null explanation → preserve it.
            // Only overwrite explanation if the incoming payload has real content.
            if (updatePayload.explanation === null && q.clearExplanation !== true) {
              const preservedExplanation = existingExplanationMap.get(targetQuestionId);
              if (preservedExplanation) {
                // Keep the existing explanation — don't wipe it
                delete updatePayload.explanation;
              }
            }
            const changes = changedQuestionFields(existingQuestionMap.get(targetQuestionId) || {}, updatePayload);
            if (Object.keys(changes).length) pendingUpdates.push({ id: targetQuestionId, data: changes });
            usedExistingIds.add(targetQuestionId);
            incomingQuestionIds.push(targetQuestionId);
          } else {
            // Last-resort duplicate guard: before creating a new question, check if an
            // existing un-used question already has the same normalized text or core signature.
            // This handles autosave races and prefix variations (e.g. Question 1 (College Board):)
            const incomingSig = getQuestionCoreSignature(qData.text);
            const incomingTextNorm = robustNormalizeText(qData.text);
            const incomingOptionsNorm = typeof qData.options === 'string' ? qData.options : JSON.stringify(qData.options || []);
            const textDuplicateId = (incomingSig.length >= 5 || incomingTextNorm.length > 5)
              ? existingQuestionsWithExp.find(
                (eq) =>
                  !usedExistingIds.has(eq.id) &&
                  !explicitDeletedIds.has(eq.id) &&
                  ((incomingSig.length >= 5 && getQuestionCoreSignature(eq.text) === incomingSig) ||
                   robustNormalizeText(eq.text) === incomingTextNorm) &&
                  (!eq.imageUrl || !qData.imageUrl || eq.imageUrl === qData.imageUrl) &&
                  (!eq.options || !incomingOptionsNorm || eq.options === incomingOptionsNorm),
              )?.id
              : undefined;

            if (textDuplicateId) {
              console.warn(`[Exam Update] Prevented duplicate question creation – updating existing row instead: ${textDuplicateId}`);
              const changes = changedQuestionFields(existingQuestionMap.get(textDuplicateId) || {}, qData);
              if (Object.keys(changes).length) pendingUpdates.push({ id: textDuplicateId, data: changes });
              usedExistingIds.add(textDuplicateId);
              incomingQuestionIds.push(textDuplicateId);
            } else {
              // Create new question (no ID = brand new question)
              const createdQuestion = { ...qData, examId: id, id: randomUUID() };
              pendingQuestions.push(createdQuestion);
              usedExistingIds.add(createdQuestion.id);
              incomingQuestionIds.push(createdQuestion.id);
            }
          }
        }

        await persistQuestionUpdates(tx, id, pendingUpdates);
        for (let offset = 0; offset < pendingQuestions.length; offset += 250) {
          await tx.question.createMany({ data: pendingQuestions.slice(offset, offset + 250) });
        }

        // SAFE Soft-delete: only remove questions explicitly deleted by the editor UI.
        // The guard above enforces deletion policy and managed exam access.
        if (explicitDeletedIds.size) {
          await tx.question.updateMany({
            where: { id: { in: Array.from(explicitDeletedIds) }, examId: id },
            data: { deletedAt: new Date() }
          });
        }

        // A partial autosave must not delete unseen rows. Keep those rows and append
        // them deterministically after the sequence sent by the editor, then persist
        // unique contiguous order values so every reader sees the same order.
        const activeQuestions = await tx.question.findMany({
          where: { examId: id, deletedAt: null },
          select: { id: true, order: true, createdAt: true, subExamId: true }
        });
        const retainedIncomingQuestionIds = incomingQuestionIds.filter((questionId) => !explicitDeletedIds.has(questionId));
        const incomingIdSet = new Set(retainedIncomingQuestionIds);
        let orderedQuestionIds = [
          ...retainedIncomingQuestionIds,
          ...sortPersistedOrder(activeQuestions)
            .filter((question) => !incomingIdSet.has(question.id))
            .map((question) => question.id)
        ];
        if (questionScopeId) {
          // Replace only the child slots; sibling relative order must survive partial saves.
          const childSet = new Set(activeQuestions.filter(q => q.subExamId === questionScopeId).map(q => q.id));
          const childIds = orderedQuestionIds.filter(questionId => childSet.has(questionId));
          let childIndex = 0;
          orderedQuestionIds = sortPersistedOrder(activeQuestions).map(q => q.subExamId === questionScopeId ? childIds[childIndex++] : q.id);
        }
        const orderChanges = changedQuestionOrders(activeQuestions, orderedQuestionIds);
        if (orderChanges.length) {
          // One parameterized statement, scoped to this exam; never interpolate identifiers or values.
          await tx.$executeRaw`
            UPDATE "Question" AS q SET "order" = v."order", "updatedAt" = NOW()
            FROM jsonb_to_recordset(${JSON.stringify(orderChanges)}::jsonb) AS v(id text, "order" integer)
            WHERE q.id = v.id AND q."examId" = ${id} AND q."deletedAt" IS NULL
          `;
        }
      }

      // Return the updated questions with their IDs so the frontend can sync
      return tx.exam.findUnique({
        where: { id },
        include: {
          questions: {
            where: { deletedAt: null, ...(questionScopeId ? { subExamId: questionScopeId } : {}) },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
          },
          modules: {
            where: { parentModuleId: null },
            orderBy: { order: 'asc' },
            include: {
              subExams: { orderBy: { order: 'asc' } },
              subModules: {
                orderBy: { order: 'asc' },
                include: { subExams: { orderBy: { order: 'asc' } } }
              }
            }
          }
        }
      });
    }, { maxWait: 15000, timeout: 120000 });

    if (!exam) {
      return res.status(404).json({ error: 'Exam not found or has been deleted' });
    }

    const { questions: savedQuestions, modules: savedModules, ...examSummary } = exam;
    res.json({ message: 'Exam updated successfully', exam: req.query.compact === 'true' ? examSummary : exam, modules: savedModules, questions: savedQuestions });
  } catch (error: any) {
    console.error(' Exam update error:', error); require('fs').writeFileSync('error_log.txt', String(error) + '\n' + error.stack);
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

    // Global deletion policy check
    if ((req as any).user?.role !== 'SUPER_ADMIN') {
      const allowed = await isContentDeletionAllowed();
      if (!allowed) {
        return res.status(403).json({
          error: 'حذف المحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.'
        });
      }
    }

    // Authorization check
    if (!await canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to delete this exam.' });
    }

    await prisma.exam.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    res.json({ message: 'Exam deleted successfully' });
  } catch (error) {
    console.error('[Exam Delete Error]', error);
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
