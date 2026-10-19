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

import { restoreExamWithHierarchy } from './backupRestore';
import { parseBackupBuffer, generateFullSystemBackupData, performBackupAndPruning, normalizeRestoredValue, readLocalBackupFile } from './backupMaintenance';
export const postBackupHandler1 = async (req: any, res: any) => {
  try {
    const result = await performBackupAndPruning();
    res.json({
      message: 'Backup created successfully',
      filename: result.filename,
      size: result.size,
      createdAt: result.createdAt
    });
  } catch (error: any) {
    console.error(' Backup creation error:', error);
    res.status(500).json({ error: 'Failed to create backup', details: error.message });
  }
};


export const getBackupHandler2 = async (req: any, res: any) => {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')))
      .map(file => {
        const filePath = path.join(BACKUPS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime,
          isCloud: false
        };
      });

    // Merge cloud backups (excluding Realtime Sync noise)
    let cloudFiles: any[] = [];
    try {
      const cloudBackups = await getCloudBackups();
      cloudFiles = cloudBackups
        .filter((cb: any) => cb.type !== 'REALTIME_SYNC')
        .map((cb: any) => ({
          filename: `cloud_${cb.id}_${cb.name || 'backup'}.json`,
          size: cb.size || 0,
          createdAt: cb.created_at,
          isCloud: true,
          type: cb.type
        }));
    } catch (err) {
      console.error('Failed to merge cloud backups:', err);
    }

    const allFiles = [...files, ...cloudFiles].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(allFiles);
  } catch (error: any) {
    console.error(' Backup list error:', error);
    res.status(500).json({ error: 'Failed to list backups', details: error.message });
  }
};


export const getBackupHandler3 = async (req: any, res: any) => {
  try {
    const cloudBackups = await getCloudBackups();
    const filtered = cloudBackups.filter((cb: any) => cb.type !== 'REALTIME_SYNC');
    res.json(filtered);
  } catch (error: any) {
    console.error(' Cloud backup list error:', error);
    res.status(500).json({ error: 'Failed to list cloud backups', details: error.message });
  }
};


export const postBackupHandler4 = async (req: any, res: any) => {
  try {
    const fullData = await generateFullSystemBackupData();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_manual_cloud_${timestamp}`;
    const saved = await saveToCloudBackup(backupName, 'MANUAL', fullData);
    if (!saved) {
      return res.status(500).json({ error: 'Failed to save cloud backup to Cloud Backup' });
    }
    res.json({ message: 'Cloud backup created successfully on Cloud Backup', filename: backupName });
  } catch (error: any) {
    console.error(' Cloud backup create error:', error);
    res.status(500).json({ error: 'Failed to create cloud backup', details: error.message });
  }
};


export const postBackupHandler5 = async (req: any, res: any) => {
  try {
    const allCourses = await prisma.course.findMany({
      include: {
        lessons: { include: { blocks: true } },
        exams: {
          include: {
            questions: true,
            modules: {
              where: { parentModuleId: null },
              include: {
                subExams: true,
                subModules: {
                  include: {
                    subExams: true
                  }
                }
              }
            }
          }
        },
        schools: true,
        school: true
      }
    });

    const standaloneExams = await prisma.exam.findMany({
      where: { courseId: null },
      include: {
        questions: true,
        modules: {
          where: { parentModuleId: null },
          include: {
            subExams: true,
            subModules: {
              include: {
                subExams: true
              }
            }
          }
        }
      }
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_forced_sync_${timestamp}`;
    const saved = await saveToCloudBackup(backupName, 'REALTIME_SYNC', {
      data: {
        course: allCourses,
        exam: standaloneExams
      }
    });

    if (!saved) {
      return res.status(500).json({ error: 'Failed to sync courses to Cloud Backup' });
    }

    console.log(`[Force Sync] Synced ${allCourses.length} courses and ${standaloneExams.length} standalone exams to Cloud Backup as REALTIME_SYNC`);
    res.json({
      message: `تمت مزامنة ${allCourses.length} كورس و ${standaloneExams.length} امتحان بنجاح إلى Cloud Backup`,
      coursesCount: allCourses.length,
      examsCount: standaloneExams.length,
      backupName
    });
  } catch (error: any) {
    console.error('Cloud sync-all error:', error);
    res.status(500).json({ error: 'Failed to sync all courses', details: error.message });
  }
};


export const postBackupHandler6 = async (req: any, res: any) => {
  try {
    const { Pool } = require('pg');
    const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
    const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 3, connectionTimeoutMillis: 8000 });

    // 1. Fetch the most recent cloud backup records
    const result = await cloudPool.query(`
      SELECT data, created_at, type
      FROM cloud_backups
      WHERE type IN ('FULL_SYSTEM', 'REALTIME_SYNC', 'AUTO_HOURLY', 'MANUAL', 'FULL_SYSTEM')
      ORDER BY created_at DESC
      LIMIT 30;
    `);
    await cloudPool.end();

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'No cloud backup records found' });
    }

    // 2. Merge all course, lesson, and modular exam data from cloud records (newest first)
    const mergedCourses = new Map<string, any>();
    const mergedLessons = new Map<string, any>();
    const mergedExams = new Map<string, any>();
    const mergedModules = new Map<string, any>();
    const mergedSubExams = new Map<string, any>();
    const mergedQuestions = new Map<string, any>();

    for (const row of result.rows) {
      try {
        const payload = row.data;
        const data = payload?.data || payload;

        const courses: any[] = Array.isArray(data?.course) ? data.course : [];
        const lessons: any[] = Array.isArray(data?.lesson) ? data.lesson : [];
        const exams: any[] = Array.isArray(data?.exam) ? data.exam : [];
        const modules: any[] = Array.isArray(data?.examModule) ? data.examModule : [];
        const subExams: any[] = Array.isArray(data?.subExam) ? data.subExam : [];
        const questions: any[] = Array.isArray(data?.question) ? data.question : [];

        for (const c of courses) {
          if (c?.id && !mergedCourses.has(c.id)) {
            mergedCourses.set(c.id, c);
            if (Array.isArray(c.lessons)) {
              for (const l of c.lessons) {
                if (l?.id && !mergedLessons.has(l.id)) {
                  mergedLessons.set(l.id, { ...l, courseId: l.courseId || c.id });
                }
              }
            }
            if (Array.isArray(c.exams)) {
              for (const e of c.exams) {
                if (e?.id && !mergedExams.has(e.id)) {
                  mergedExams.set(e.id, { ...e, courseId: e.courseId || c.id });
                  if (Array.isArray(e.questions)) {
                    for (const q of e.questions) {
                      if (q?.id && !mergedQuestions.has(q.id)) mergedQuestions.set(q.id, { ...q, examId: e.id });
                    }
                  }
                  if (Array.isArray(e.modules)) {
                    for (const m of e.modules) {
                      if (m?.id && !mergedModules.has(m.id)) {
                        mergedModules.set(m.id, { ...m, examId: e.id });
                      }
                      if (Array.isArray(m.subExams)) {
                        for (const se of m.subExams) {
                          if (se?.id && !mergedSubExams.has(se.id)) mergedSubExams.set(se.id, { ...se, moduleId: m.id });
                        }
                      }
                      if (Array.isArray(m.subModules)) {
                        for (const sm of m.subModules) {
                          if (sm?.id && !mergedModules.has(sm.id)) mergedModules.set(sm.id, { ...sm, examId: e.id, parentModuleId: m.id });
                          if (Array.isArray(sm.subExams)) {
                            for (const se of sm.subExams) {
                              if (se?.id && !mergedSubExams.has(se.id)) mergedSubExams.set(se.id, { ...se, moduleId: sm.id });
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        for (const l of lessons) {
          if (l?.id && !mergedLessons.has(l.id)) mergedLessons.set(l.id, l);
        }
        for (const e of exams) {
          if (e?.id && !mergedExams.has(e.id)) {
            mergedExams.set(e.id, e);
            if (Array.isArray(e.questions)) {
              for (const q of e.questions) {
                if (q?.id && !mergedQuestions.has(q.id)) mergedQuestions.set(q.id, { ...q, examId: e.id });
              }
            }
            if (Array.isArray(e.modules)) {
              for (const m of e.modules) {
                if (m?.id && !mergedModules.has(m.id)) {
                  mergedModules.set(m.id, { ...m, examId: e.id });
                }
                if (Array.isArray(m.subExams)) {
                  for (const se of m.subExams) {
                    if (se?.id && !mergedSubExams.has(se.id)) mergedSubExams.set(se.id, { ...se, moduleId: m.id });
                  }
                }
                if (Array.isArray(m.subModules)) {
                  for (const sm of m.subModules) {
                    if (sm?.id && !mergedModules.has(sm.id)) mergedModules.set(sm.id, { ...sm, examId: e.id, parentModuleId: m.id });
                    if (Array.isArray(sm.subExams)) {
                      for (const se of sm.subExams) {
                        if (se?.id && !mergedSubExams.has(se.id)) mergedSubExams.set(se.id, { ...se, moduleId: sm.id });
                      }
                    }
                  }
                }
              }
            }
          }
        }
        for (const m of modules) {
          if (m?.id && !mergedModules.has(m.id)) mergedModules.set(m.id, m);
          if (Array.isArray(m.subExams)) {
            for (const se of m.subExams) {
              if (se?.id && !mergedSubExams.has(se.id)) mergedSubExams.set(se.id, { ...se, moduleId: m.id });
            }
          }
          if (Array.isArray(m.subModules)) {
            for (const sm of m.subModules) {
              if (sm?.id && !mergedModules.has(sm.id)) mergedModules.set(sm.id, { ...sm, examId: m.examId, parentModuleId: m.id });
              if (Array.isArray(sm.subExams)) {
                for (const se of sm.subExams) {
                  if (se?.id && !mergedSubExams.has(se.id)) mergedSubExams.set(se.id, { ...se, moduleId: sm.id });
                }
              }
            }
          }
        }
        for (const se of subExams) {
          if (se?.id && !mergedSubExams.has(se.id)) mergedSubExams.set(se.id, se);
        }
        for (const q of questions) {
          if (q?.id && !mergedQuestions.has(q.id)) mergedQuestions.set(q.id, q);
        }
      } catch { /* skip malformed records */ }
    }

    console.log(`[Cloud Restore] Found ${mergedCourses.size} courses, ${mergedLessons.size} lessons, ${mergedExams.size} exams in cloud backup pool`);

    // 3. Load current primary DB state
    const [activeCourses, activeLessons, activeExams] = await Promise.all([
      prisma.course.findMany({ select: { id: true } }),
      prisma.lesson.findMany({ select: { id: true } }),
      prisma.exam.findMany({ select: { id: true } })
    ]);
    const activeCourseIds = new Set(activeCourses.map((c: any) => c.id));
    const activeLessonIds = new Set(activeLessons.map((l: any) => l.id));
    const activeExamIds = new Set(activeExams.map((e: any) => e.id));

    const toDate = (v: any) => (v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null);

    let restoredCourses = 0;
    let restoredLessons = 0;
    let restoredExams = 0;
    let skippedCourses = 0;
    let skippedLessons = 0;
    let skippedExams = 0;
    const details: string[] = [];

    // 4. Restore missing courses
    for (const [courseId, c] of mergedCourses) {
      if (activeCourseIds.has(courseId)) { skippedCourses++; continue; }
      if (!c?.title) { skippedCourses++; continue; }
      try {
        await prisma.course.create({
          data: {
            id: c.id,
            title: c.title,
            description: c.description ?? null,
            coverImage: c.coverImage ?? null,
            grade: c.grade ?? null,
            grades: c.grades ?? null,
            subject: c.subject ?? null,
            country: c.country || 'مصر',
            isCentral: c.isCentral ?? false,
            schoolId: c.schoolId ?? null,
            createdAt: toDate(c.createdAt) ?? new Date(),
            updatedAt: toDate(c.updatedAt) ?? new Date(),
          }
        });
        activeCourseIds.add(courseId);
        restoredCourses++;
        details.push(`Course: "${c.title}"`);
        console.log(`[Cloud Restore] Restored course: "${c.title}" (${courseId})`);
      } catch (err: any) {
        if (err.code === 'P2002') { skippedCourses++; activeCourseIds.add(courseId); }
        else { details.push(`Course "${c.title}": ${err.message}`); skippedCourses++; }
      }
    }

    // 5. Restore missing lessons
    for (const [lessonId, l] of mergedLessons) {
      if (activeLessonIds.has(lessonId)) { skippedLessons++; continue; }
      if (!l?.courseId || !activeCourseIds.has(l.courseId)) { skippedLessons++; continue; }
      try {
        const parseSafe = (v: any) => {
          if (!v) return null;
          if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
          return v;
        };
        await prisma.lesson.create({
          data: {
            id: l.id,
            courseId: l.courseId,
            title: l.title || 'Untitled Lesson',
            ...metadataTranslations(l, String, LESSON_METADATA_FIELDS), domain: l.domain ?? null,
            content: l.content ?? null,
            videoUrl: l.videoUrl ?? null,
            duration: l.duration ?? 0,
            summary: l.summary ?? null,
            notes: l.notes ?? null,
            questions: parseSafe(l.questions) ?? null,
            assignments: parseSafe(l.assignments) ?? null,
            attachments: parseSafe(l.attachments) ?? null,
            slides: parseSafe(l.slides) ?? null,
            standards: l.standards ?? null,
            indicators: l.indicators ?? null,
            learningOutcomes: l.learningOutcomes ?? null,
            isCentral: l.isCentral ?? false,
            isVisible: l.isVisible !== undefined ? !!l.isVisible : true,
            publishDate: toDate(l.publishDate),
            cutOffDate: toDate(l.cutOffDate),
            order: l.order ?? 0,
            createdAt: toDate(l.createdAt) ?? new Date(),
            updatedAt: toDate(l.updatedAt) ?? new Date(),
          }
        });
        activeLessonIds.add(lessonId);
        restoredLessons++;
        details.push(`Lesson: "${l.title}"`);
        console.log(`[Cloud Restore] Restored lesson: "${l.title}" -> course ${l.courseId}`);
      } catch (err: any) {
        if (err.code === 'P2002') { skippedLessons++; }
        else { details.push(`Lesson "${l.title}": ${err.message}`); skippedLessons++; }
      }
    }

    // 6. Restore missing exams (with modules, sub-exams, and bilingual questions)
    const backupDataWrapper = {
      examModule: Array.from(mergedModules.values()),
      subExam: Array.from(mergedSubExams.values()),
      question: Array.from(mergedQuestions.values())
    };

    for (const [examId, e] of mergedExams) {
      if (activeExamIds.has(examId)) { skippedExams++; continue; }
      if (e.courseId && !activeCourseIds.has(e.courseId)) { skippedExams++; continue; }

      try {
        await prisma.$transaction(async (tx) => {
          await restoreExamWithHierarchy(tx, e, backupDataWrapper, e.courseId ?? null);
        }, { timeout: 30000 });
        activeExamIds.add(examId);
        restoredExams++;
        details.push(`Exam: "${e.title}"`);
        console.log(`[Cloud Restore] Restored modular exam: "${e.title}" (${examId})`);
      } catch (err: any) {
        details.push(`Exam "${e.title}": ${err.message}`);
        skippedExams++;
      }
    }

    const summary = {
      success: true,
      message: `تم استعادة ${restoredCourses} كورس و ${restoredLessons} درس و ${restoredExams} امتحان من Cloud Backup إلى قاعدة البيانات الأساسية`,
      restoredCourses,
      restoredLessons,
      restoredExams,
      skippedCourses,
      skippedLessons,
      skippedExams,
      cloudRecordsScanned: result.rows.length,
      details: details.slice(0, 100)
    };

    console.log(`[Cloud Restore] COMPLETE - Courses: ${restoredCourses} restored, ${skippedCourses} skipped | Lessons: ${restoredLessons} restored, ${skippedLessons} skipped | Exams: ${restoredExams} restored, ${skippedExams} skipped`);
    res.json(summary);
  } catch (error: any) {
    console.error('Cloud restore error:', error);
    res.status(500).json({ error: 'Failed to restore from cloud backup', details: error.message });
  }
};


export const getBackupHandler7 = async (req: any, res: any) => {
  try {
    const { filename } = req.params;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (filename.startsWith('cloud_')) {
      const match = filename.match(/^cloud_([0-9a-fA-F-]+)_/);
      if (match && match[1]) {
        const cloudId = match[1];
        const { Pool } = require('pg');
        const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
        const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 1 });
        try {
          const result = await cloudPool.query('SELECT data FROM cloud_backups WHERE id = $1', [cloudId]);
          if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cloud backup not found' });
          }
          const data = result.rows[0].data;
          
          if (data && data.isArchive && data.compression === 'zip' && data.fileBase64) {
             const buffer = Buffer.from(data.fileBase64, 'base64');
             const zipFilename = filename.replace('.json', '.zip');
             res.setHeader('Content-Type', 'application/zip');
             res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFilename)}`);
             return res.send(buffer);
          }

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
          return res.send(JSON.stringify(data, null, 2));
        } finally {
          await cloudPool.end();
        }
      }
    }

    const filePath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }
    res.download(filePath, filename);
  } catch (error: any) {
    console.error(' Backup download error:', error);
    res.status(500).json({ error: 'Failed to download backup', details: error.message });
  }
};


export const getBackupHandler8 = async (req: any, res: any) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.attachment(`full-backup-with-media-${timestamp}.zip`);
    const archiver = require('archiver');
    let archive: any;
    if (archiver.ZipArchive) {
      archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    } else if (typeof archiver === 'function') archive = archiver('zip', { zlib: { level: 9 } });
    else if (archiver.create) archive = archiver.create('zip', { zlib: { level: 9 } });
    else if (archiver.default) archive = archiver.default('zip', { zlib: { level: 9 } });
    
    archive.on('error', (err: any) => {
      console.error('Archive error:', err);
      if (!res.headersSent) res.status(500).send({ error: err.message });
    });

    archive.pipe(res);

    // 1. Generate full database JSON backup
    const backupData = await generateFullSystemBackupData();
    const backupJson = JSON.stringify(backupData, null, 2);
    archive.append(backupJson, { name: `database_backup_${timestamp}.json` });

    // 2. Add uploads directory if it exists and has files
    const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
    if (fs.existsSync(UPLOADS_DIR)) {
      archive.directory(UPLOADS_DIR, 'uploads');
    }

    archive.finalize();
  } catch (error: any) {
    console.error(' Download full backup with media error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create full backup zip', details: error.message });
  }
};


export const getBackupHandler9 = async (req: any, res: any) => {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')));
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'No backups available to download' });
    }

    res.attachment(`all-backups-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
    const archiver = require('archiver');
    let archive: any;
    if (archiver.ZipArchive) {
      archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    } else if (typeof archiver === 'function') archive = archiver('zip', { zlib: { level: 9 } });
    else if (archiver.create) archive = archiver.create('zip', { zlib: { level: 9 } });
    else if (archiver.default) archive = archiver.default('zip', { zlib: { level: 9 } });
    
    archive.on('error', (err: any) => {
      res.status(500).send({ error: err.message });
    });

    archive.pipe(res);

    for (const file of files) {
      archive.file(path.join(BACKUPS_DIR, file), { name: file });
    }

    archive.finalize();
  } catch (error: any) {
    console.error(' Download all backups error:', error);
    res.status(500).json({ error: 'Failed to create zip for all backups', details: error.message });
  }
};


export const postBackupHandler10 = async (req: any, res: any) => {
  try {
    const result = await createManualBundle();
    res.json(result);
  } catch (error: any) {
    console.error(' Manual bundle backups error:', error);
    res.status(500).json({ error: error.message || 'Failed to create manual bundle' });
  }
};

