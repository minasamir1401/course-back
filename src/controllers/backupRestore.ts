import { metadataTranslations, moduleMetadata, LESSON_METADATA_FIELDS } from '../utils/bilingualMetadata';
import { BACKUPS_DIR, ensureBackupStorage, collectFullSnapshot, writeFullSnapshot, pruneFullSnapshots, restoreSnapshot } from '../lib/backupSnapshot';
import { persistUpload, isCloudStorageActive } from '../lib/storage';
import { CLOUD_BACKUP_ENABLED } from '../lib/db-backup';
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
  normalizeLegacyCourses, externalizeEmbeddedDataImages
} from '../shared';
import { saveToCloudBackup, getCloudBackups, createManualBundle } from '../lib/db-backup';
import { assertSafeArchiveEntries } from '../lib/runtimeSecurity';

export async function restoreExamWithHierarchy(
  tx: any,
  e: any,
  backupData: any,
  targetCourseId?: string | null
) {
  const toDate = (v: any) => (v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null);

  const resolvedCourseId = targetCourseId !== undefined ? targetCourseId : (e.courseId ?? null);
  const ePayload: any = {
    title: e.title ?? 'Untitled',
    description: e.description ?? null,
    type: e.type ?? 'Quiz',
    duration: typeof e.duration === 'number' ? e.duration : (parseInt(e.duration, 10) || 30),
    passingScore: typeof e.passingScore === 'number' ? e.passingScore : (parseInt(e.passingScore, 10) || 50),
    isCentral: e.isCentral ?? false,
    showAnswers: e.showAnswers !== false,
    resultVisibility: e.resultVisibility ?? 'SHOW_SCORE',
    password: e.password ?? null,
    startDate: toDate(e.startDate),
    endDate: toDate(e.endDate),
    attemptsAllowed: typeof e.attemptsAllowed === 'number' ? e.attemptsAllowed : (parseInt(e.attemptsAllowed, 10) || 1),
    status: e.status ?? 'PUBLISHED',
    category: e.category ?? null,
    grade: e.grade ?? null,
    grades: e.grades ?? null,
    subjects: e.subjects ?? null,
    schoolId: e.schoolId ?? null,
    courseId: resolvedCourseId,
    folderId: e.folderId ?? null,
    courseName: e.courseName ?? null,
    section: e.section ?? null,
    domain: e.domain ?? null,
    learningOutcomes: e.learningOutcomes ?? null,
    indicators: e.indicators ?? null,
    skills: e.skills ?? null,
    skill: e.skill ?? null,
    gradeTarget: e.gradeTarget ?? null,
    level: e.level ?? 'Medium',
    creatorId: e.creatorId ?? null,
    deletedAt: null,
    createdAt: toDate(e.createdAt) ?? new Date(),
    updatedAt: toDate(e.updatedAt) ?? new Date()
  };

  await tx.exam.upsert({
    where: { id: e.id },
    update: ePayload,
    create: { id: e.id, ...ePayload }
  });

  // 1. Gather all ExamModules
  const backupModules: any[] = Array.isArray(backupData.examModule) ? backupData.examModule : [];
  const embeddedModules: any[] = Array.isArray(e.modules) ? e.modules : [];
  const allModulesMap = new Map<string, any>();
  for (const m of backupModules) {
    if (m?.examId === e.id) allModulesMap.set(m.id, m);
  }
  for (const m of embeddedModules) {
    if (m?.id) allModulesMap.set(m.id, { ...m, examId: e.id });
    if (Array.isArray(m.subModules)) {
      for (const sm of m.subModules) {
        if (sm?.id) allModulesMap.set(sm.id, { ...sm, examId: e.id, parentModuleId: m.id });
      }
    }
  }

  const modulesList = Array.from(allModulesMap.values());
  const parentModules = modulesList.filter((m: any) => !m.parentModuleId);
  const childModules = modulesList.filter((m: any) => !!m.parentModuleId);

  for (const m of parentModules) {
    const mPayload: any = {
      examId: e.id,
      parentModuleId: null,
      title: m.title || 'Untitled Module',
      description: m.description ?? null,
      order: typeof m.order === 'number' ? m.order : 0,
      duration: m.duration !== undefined && m.duration !== null ? Number(m.duration) : null,
      passingScore: m.passingScore !== undefined && m.passingScore !== null ? Number(m.passingScore) : null,
      ...moduleMetadata(m),
      gradeTarget: m.gradeTarget ?? null,
      publishDate: toDate(m.publishDate),
      cutOffDate: toDate(m.cutOffDate),
      createdAt: toDate(m.createdAt) ?? new Date(),
      updatedAt: toDate(m.updatedAt) ?? new Date()
    };
    await tx.examModule.upsert({
      where: { id: m.id },
      update: mPayload,
      create: { id: m.id, ...mPayload }
    });
  }

  for (const m of childModules) {
    const mPayload: any = {
      examId: e.id,
      parentModuleId: m.parentModuleId,
      title: m.title || 'Untitled Submodule',
      description: m.description ?? null,
      order: typeof m.order === 'number' ? m.order : 0,
      duration: m.duration !== undefined && m.duration !== null ? Number(m.duration) : null,
      passingScore: m.passingScore !== undefined && m.passingScore !== null ? Number(m.passingScore) : null,
      ...moduleMetadata(m),
      gradeTarget: m.gradeTarget ?? null,
      publishDate: toDate(m.publishDate),
      cutOffDate: toDate(m.cutOffDate),
      createdAt: toDate(m.createdAt) ?? new Date(),
      updatedAt: toDate(m.updatedAt) ?? new Date()
    };
    await tx.examModule.upsert({
      where: { id: m.id },
      update: mPayload,
      create: { id: m.id, ...mPayload }
    });
  }

  // 2. Gather and restore SubExams
  const backupSubExams: any[] = Array.isArray(backupData.subExam) ? backupData.subExam : [];
  const allSubExamsMap = new Map<string, any>();
  for (const se of backupSubExams) {
    if (allModulesMap.has(se.moduleId)) allSubExamsMap.set(se.id, se);
  }
  for (const m of modulesList) {
    if (Array.isArray(m.subExams)) {
      for (const se of m.subExams) {
        if (se?.id) allSubExamsMap.set(se.id, { ...se, moduleId: m.id });
      }
    }
  }

  for (const se of allSubExamsMap.values()) {
    const sePayload: any = {
      moduleId: se.moduleId,
      title: se.title || 'Untitled SubExam',
      password: se.password ?? null,
      duration: se.duration !== undefined && se.duration !== null ? Number(se.duration) : null,
      passingScore: se.passingScore !== undefined && se.passingScore !== null ? Number(se.passingScore) : null,
      attemptsAllowed: typeof se.attemptsAllowed === 'number' ? se.attemptsAllowed : 1,
      order: typeof se.order === 'number' ? se.order : 0,
      publishDate: toDate(se.publishDate),
      cutOffDate: toDate(se.cutOffDate),
      createdAt: toDate(se.createdAt) ?? new Date(),
      updatedAt: toDate(se.updatedAt) ?? new Date()
    };
    await tx.subExam.upsert({
      where: { id: se.id },
      update: sePayload,
      create: { id: se.id, ...sePayload }
    });
  }

  // 3. Gather and restore Questions (with bilingual fields)
  const backupQuestions: any[] = Array.isArray(backupData.question) ? backupData.question : [];
  const embeddedQuestions: any[] = Array.isArray(e.questions) ? e.questions : [];
  const allQuestionsMap = new Map<string, any>();
  for (const q of backupQuestions) {
    if (q?.examId === e.id) allQuestionsMap.set(q.id, q);
  }
  for (const q of embeddedQuestions) {
    if (q?.id) allQuestionsMap.set(q.id, { ...q, examId: e.id });
  }
  for (const m of modulesList) {
    if (Array.isArray(m.questions)) {
      for (const q of m.questions) {
        if (q?.id) allQuestionsMap.set(q.id, { ...q, examId: e.id, moduleId: m.id });
      }
    }
  }
  for (const se of allSubExamsMap.values()) {
    if (Array.isArray(se.questions)) {
      for (const q of se.questions) {
        if (q?.id) allQuestionsMap.set(q.id, { ...q, examId: e.id, subExamId: se.id, moduleId: se.moduleId });
      }
    }
  }

  for (const q of allQuestionsMap.values()) {
    const optionsStr = typeof q.options === 'string'
      ? q.options
      : JSON.stringify(Array.isArray(q.options) ? q.options : []);

    const optionsEnStr = q.optionsEn
      ? (typeof q.optionsEn === 'string' ? q.optionsEn : JSON.stringify(Array.isArray(q.optionsEn) ? q.optionsEn : []))
      : null;

    const correctAnswerStr = Array.isArray(q.correctAnswer)
      ? JSON.stringify(q.correctAnswer)
      : String(q.correctAnswer ?? '');

    const qPayload: any = {
      examId: e.id,
      text: q.text ?? q.content ?? '',
      textEn: q.textEn ?? null,
      type: q.type || q.questionType || 'MCQ',
      options: optionsStr,
      optionsEn: optionsEnStr,
      correctAnswer: correctAnswerStr,
      points: Number(q.points) || 1,
      xpPoints: Number(q.xpPoints) || 10,
      ...metadataTranslations(q),
      skill: q.skill ?? null,
      learningOutcome: q.learningOutcome ?? null,
      indicator: q.indicator ?? null,
      videoUrl: q.videoUrl ?? null,
      level: q.level ?? 'Medium',
      dok: q.dok ?? null,
      cognitive: q.cognitive ?? null,
      course: q.course ?? null,
      section: q.section ?? null,
      domain: q.domain ?? null,
      standard: q.standard ?? null,
      subskill: q.subskill ?? null,
      microSkill: q.microSkill ?? null,
      gradeTarget: q.gradeTarget ?? null,
      errorPattern: q.errorPattern ?? null,
      estimatedTime: q.estimatedTime ? String(q.estimatedTime) : null,
      explanation: q.explanation ?? null,
      explanationEn: q.explanationEn ?? null,
      imageUrl: q.imageUrl ?? null,
      order: Number(q.order) || 0,
      deletedAt: null,
      moduleId: (q.moduleId && allModulesMap.has(q.moduleId)) ? q.moduleId : null,
      subExamId: (q.subExamId && allSubExamsMap.has(q.subExamId)) ? q.subExamId : null,
      createdAt: toDate(q.createdAt) ?? new Date(),
      updatedAt: toDate(q.updatedAt) ?? new Date()
    };

    await tx.question.upsert({
      where: { id: q.id },
      update: qPayload,
      create: { id: q.id, ...qPayload }
    });
  }
}

