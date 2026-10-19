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

export const normalizeBackendDok = (raw: any): string | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(?:dok\s*|level\s*|مستوى\s*)?([1-4])(?:\.0)?$/i);
  if (m) return `DOK ${m[1]}`;
  return sanitizeHtml(s);
};

export const resolveUserSchoolId = async (user: any): Promise<string | null> => {
  if (user?.schoolId) return user.schoolId;
  if (user?.id) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { schoolId: true },
      });
      if (dbUser?.schoolId) {
        user.schoolId = dbUser.schoolId;
        return dbUser.schoolId;
      }
    } catch {}
  }
  return null;
};

export const canViewExam = async (
  user: any,
  exam: {
    isCentral?: boolean | null;
    schoolId?: string | null;
    creatorId?: string | null;
    courseId?: string | null;
    schools?: Array<{ id: string }>;
  },
) => {
  if (!user || !exam) return false;
  if (user.role === 'SUPER_ADMIN') return true;

  await resolveUserSchoolId(user);

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
  return canViewExamRecord(user, exam, hasTeacherCourseAccess);
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
  if (!user || !exam) return false;
  if (user.role === 'SUPER_ADMIN') return true;

  await resolveUserSchoolId(user);

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
