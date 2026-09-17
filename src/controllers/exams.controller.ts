import { persistQuestionUpdates } from '../utils/examQuestionWrites';
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
import { canManageExamRecord, resolveExamSchoolUpdate } from '../utils/examAccessPolicy';
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
            explanationEn: q.explanationEn ? extractAndSaveBase64Images(sanitizeHtml(q.explanationEn)) : null,
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
    const sanitizedQuestions = sanitizeDeep(questions || []);

    if (deletedQuestionIds !== undefined && !Array.isArray(deletedQuestionIds)) {
      return res.status(400).json({ error: 'deletedQuestionIds must be an array.' });
    }
    // Removing an unsaved draft row is a client-only operation. Every persisted
    // question deletion is reserved for SUPER_ADMIN, regardless of ownership or answers.
    const requestedDeletes = (deletedQuestionIds || []).filter((value: unknown): value is string => typeof value === 'string');
    if (requestedDeletes.length > 0 && (req as any).user.role !== 'SUPER_ADMIN') {
      const persistedDeletes = await prisma.question.count({
        where: { examId: id, id: { in: requestedDeletes }, deletedAt: null }
      });
      if (persistedDeletes > 0) {
        return res.status(403).json({
          error: 'حذف الأسئلة المحفوظة متاح للسوبر أدمن فقط. Only Super Admin can delete saved questions.'
        });
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
            explanationEn: newExplanationEn,
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
            const textDuplicateId = (incomingSig.length >= 5 || incomingTextNorm.length > 5)
              ? existingQuestionsWithExp.find(
                (eq) =>
                  !usedExistingIds.has(eq.id) &&
                  !explicitDeletedIds.has(eq.id) &&
                  ((incomingSig.length >= 5 && getQuestionCoreSignature(eq.text) === incomingSig) ||
                   robustNormalizeText(eq.text) === incomingTextNorm),
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
        // The authorization guard above reserves every persisted deletion for SUPER_ADMIN.
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
    console.error(' Delete error:', error);
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
        }
      }
    });

    // 1. Overall Stats
    const totalSubmissions = submissions.length;
    const passCount = submissions.filter(s => (s.percentage || 0) >= (exam.passingScore || 50)).length;
    const passRate = totalSubmissions > 0 ? (passCount / totalSubmissions) * 100 : 0;
    const avgScore = totalSubmissions > 0 ? submissions.reduce((acc, s) => acc + (s.percentage || 0), 0) / totalSubmissions : 0;
    const totalExamPoints = exam.questions.reduce((acc, q) => acc + (q.points || 1), 0);

    // Aggregate once in PostgreSQL rather than transferring every student's answers.
    const answerCounts = await prisma.studentAnswer.groupBy({
      by: ['questionId', 'isCorrect'], where: { submission: where }, _count: { _all: true }
    });
    const countsByQuestion = new Map<string, { correct: number; total: number }>();
    for (const row of answerCounts) {
      const count = countsByQuestion.get(row.questionId) || { correct: 0, total: 0 };
      count.total += row._count._all;
      if (row.isCorrect) count.correct += row._count._all;
      countsByQuestion.set(row.questionId, count);
    }
    const moduleCounts = new Map<string, { correct: number; total: number }>();
    const subExamCounts = new Map<string, { correct: number; total: number }>();
    const addCounts = (map: Map<string, { correct: number; total: number }>, key: string | null, count: { correct: number; total: number }) => {
      if (!key) return;
      const previous = map.get(key) || { correct: 0, total: 0 };
      map.set(key, { correct: previous.correct + count.correct, total: previous.total + count.total });
    };
    const questionStats = exam.questions.map(q => {
      const count = countsByQuestion.get(q.id) || { correct: 0, total: 0 };
      addCounts(moduleCounts, q.moduleId, count);
      addCounts(subExamCounts, q.subExamId, count);
      return { id: q.id, text: q.text, type: q.type, moduleId: q.moduleId, subExamId: q.subExamId,
        correctRate: count.total ? count.correct / count.total * 100 : 0 };
    }).sort((a, b) => b.correctRate - a.correctRate);
    const moduleStats = exam.modules.map(mod => {
      const count = moduleCounts.get(mod.id) || { correct: 0, total: 0 };
      return { id: mod.id, title: mod.title, totalAnswers: count.total, correctRate: count.total ? count.correct / count.total * 100 : 0 };
    });
    const subExamStats = exam.modules.flatMap(m => m.subExams || []).map(se => {
      const count = subExamCounts.get(se.id) || { correct: 0, total: 0 };
      return { id: se.id, title: se.title, moduleId: se.moduleId, totalAnswers: count.total, correctRate: count.total ? count.correct / count.total * 100 : 0 };
    });

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


export const getExamQuestionsHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : null;
    const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : null;

    const exam = await prisma.exam.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        isCentral: true,
        schoolId: true,
        grade: true,
        grades: true,
        status: true,
        creatorId: true,
        courseId: true,
        schools: { select: { id: true } }
      }
    });

    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    const role = (req as any).user.role;
    const isPrivilegedRole = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR', 'STUDENT'].includes(role);
    if (!isPrivilegedRole) {
      return res.status(403).json({ error: 'Access denied (Role: ' + role + ')' });
    }

    if (role === 'STUDENT') {
      const student = await prisma.user.findUnique({ where: { id: (req as any).user.id }, select: { grade: true, schoolId: true } });
      if (!student || !examMatchesStudent(exam, mergeStudentProfile((req as any).user, student))) {
        return res.status(403).json({ error: 'Access denied (Student)' });
      }
    } else if (['SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR'].includes(role)) {
      const canAccessExam = await canManageExam((req as any).user, exam);
      if (!canAccessExam) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const where: any = { examId: id, deletedAt: null };
    if (subExamId) where.subExamId = subExamId;
    if (moduleId) where.moduleId = moduleId;

    const questions = await prisma.question.findMany({
      where,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    });

    const parsedQuestions = questions.map(q => {
      let options = [];
      try {
        options = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
      } catch (e) {
        options = [];
      }
      let optionsEn = null;
      if (q.optionsEn) {
        try {
          optionsEn = typeof q.optionsEn === 'string' ? JSON.parse(q.optionsEn) : q.optionsEn;
        } catch (e) {
          optionsEn = q.optionsEn;
        }
      }
      if (role === 'STUDENT') {
        const { correctAnswer, explanation, explanationEn, ...rest } = q;
        return { ...rest, options, optionsEn };
      }
      return { ...q, options, optionsEn };
    });

    res.json({ questions: parsedQuestions });
  } catch (error) {
    logExamRequestError('detail', req, error);
    res.status(500).json({ error: 'Error fetching exam questions' });
  }
};

export const getExamHandler10 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const subExamId = typeof req.query.subExamId === 'string' ? req.query.subExamId : null;
    const includeQuestions = req.query.includeQuestions !== 'false';
    const onlyQuestions = req.query.onlyQuestions === 'true';

    if (onlyQuestions) {
      return getExamQuestionsHandler(req, res);
    }

    const queryStartTime = Date.now();
    const exam = await prisma.exam.findUnique({
      where: { id, deletedAt: null },
      include: {
        schools: { select: { id: true, name: true } },
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
            _count: { select: { questions: { where: { deletedAt: null } } } },
            subExams: {
              orderBy: { order: 'asc' },
              include: { _count: { select: { questions: { where: { deletedAt: null } } } } }
            }
          }
        },
        ...(includeQuestions ? {
          questions: {
            where: subExamId ? { subExamId, deletedAt: null } : { deletedAt: null },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
          }
        } : {})
      }
    });
    const queryDuration = Date.now() - queryStartTime;
    if (queryDuration > 1000) {
      console.log(`[Exam GET] Exam "${exam?.title || id}" query took ${queryDuration}ms (${includeQuestions ? ((exam as any)?.questions?.length || 0) : 0} questions)`);
    }

    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    const role = (req as any).user.role;
    const userId = (req as any).user.id;

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
      ? exam.modules.flatMap((module: any) => [
          ...(module.subExams || []),
          ...((module.subModules || []).flatMap((sm: any) => sm.subExams || []))
        ]).find((subExam: any) => subExam.id === subExamId)
      : null;
    if (subExamId && !selectedSubExam) return res.status(404).json({ error: 'Exam section not found' });

    let parsedQuestions: any[] = [];
    if (includeQuestions && Array.isArray((exam as any).questions)) {
      parsedQuestions = (exam as any).questions.map((q: any) => {
        let options = [];
        try {
          options = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
        } catch (e) {
          options = [];
        }
        let optionsEn = null;
        if (q.optionsEn) {
          try {
            optionsEn = typeof q.optionsEn === 'string' ? JSON.parse(q.optionsEn) : q.optionsEn;
          } catch (e) {
            optionsEn = q.optionsEn;
          }
        }
        return { ...q, options, optionsEn };
      });
    }

    // Attach questionsCount to modules, subModules, and subExams for instant frontend display
    const enrichedModules = (exam.modules || []).map((module: any) => ({
      ...module,
      questionsCount: module._count?.questions || 0,
      subModules: (module.subModules || []).map((sm: any) => ({
        ...sm,
        questionsCount: sm._count?.questions || 0,
        subExams: (sm.subExams || []).map((subExam: any) => ({
          ...subExam,
          questionsCount: subExam._count?.questions || 0,
          questions: subExam.questions || []
        }))
      })),
      subExams: (module.subExams || []).map((subExam: any) => ({
        ...subExam,
        questionsCount: subExam._count?.questions || 0,
        questions: subExam.questions || []
      }))
    }));

    // If student, hide correct answers
    const activePassword = resolveExamAccessPassword(exam, selectedSubExam);

    if ((req as any).user.role === 'STUDENT') {
      const sanitizedQuestions = parsedQuestions.map(q => {
        const { correctAnswer, explanation, explanationEn, ...rest } = q;
        return rest;
      });
      return res.json({
        ...sanitizeExam(exam),
        modules: enrichedModules,
        selectedSubExam,
        password: activePassword ? true : null,
        questions: sanitizedQuestions
      });
    }

    res.json({
      ...sanitizeExam(exam),
      modules: enrichedModules,
      selectedSubExam,
      password: activePassword,
      questions: parsedQuestions
    });
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
        modules: {
          include: {
            subExams: true,
            subModules: {
              include: { subExams: true }
            }
          }
        },
        _count: {
          select: { submissions: { where: { userId } } }
        }
      }
    });

    if (!exam) return res.status(404).json({ error: 'الامتحان غير موجود' });
    const selectedSubExam = subExamId
      ? exam.modules.flatMap((module: any) => [
          ...(module.subExams || []),
          ...((module.subModules || []).flatMap((sm: any) => sm.subExams || []))
        ]).find((subExam: any) => subExam.id === subExamId)
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
      select: {
        attemptsAllowed: true,
        isCentral: true,
        schoolId: true,
        schools: { select: { id: true } },
        grade: true,
        grades: true,
        status: true,
        deletedAt: true,
        modules: {
          select: {
            subExams: { where: subExamId ? { id: subExamId } : undefined, select: { attemptsAllowed: true } },
            subModules: {
              select: {
                subExams: { where: subExamId ? { id: subExamId } : undefined, select: { attemptsAllowed: true } }
              }
            }
          }
        }
      }
    });

    if (!exam || exam.deletedAt) return res.status(404).json({ error: 'Exam not found' });
    if ((req as any).user.role === 'STUDENT') {
      const student = await prisma.user.findUnique({ where: { id: userId }, select: { grade: true, schoolId: true } });
      if (!student || !examMatchesStudent(exam, mergeStudentProfile((req as any).user, student))) {
        return res.status(403).json({ error: 'Access denied (Student)' });
      }
    }

    const submissionCount = await prisma.examSubmission.count({
      where: { examId, userId, ...(subExamId ? { subExamId } : {}) }
    });

    const lastSubmission = await prisma.examSubmission.findFirst({
      where: { examId, userId, ...(subExamId ? { subExamId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });

    const allMatchingSubExams = exam?.modules ? exam.modules.flatMap((module: any) => [
      ...(module.subExams || []),
      ...((module.subModules || []).flatMap((sm: any) => sm.subExams || []))
    ]) : [];
    const selectedAttemptsAllowed = allMatchingSubExams[0]?.attemptsAllowed;
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
        modules: {
          include: {
            subExams: true,
            subModules: {
              include: { subExams: true }
            }
          }
        },
        questions: {
          where: { deletedAt: null, ...(subExamId ? { subExamId } : {}) },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, points: true, correctAnswer: true, type: true, order: true, xpPoints: true, options: true, subExamId: true }
        }
      }
    });

    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    const selectedSubExam = subExamId
      ? exam.modules.flatMap((module: any) => [
          ...(module.subExams || []),
          ...((module.subModules || []).flatMap((sm: any) => sm.subExams || []))
        ]).find((subExam: any) => subExam.id === subExamId)
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

    const submittedAnswerMap = new Map<string, any>();
    for (const answer of answers) if (!submittedAnswerMap.has(answer.questionId)) submittedAnswerMap.set(answer.questionId, answer);
    exam.questions.forEach(q => {
      maxPossibleScore += q.points;
      const studentAnswer = submittedAnswerMap.get(q.id);
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

    const gradedAnswerMap = new Map(studentAnswersData.map(answer => [answer.questionId, answer]));
    sortedQuestions.forEach(q => {
      const sa = gradedAnswerMap.get(q.id);
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
      include: (exam.resultVisibility === 'SHOW_ANSWERS' || exam.resultVisibility === 'SHOW_ALL')
        ? { answers: { include: { question: true } } } : undefined
    });

    // Save XPHistory log entries in bulk
    const xpHistoryData = exam.questions.map(q => {
      const sa = gradedAnswerMap.get(q.id);
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
    await invalidateCache(`student_stats_${userId}`);

    res.json({
      message: 'Exam submitted successfully',
      submissionId: submission.id,
      score: totalScore,
      percentage: percentage,
      earnedXP: regularXP,
      bonusXP,
      currentStreak: isFirstExamAttempt ? maxStreak : 0,
      resultVisibility: exam.resultVisibility,
      details: (exam.resultVisibility === 'SHOW_ANSWERS' || exam.resultVisibility === 'SHOW_ALL') ? (submission as any).answers : null
    });
  } catch (error: any) {
    console.error(' Submission error:', error);
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
        exam: true,
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
      const relevantQuestions = targetAnswers.map((answer: any) => answer.question)
        .filter((question: any) => !targetSubmission.subExamId || question.subExamId === targetSubmission.subExamId);

      const previousAttemptsCount = await prisma.examSubmission.count({
        where: {
          userId: targetSubmission.userId,
          examId: targetSubmission.examId,
          subExamId: targetSubmission.subExamId || null,
          createdAt: { lt: targetSubmission.createdAt }
        }
      });
      const isFirstAttemptForThisSubmission = previousAttemptsCount === 0;

      return calculateSubmissionStats(relevantQuestions, targetAnswers, isFirstAttemptForThisSubmission);
    };

    const gradedAnswers = submission.answers.map(ans => {
      let options = [];
      try {
        options = typeof ans.question.options === 'string' ? JSON.parse(ans.question.options) : ans.question.options;
      } catch (e) {
        options = [];
      }

      let optionsEn: any[] = [];
      try {
        optionsEn = typeof ans.question.optionsEn === 'string' ? JSON.parse(ans.question.optionsEn || '[]') : (Array.isArray(ans.question.optionsEn) ? ans.question.optionsEn : []);
      } catch { optionsEn = []; }

      const dynamicIsCorrect = ans.isCorrect || isAnswerCorrect(ans.question, ans.selectedAnswer);

      return {
        ...ans,
        isCorrect: dynamicIsCorrect,
        question: {
          ...ans.question,
          options,
          optionsEn,
          explanationEn: ans.question.explanationEn || null
        }
      };
    });

    const submissionXpStats = await buildSubmissionXpStats(submission, gradedAnswers);
    const dynamicPercentage = submissionXpStats.totalPoints > 0 ? (submissionXpStats.dynamicTotalScore / submissionXpStats.totalPoints) * 100 : 0;

    if (typeof (prisma as any)?.examSubmission?.update === 'function' && (Math.abs(dynamicPercentage - (submission.percentage || 0)) > 0.01 || Math.abs(submissionXpStats.dynamicTotalScore - submission.totalScore) > 0.01)) {
      (prisma.examSubmission as any).update({
        where: { id: submission.id },
        data: {
          totalScore: submissionXpStats.dynamicTotalScore,
          percentage: dynamicPercentage
        }
      }).catch(() => {});
    }

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

      const sanitizedAnswers = gradedAnswers.map(ans => {
        const baseAnswer = {
          id: ans.id,
          selectedAnswer: ans.selectedAnswer,
          isCorrect: ans.isCorrect,
          question: {
            id: ans.question.id,
            text: ans.question.text,
            textEn: ans.question.textEn || null,
            type: ans.question.type,
            label: (ans.question as any).label || null,
            imageUrl: ans.question.imageUrl || null,
            domain: ans.question.domain || null,
            standard: ans.question.standard || null,
            indicator: ans.question.indicator || null,
            learningOutcome: ans.question.learningOutcome || null,
            skill: ans.question.skill || null,
            subskill: ans.question.subskill || null,
            microSkill: ans.question.microSkill || null,
            dok: ans.question.dok || null,
            level: ans.question.level || null,
            cognitive: ans.question.cognitive || null,
            errorPattern: ans.question.errorPattern || null,
            options: ans.question.options,
            optionsEn: ans.question.optionsEn,
            points: ans.question.points,
            explanation: (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') ? ans.question.explanation : null,
            explanationEn: (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') ? (ans.question.explanationEn || null) : null
          }
        };

        if (policy === 'SHOW_ANSWERS' || policy === 'SHOW_ALL') {
          return {
            ...baseAnswer,
            question: {
              ...baseAnswer.question,
              correctAnswer: ans.question.correctAnswer,
              correctAnswerEn: (ans.question as any).correctAnswerEn || null,
            }
          };
        }

        if (policy === 'SHOW_MARK_ONLY') {
          return baseAnswer;
        }

        return { id: ans.id };
      });

      const safeExam = { ...submission.exam } as any;
      safeExam.totalPoints = submissionXpStats.totalPoints;

      if (subExamDetails) {
        safeExam.title = subExamDetails.title || safeExam.title;
        safeExam.passingScore = resolvePassingScore(safeExam.passingScore, subExamDetails.passingScore);
        safeExam.duration = subExamDetails.duration;
      }

      delete safeExam.questions;

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
    if (subExamDetails) {
      (submission as any).exam.title = subExamDetails.title || (submission as any).exam.title;
      (submission as any).exam.passingScore = resolvePassingScore(
        (submission as any).exam.passingScore,
        subExamDetails.passingScore,
      );
      (submission as any).exam.duration = subExamDetails.duration;
    }
    (submission as any).exam.totalPoints = submissionXpStats.totalPoints;

    res.json({
      ...submission,
      subExam: subExamDetails,
      totalScore: submissionXpStats.dynamicTotalScore,
      percentage: dynamicPercentage,
      answers: gradedAnswers,
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
    console.error(' Restore exam error:', error);
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
    console.error(' Restore question error:', error);
    res.status(500).json({ error: 'Error restoring question' });
  }
};


export const postExamHandler18 = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, order, duration, passingScore, parentModuleId } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    const exam = await prisma.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    if (!await canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
    }

    if (parentModuleId) {
      const parentMod = await prisma.examModule.findFirst({ where: { id: parentModuleId, examId: id } });
      if (!parentMod) {
        return res.status(400).json({ error: 'Specified parent module not found in this exam.' });
      }
    }

    const module = await prisma.examModule.create({
      data: {
        examId: id,
        parentModuleId: parentModuleId ? String(parentModuleId).trim() : null,
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
    const { title, description, order, duration, passingScore, gradeTarget, parentModuleId, publishDate, cutOffDate } = req.body;

    const exam = await prisma.exam.findUnique({ where: { id }, include: { schools: { select: { id: true } } } });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });

    if (!await canManageExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to modify this exam.' });
    }

    if (parentModuleId !== undefined && parentModuleId !== null) {
      if (parentModuleId === moduleId) {
        return res.status(400).json({ error: 'Cannot set a module as its own parent.' });
      }
      const parentMod = await prisma.examModule.findFirst({ where: { id: parentModuleId, examId: id } });
      if (!parentMod) {
        return res.status(400).json({ error: 'Specified parent module not found in this exam.' });
      }
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
        parentModuleId: parentModuleId !== undefined ? (parentModuleId ? String(parentModuleId).trim() : null) : undefined,
        publishDate: publishDate !== undefined ? (publishDate ? new Date(publishDate) : null) : undefined,
        cutOffDate: cutOffDate !== undefined ? (cutOffDate ? new Date(cutOffDate) : null) : undefined,
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
      select: { id: true, text: true },
    });

    if (sourceQuestions.length > 0) {
      // Check existing questions in target subExam to prevent duplicating questions into the subExam
      const existingInTarget = await prisma.question.findMany({
        where: {
          examId: id,
          moduleId,
          subExamId,
          deletedAt: null,
        },
        select: { id: true, text: true },
      });

      const targetSignatures = new Set(
        existingInTarget.map((q) => robustNormalizeText(q.text)).filter((t) => t.length > 5)
      );

      const questionsToMove: string[] = [];
      for (const q of sourceQuestions) {
        const sig = robustNormalizeText(q.text);
        if (sig && targetSignatures.has(sig)) {
          // Check if this source question has any student answers
          const answerCount = await prisma.studentAnswer.count({ where: { questionId: q.id } });
          if (answerCount === 0) {
            // It's a duplicate question with 0 answers; remove it from active questions
            await prisma.question.update({
              where: { id: q.id },
              data: { deletedAt: new Date() },
            });
            continue;
          }
        }
        questionsToMove.push(q.id);
      }

      if (questionsToMove.length > 0) {
        await prisma.question.updateMany({
          where: { id: { in: questionsToMove } },
          data: { moduleId, subExamId },
        });
      }
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

export const postMoveSubExamHandler = async (req: Request, res: Response) => {
  try {
    const { id, moduleId, subExamId } = req.params;
    const { targetModuleId, newModuleTitle, targetExamId } = req.body || {};

    const trimmedNewTitle = newModuleTitle ? String(newModuleTitle).trim() : '';
    if (!targetModuleId && !trimmedNewTitle) {
      return res.status(400).json({ error: 'Either targetModuleId or newModuleTitle is required.' });
    }

    const sourceModule = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true, title: true }
    });
    if (!sourceModule) {
      return res.status(404).json({ error: 'Source module not found in this exam.' });
    }

    const subExam = await prisma.subExam.findFirst({
      where: { id: subExamId, moduleId },
      include: {
        _count: {
          select: { questions: { where: { deletedAt: null } } }
        }
      }
    });
    if (!subExam) {
      return res.status(404).json({ error: 'Exam not found inside source module.' });
    }

    let destinationModuleId = targetModuleId ? String(targetModuleId).trim() : '';
    let destinationExamId = id;

    const result = await prisma.$transaction(async (tx) => {
      if (trimmedNewTitle) {
        const destExamId = targetExamId ? String(targetExamId).trim() : id;
        destinationExamId = destExamId;

        if (destExamId !== id) {
          const destExam = await tx.exam.findUnique({
            where: { id: destExamId },
            include: { schools: { select: { id: true } } }
          });
          if (!destExam) {
            throw new Error('Destination exam not found.');
          }
          if (!await canManageExam((req as any).user, destExam)) {
            throw new Error('Access denied: You do not have permission to add modules to destination exam.');
          }
        }

        const lastModule = await tx.examModule.findFirst({
          where: { examId: destExamId },
          orderBy: { order: 'desc' },
          select: { order: true }
        });
        const nextOrder = (lastModule?.order ?? -1) + 1;

        const createdModule = await tx.examModule.create({
          data: {
            examId: destExamId,
            title: sanitizeHtml(trimmedNewTitle),
            order: nextOrder,
          }
        });
        destinationModuleId = createdModule.id;
      } else {
        const targetMod = await tx.examModule.findUnique({
          where: { id: destinationModuleId },
          include: { exam: { include: { schools: { select: { id: true } } } } }
        });
        if (!targetMod) {
          throw new Error('Destination module not found.');
        }
        if (targetMod.id === moduleId) {
          throw new Error('Destination module cannot be the same as the current module.');
        }
        destinationExamId = targetMod.examId;

        if (destinationExamId !== id) {
          if (!await canManageExam((req as any).user, targetMod.exam)) {
            throw new Error('Access denied: You do not have permission to move to destination exam.');
          }
        }
      }

      const destSubExamsCount = await tx.subExam.count({
        where: { moduleId: destinationModuleId }
      });

      const updatedSubExam = await tx.subExam.update({
        where: { id: subExamId },
        data: {
          moduleId: destinationModuleId,
          order: destSubExamsCount,
        }
      });

      const updatedQuestions = await tx.question.updateMany({
        where: {
          examId: id,
          subExamId: subExamId,
        },
        data: {
          examId: destinationExamId,
          moduleId: destinationModuleId,
        }
      });

      const destinationModule = await tx.examModule.findUnique({
        where: { id: destinationModuleId },
        include: {
          subExams: {
            orderBy: { order: 'asc' }
          }
        }
      });

      return {
        subExam: updatedSubExam,
        destinationModule,
        destinationExamId,
        movedQuestionsCount: updatedQuestions.count,
        isNewModule: Boolean(trimmedNewTitle),
        isCrossExam: destinationExamId !== id,
      };
    });

    res.json({
      success: true,
      message: 'Exam and its questions moved successfully.',
      ...result,
    });
  } catch (error: any) {
    console.error('Error moving subExam to module:', error);
    res.status(400).json({ error: error?.message || 'Failed to move exam to destination module.' });
  }
};

export const postMoveAllSubExamsHandler = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const { targetModuleId, newModuleTitle, targetExamId } = req.body || {};

    const trimmedNewTitle = newModuleTitle ? String(newModuleTitle).trim() : '';
    if (!targetModuleId && !trimmedNewTitle) {
      return res.status(400).json({ error: 'Either targetModuleId or newModuleTitle is required.' });
    }

    const sourceModule = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      select: { id: true, title: true }
    });
    if (!sourceModule) {
      return res.status(404).json({ error: 'Source module not found in this exam.' });
    }

    const subExams = await prisma.subExam.findMany({
      where: { moduleId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true }
    });

    if (subExams.length === 0) {
      return res.status(400).json({ error: 'No sub-exams found in this module to move.' });
    }

    const subExamIds = subExams.map((s) => s.id);

    let destinationModuleId = targetModuleId ? String(targetModuleId).trim() : '';
    let destinationExamId = id;
    let targetMod: any = null;

    const result = await prisma.$transaction(async (tx) => {
      if (trimmedNewTitle) {
        const destExamId = targetExamId ? String(targetExamId).trim() : id;
        destinationExamId = destExamId;

        if (destExamId !== id) {
          const destExam = await tx.exam.findUnique({
            where: { id: destExamId },
            include: { schools: { select: { id: true } } }
          });
          if (!destExam) {
            throw new Error('Destination exam not found.');
          }
          if (!await canManageExam((req as any).user, destExam)) {
            throw new Error('Access denied: You do not have permission to add modules to destination exam.');
          }
        }

        const lastModule = await tx.examModule.findFirst({
          where: { examId: destExamId },
          orderBy: { order: 'desc' },
          select: { order: true }
        });
        const nextOrder = (lastModule?.order ?? -1) + 1;

        const createdModule = await tx.examModule.create({
          data: {
            examId: destExamId,
            title: sanitizeHtml(trimmedNewTitle),
            order: nextOrder,
          }
        });
        destinationModuleId = createdModule.id;
      } else {
        targetMod = await tx.examModule.findUnique({
          where: { id: destinationModuleId },
          include: { exam: { include: { schools: { select: { id: true } } } } }
        });
        if (!targetMod) {
          throw new Error('Destination module not found.');
        }
        if (targetMod.id === moduleId) {
          throw new Error('Destination module cannot be the same as the current module.');
        }
        destinationExamId = targetMod.examId;

        if (destinationExamId !== id) {
          if (!await canManageExam((req as any).user, targetMod.exam)) {
            throw new Error('Access denied: You do not have permission to move to destination exam.');
          }
        }
      }

      const destSubExamsCount = await tx.subExam.count({
        where: { moduleId: destinationModuleId }
      });

      const destModule = targetMod || (await tx.examModule.findUnique({ where: { id: destinationModuleId } }));
      const targetModSettings = {
        publishDate: destModule?.publishDate ?? null,
        cutOffDate: destModule?.cutOffDate ?? null,
        ...(destModule?.duration !== null && destModule?.duration !== undefined ? { duration: destModule.duration } : {}),
        ...(destModule?.passingScore !== null && destModule?.passingScore !== undefined ? { passingScore: destModule.passingScore } : {}),
      };

      // Update each subExam to destinationModuleId maintaining their sequential order and inheriting parent settings
      for (let i = 0; i < subExams.length; i++) {
        await tx.subExam.update({
          where: { id: subExams[i].id },
          data: {
            moduleId: destinationModuleId,
            order: destSubExamsCount + i,
            ...targetModSettings,
          }
        });
      }

      // Update all questions attached to these subExams
      const updatedQuestions = await tx.question.updateMany({
        where: {
          examId: id,
          subExamId: { in: subExamIds },
        },
        data: {
          examId: destinationExamId,
          moduleId: destinationModuleId,
          ...(destModule?.gradeTarget ? { gradeTarget: destModule.gradeTarget } : {}),
        }
      });

      // If cross-exam transfer, update exam submissions
      if (destinationExamId !== id) {
        await tx.examSubmission.updateMany({
          where: {
            subExamId: { in: subExamIds }
          },
          data: {
            examId: destinationExamId
          }
        });

        const remainingModules = await tx.examModule.count({ where: { examId: id } });
        const remainingQuestions = await tx.question.count({ where: { examId: id, deletedAt: null } });
        if (remainingModules === 0 && remainingQuestions === 0) {
          await tx.exam.update({ where: { id }, data: { deletedAt: new Date() } });
        }
      }

      const destinationModule = await tx.examModule.findUnique({
        where: { id: destinationModuleId },
        include: {
          subExams: {
            orderBy: { order: 'asc' }
          }
        }
      });

      return {
        movedSubExamsCount: subExams.length,
        movedQuestionsCount: updatedQuestions.count,
        destinationModule,
        destinationExamId,
        isNewModule: Boolean(trimmedNewTitle),
        isCrossExam: destinationExamId !== id,
      };
    });

    res.json({
      success: true,
      message: 'All sub-exams and their questions moved successfully.',
      ...result,
    });
  } catch (error: any) {
    console.error('Error moving all subExams to module:', error);
    res.status(400).json({ error: error?.message || 'Failed to move all sub-exams to destination module.' });
  }
};

export const postMoveModuleHandler = async (req: Request, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const { targetExamId, targetParentModuleId, newParentModuleTitle } = req.body || {};

    const sourceModule = await prisma.examModule.findFirst({
      where: { id: moduleId, examId: id },
      include: {
        subExams: true,
        questions: { where: { deletedAt: null } },
        subModules: true,
      }
    });

    if (!sourceModule) {
      return res.status(404).json({ error: 'Source module not found in this exam.' });
    }

    let destinationExamId = targetExamId ? String(targetExamId).trim() : id;
    let destinationParentModuleId: string | null = targetParentModuleId ? String(targetParentModuleId).trim() : null;

    if (destinationParentModuleId === moduleId) {
      return res.status(400).json({ error: 'Cannot move a module inside itself.' });
    }

    // Verify destination exam access if moving cross-exam
    if (destinationExamId !== id) {
      const destExam = await prisma.exam.findUnique({
        where: { id: destinationExamId },
        include: { schools: { select: { id: true } } }
      });
      if (!destExam) {
        return res.status(404).json({ error: 'Destination exam not found.' });
      }
      if (!await canManageExam((req as any).user, destExam)) {
        return res.status(403).json({ error: 'Access denied: You do not have permission to move to destination exam.' });
      }
    }

    const trimmedNewTitle = newParentModuleTitle ? String(newParentModuleTitle).trim() : '';

    const result = await prisma.$transaction(async (tx) => {
      let inheritedSettings: any = {};

      // If user wants to create a new Main Module to receive this module
      if (trimmedNewTitle) {
        const lastMod = await tx.examModule.findFirst({
          where: { examId: destinationExamId, parentModuleId: null },
          orderBy: { order: 'desc' },
          select: { order: true }
        });
        const nextOrder = (lastMod?.order ?? -1) + 1;

        const destExam = await tx.exam.findUnique({ where: { id: destinationExamId } });
        const createdParent = await tx.examModule.create({
          data: {
            examId: destinationExamId,
            title: sanitizeHtml(trimmedNewTitle),
            order: nextOrder,
            parentModuleId: null,
            duration: destExam?.duration ?? null,
            passingScore: destExam?.passingScore ?? null,
            gradeTarget: destExam?.grade ?? null,
            publishDate: destExam?.startDate ?? null,
            cutOffDate: destExam?.endDate ?? null,
          }
        });
        destinationParentModuleId = createdParent.id;
        inheritedSettings = {
          duration: createdParent.duration,
          passingScore: createdParent.passingScore,
          gradeTarget: createdParent.gradeTarget,
          publishDate: createdParent.publishDate,
          cutOffDate: createdParent.cutOffDate,
        };
      } else if (destinationParentModuleId) {
        // Verify target parent module exists
        const targetParent = await tx.examModule.findUnique({
          where: { id: destinationParentModuleId }
        });
        if (!targetParent) {
          throw new Error('Destination parent module not found.');
        }
        // Check cycle: ensure destinationParentModuleId is not a child of sourceModule
        let checkParent: any = targetParent;
        while (checkParent && checkParent.parentModuleId) {
          if (checkParent.parentModuleId === moduleId) {
            throw new Error('Cannot move a module into one of its own sub-modules (cycle detected).');
          }
          checkParent = await tx.examModule.findUnique({ where: { id: checkParent.parentModuleId } });
        }
        destinationExamId = targetParent.examId;
        inheritedSettings = {
          duration: targetParent.duration,
          passingScore: targetParent.passingScore,
          gradeTarget: targetParent.gradeTarget,
          publishDate: targetParent.publishDate,
          cutOffDate: targetParent.cutOffDate,
        };
      }

      // Calculate next order in destination parent
      const lastSibling = await tx.examModule.findFirst({
        where: {
          examId: destinationExamId,
          parentModuleId: destinationParentModuleId
        },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      const nextSiblingOrder = (lastSibling?.order ?? -1) + 1;

      // Update sourceModule with destination and inherited parent settings
      const updatedModule = await tx.examModule.update({
        where: { id: moduleId },
        data: {
          examId: destinationExamId,
          parentModuleId: destinationParentModuleId,
          order: nextSiblingOrder,
          ...inheritedSettings,
        }
      });

      // Collect all descendant module IDs recursively
      const collectModuleIds = async (mId: string): Promise<string[]> => {
        const children = await tx.examModule.findMany({ where: { parentModuleId: mId }, select: { id: true } });
        const childIds = children.map(c => c.id);
        let allDescendants = [...childIds];
        for (const cId of childIds) {
          allDescendants = allDescendants.concat(await collectModuleIds(cId));
        }
        return allDescendants;
      };

      const allModuleIds = [moduleId, ...(await collectModuleIds(moduleId))];

      // If moving as a sub-module, update all descendant modules and sub-exams to inherit parent settings
      if (destinationParentModuleId) {
        if (allModuleIds.length > 1) {
          await tx.examModule.updateMany({
            where: { id: { in: allModuleIds.filter(mid => mid !== moduleId) } },
            data: {
              ...inheritedSettings,
            }
          });
        }

        await tx.subExam.updateMany({
          where: { moduleId: { in: allModuleIds } },
          data: {
            publishDate: inheritedSettings.publishDate,
            cutOffDate: inheritedSettings.cutOffDate,
            ...(inheritedSettings.duration !== null && inheritedSettings.duration !== undefined ? { duration: inheritedSettings.duration } : {}),
            ...(inheritedSettings.passingScore !== null && inheritedSettings.passingScore !== undefined ? { passingScore: inheritedSettings.passingScore } : {}),
          }
        });

        if (inheritedSettings.gradeTarget) {
          await tx.question.updateMany({
            where: { moduleId: { in: allModuleIds } },
            data: { gradeTarget: inheritedSettings.gradeTarget }
          });
        }
      }

      // If cross-exam transfer, update all nested entities
      if (destinationExamId !== id) {
        // Update all descendant modules examId
        await tx.examModule.updateMany({
          where: { id: { in: allModuleIds } },
          data: { examId: destinationExamId }
        });

        // Find all subExams under these modules
        const affectedSubExams = await tx.subExam.findMany({
          where: { moduleId: { in: allModuleIds } },
          select: { id: true }
        });
        const subExamIds = affectedSubExams.map(s => s.id);

        // Update questions
        await tx.question.updateMany({
          where: {
            OR: [
              { moduleId: { in: allModuleIds } },
              { subExamId: { in: subExamIds } }
            ]
          },
          data: { examId: destinationExamId }
        });

        // Update student submissions
        if (subExamIds.length > 0) {
          await tx.examSubmission.updateMany({
            where: { subExamId: { in: subExamIds } },
            data: { examId: destinationExamId }
          });
        }

        // If source exam is now empty, clean it up so no orphaned shell card remains
        const remainingModules = await tx.examModule.count({ where: { examId: id } });
        const remainingQuestions = await tx.question.count({ where: { examId: id, deletedAt: null } });
        if (remainingModules === 0 && remainingQuestions === 0) {
          await tx.exam.update({ where: { id }, data: { deletedAt: new Date() } });
        }
      }

      return {
        module: updatedModule,
        destinationExamId,
        destinationParentModuleId,
        isCrossExam: destinationExamId !== id,
      };
    });

    res.json({
      success: true,
      message: 'Module moved successfully.',
      ...result,
    });
  } catch (error: any) {
    console.error('Error moving module:', error);
    res.status(400).json({ error: error?.message || 'Failed to move module.' });
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
        textEn: question.textEn,
        type: question.type,
        options: question.options,
        optionsEn: question.optionsEn,
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
        explanationEn: question.explanationEn,
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
            textEn: question.textEn ? extractAndSaveBase64Images(sanitizeHtml(question.textEn)) : null,
            type: ["MCQ", "TRUE_FALSE", "MULTI_SELECT", "FLASH_CARD", "FILL_BLANK", "ESSAY", "VIDEO_RESPONSE", "AUDIO_RESPONSE", "MATCHING", "ORDERING", "TEXT", "IMAGE", "VIDEO"].includes(question.type) ? sanitizeHtml(question.type) : 'MCQ',
            options: extractAndSaveBase64Images(typeof question.options === 'string' ? question.options : JSON.stringify(question.options || [])),
            optionsEn: question.optionsEn ? extractAndSaveBase64Images(typeof question.optionsEn === 'string' ? question.optionsEn : JSON.stringify(question.optionsEn || [])) : null,
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
            explanationEn: question.explanationEn ? extractAndSaveBase64Images(sanitizeHtml(question.explanationEn)) : null,
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
    const validSections = q.sections.filter((s: any) => s && (
      String(s.content || s.text || '').trim() !== '' ||
      String(s.contentEn || s.textEn || '').trim() !== ''
    ));
    if (validSections.length > 0) {
      const sanitizedValid = validSections.map((s: any) => ({
        ...s,
        content: s.content ? sanitizeHtml(s.content) : s.content,
        text: s.text ? sanitizeHtml(s.text) : s.text,
        contentEn: s.contentEn ? sanitizeHtml(s.contentEn) : s.contentEn,
        textEn: s.textEn ? sanitizeHtml(s.textEn) : s.textEn,
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
    //  SECURITY FIX: Always sanitize HTML regardless of input type.
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
        const valid = parsed.filter((s: any) => s && (
          String(s.content || s.text || '').trim() !== '' ||
          String(s.contentEn || s.textEn || '').trim() !== ''
        ));
        if (valid.length === 0) return null;
        // sanitize each text/content field within array items
        const sanitizedValid = valid.map((s: any) => ({
          ...s,
          content: s.content ? sanitizeHtml(s.content) : s.content,
          text: s.text ? sanitizeHtml(s.text) : s.text,
          contentEn: s.contentEn ? sanitizeHtml(s.contentEn) : s.contentEn,
          textEn: s.textEn ? sanitizeHtml(s.textEn) : s.textEn,
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

export const cleanDuplicatesHandler = async (req: Request, res: Response) => {
  try {
    const userRole = (req as any).user?.role;
    let examId: string | undefined = undefined;

    if (req.params.id) {
      if (req.body?.examId && String(req.body.examId) !== String(req.params.id)) {
        return res.status(400).json({ error: 'Mismatched exam ID between path and body parameters.' });
      }
      examId = String(req.params.id);
    } else if (userRole === 'SUPER_ADMIN') {
      examId = req.body?.examId ? String(req.body.examId) : undefined;
    } else {
      return res.status(403).json({ error: 'Exam ID path parameter is required.' });
    }

    const result = await runSafeDeduplicationAndEmptyCleanup(examId);
    return res.json({
      success: true,
      message: `تم تنظيف ${result.duplicatesDeleted} سؤال مكرر و ${result.emptyQuestionsDeleted} سؤال فارغ بنجاح!`,
      ...result,
    });
  } catch (err: any) {
    console.error('cleanDuplicatesHandler error:', err);
    return res.status(500).json({ error: err.message || 'Failed to clean duplicates' });
  }
};
