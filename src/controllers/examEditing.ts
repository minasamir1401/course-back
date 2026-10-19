import { metadataTranslations } from '../utils/bilingualMetadata';
import { generateReport, ReportError } from '../services/reporting.service';
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
import { buildSubmissionSnapshot, snapshotQuestion, historicalSubmission } from '../utils/submissionSnapshot';
import { attemptPassed } from '../utils/reportMetrics';

export const getExamHandler9 = async (req: Request, res: Response) => {
  try {
    const { exportRows, ...report } = await generateReport((req as any).user, { ...req.query, examId: req.params.id });
    res.json({ ...report, overall: { totalSubmissions: report.summary.selectedAttempts, uniqueStudents: report.summary.uniqueStudents,
      totalAttempts: report.summary.totalAttempts, passRate: report.summary.passRate, avgScore: report.summary.averageScore },
      schools: report.schools.map(school => ({ ...school, count: school.uniqueStudents, avgScore: school.averageScore })) });
  } catch (error: any) { res.status(error instanceof ReportError ? error.status : 500).json({ error: error.message || 'Failed to generate analytics' }); }
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
      const canAccessExam = await canViewExam((req as any).user, exam);
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
      let sections: any[] = [];
      if (q.explanation) {
        try {
          const parsed = JSON.parse(q.explanation);
          if (Array.isArray(parsed)) {
            sections = role === 'STUDENT' ? parsed.filter((s: any) => s && s.type === 'HINT') : parsed;
          }
        } catch {}
      }
      if (role === 'STUDENT') {
        const { correctAnswer, explanation, explanationEn, ...rest } = q;
        return { ...rest, options, optionsEn, sections };
      }
      return { ...q, options, optionsEn, sections };
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
        _count: { select: { questions: { where: { deletedAt: null } } } },
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
      const canAccessExam = await canViewExam((req as any).user, exam);
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
        let sections: any[] = [];
        if (q.explanation) {
          try {
            const parsed = JSON.parse(q.explanation);
            if (Array.isArray(parsed)) {
              sections = role === 'STUDENT' ? parsed.filter((s: any) => s && s.type === 'HINT') : parsed;
            }
          } catch {}
        }
        if (role === 'STUDENT') {
          const { correctAnswer, explanation, explanationEn, ...rest } = q;
          return { ...rest, options, optionsEn, sections };
        }
        return { ...q, options, optionsEn, sections };
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
        questionsCount: (exam as any)._count?.questions ?? parsedQuestions.length,
        // Only the current student's attempt identities; never expose answers or other students.
        submissions: !includeQuestions ? await prisma.examSubmission.findMany({
          where: { examId: id, userId },
          select: { id: true, subExamId: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        }) : undefined,
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
        id: true, title: true, type: true, subjects: true, passingScore: true, attemptsAllowed: true, isCentral: true, schoolId: true,
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

    const studentContext = await prisma.user.findUnique({
      where: { id: userId },
      select: { schoolId: true, grade: true, classroomId: true, school: { select: { name: true } } },
    });
    const reportSnapshot = buildSubmissionSnapshot(exam, selectedSubExam, studentContext, exam.questions, studentAnswersData, percentage, totalXPToAward);
    const questionSnapshots = new Map(exam.questions.map(question => [question.id, snapshotQuestion(question)]));
    const submission = await prisma.examSubmission.create({
      data: {
        examId,
        subExamId,
        userId,
        totalScore,
        percentage,
        totalTime: totalTime != null && totalTime !== '' && Number.isFinite(Number(totalTime)) ? Math.max(0, Math.min(Math.floor(Number(totalTime)), 86400)) : null,
        reportSnapshot,
        schoolIdAtSubmission: studentContext?.schoolId || null,
        gradeAtSubmission: studentContext?.grade || null,
        answers: {
          create: studentAnswersData.map(a => ({
            userId,
            questionId: a.questionId,
            selectedAnswer: a.selectedAnswer,
            isCorrect: a.isCorrect,
            questionSnapshot: questionSnapshots.get(a.questionId)
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
      ...(exam.resultVisibility === 'HIDE_ALL' ? {} : { score: totalScore, percentage }),
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

    if (subExamDetails && submission.reportSnapshot) {
      const saved = submission.reportSnapshot as any;
      subExamDetails = { ...subExamDetails, title: saved.examTitle || subExamDetails.title, passingScore: saved.passingScore ?? subExamDetails.passingScore };
    }

    // Authorization check
    const role = (req as any).user.role;
    if (!['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'SUPERVISOR', 'STUDENT'].includes(role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'STUDENT' && submission.userId !== (req as any).user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (role === 'SCHOOL_ADMIN' && (submission.schoolIdAtSubmission || submission.user.schoolId) !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if ((role === 'TEACHER' || role === 'SUPERVISOR') && (submission.schoolIdAtSubmission || submission.user.schoolId) !== (req as any).user.schoolId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const history = historicalSubmission(submission);
    const gradedAnswers = history.answers.map((ans: any) => {
      const parseOptions = (value: any) => { try { return typeof value === 'string' ? JSON.parse(value) : value || []; } catch { return []; } };
      return { ...ans, question: { ...ans.question, options: parseOptions(ans.question?.options), optionsEn: parseOptions(ans.question?.optionsEn) } };
    });
    const submissionXpStats = {
      ...history, dynamicTotalScore: history.totalScore,
      earnedXP: (submission.reportSnapshot as any)?.earnedXP ?? null,
    };
    const dynamicPercentage = history.percentage;
    (submission as any).exam.passingScore = (submission.reportSnapshot as any)?.passingScore
      ?? resolvePassingScore(submission.exam.passingScore, subExamDetails?.passingScore);
    (submission as any).exam.title = (submission.reportSnapshot as any)?.examTitle || subExamDetails?.title || submission.exam.title;
    const passed = attemptPassed({ ...submission, percentage: dynamicPercentage, correctAnswers: history.correctAnswers, totalQuestions: history.totalQuestions });

    // Apply Result Policy for Students
    if ((req as any).user.role === 'STUDENT') {
      const policy = submission.exam.resultVisibility;
      // Result metadata must never disclose access passwords.
      if (subExamDetails) { const { password: _password, ...safeChild } = subExamDetails; subExamDetails = safeChild as any; }

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

      const sanitizedAnswers = gradedAnswers.map((ans: any) => {
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
            ...metadataTranslations(ans.question),
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
        safeExam.title = (submission.reportSnapshot as any)?.examTitle || subExamDetails.title || safeExam.title;
        safeExam.passingScore = (submission.reportSnapshot as any)?.passingScore ?? resolvePassingScore(safeExam.passingScore, subExamDetails.passingScore);
        safeExam.duration = subExamDetails.duration;
      }

      delete safeExam.questions;
      delete safeExam.password;

      return res.json({
        ...submission,
        historicalSnapshot: Boolean(submission.reportSnapshot),
        passed,
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
      (submission as any).exam.title = (submission.reportSnapshot as any)?.examTitle || subExamDetails.title || (submission as any).exam.title;
      (submission as any).exam.passingScore = (submission.reportSnapshot as any)?.passingScore ?? resolvePassingScore(
        (submission as any).exam.passingScore,
        subExamDetails.passingScore,
      );
      (submission as any).exam.duration = subExamDetails.duration;
    }
    (submission as any).exam.totalPoints = submissionXpStats.totalPoints;

    res.json({
      ...submission,
      subExam: subExamDetails,
      historicalSnapshot: Boolean(submission.reportSnapshot),
      passed,
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
    if (!await canViewExam((req as any).user, exam)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const where: any = { examId: id, user: { role: 'STUDENT', deletedAt: null } };
    if ((req as any).user.role === 'SCHOOL_ADMIN' || (req as any).user.role === 'TEACHER') {
      where.user.schoolId = (req as any).user.schoolId;
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
      const allowed = await isContentDeletionAllowed();
      if (!allowed) {
        return res.status(403).json({ error: 'حذف الموديولات والمحتوى معطّل حالياً من قِبل الإدارة العامة. Content deletion is currently disabled by Super Admin.' });
      }
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
