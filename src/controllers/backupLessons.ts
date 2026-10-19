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
export const postBackupHandler17 = async (req: any, res: any) => {
  try {
    const { filename, source, selections } = req.body;
    if (!selections || !Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ error: 'No items selected for restore.' });
    }

    let backupData: any = null;

    if (source === 'cloud' || (filename && filename.startsWith('السحابة:'))) {
      const { Pool } = require('pg');
      const cloudPool = new Pool({ connectionString: process.env.BACKUP_DB_URL, max: 2, connectionTimeoutMillis: 5000 });
      let actualName = filename ? filename.replace('السحابة:', '').trim() : '';
      let cloudRes;
      if (actualName) {
        cloudRes = await cloudPool.query(`SELECT data FROM cloud_backups WHERE name = $1 LIMIT 1;`, [actualName]);
      } else {
        cloudRes = await cloudPool.query(`SELECT data FROM cloud_backups ORDER BY created_at DESC LIMIT 1;`);
      }
      await cloudPool.end();
      if (cloudRes.rows.length > 0) {
        backupData = cloudRes.rows[0].data?.data || cloudRes.rows[0].data;
      }
    } else {
      const searchDirs = [BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
      for (const dir of searchDirs) {
        if (backupData) break;
        try {
          const fp = path.join(dir, filename);
          if (fs.existsSync(fp)) {
            const parsed = readLocalBackupFile(fp, filename);
            backupData = parsed.data || parsed;
          }
        } catch {}
      }
    }

    if (!backupData) return res.status(404).json({ error: 'Backup not found.' });

    const bCourses = Array.isArray(backupData.course) ? backupData.course : [];
    const bLessons = Array.isArray(backupData.lesson) ? backupData.lesson : [];

    const bExamsMap = new Map<string, any>();
    if (Array.isArray(backupData.exam)) {
      for (const e of backupData.exam) if (e?.id) bExamsMap.set(e.id, e);
    }
    for (const c of bCourses) {
      if (Array.isArray(c.exams)) {
        for (const e of c.exams) if (e?.id && !bExamsMap.has(e.id)) bExamsMap.set(e.id, { ...e, courseId: e.courseId || c.id });
      }
    }

    const parseSafe = (v: any) => { if (!v) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; };
    const toDate = (v: any) => v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null;

    await prisma.$transaction(async (tx) => {
      for (const sel of selections) {
        if (sel.type === 'course') {
          const c = bCourses.find((x: any) => x.id === sel.id);
          if (!c) continue;
          await tx.course.upsert({
            where: { id: c.id },
            update: { title: c.title, description: c.description, coverImage: c.coverImage, grade: c.grade, grades: c.grades, subject: c.subject, country: c.country, isCentral: c.isCentral, schoolId: c.schoolId, updatedAt: new Date() },
            create: { id: c.id, title: c.title, description: c.description, coverImage: c.coverImage, grade: c.grade, grades: c.grades, subject: c.subject, country: c.country || 'مصر', isCentral: c.isCentral || false, schoolId: c.schoolId, createdAt: toDate(c.createdAt) || new Date(), updatedAt: toDate(c.updatedAt) || new Date() }
          });

          // Restore all its lessons
          const cLessons = bLessons.filter((l: any) => l.courseId === c.id);
          for (const l of cLessons) {
            await tx.lesson.upsert({
              where: { id: l.id },
              update: { courseId: c.id, title: l.title, ...metadataTranslations(l, String, LESSON_METADATA_FIELDS), domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() },
              create: { id: l.id, courseId: c.id, title: l.title || 'Untitled', ...metadataTranslations(l, String, LESSON_METADATA_FIELDS), domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() }
            });
          }

          // Restore all its exams with complete hierarchy
          const cExams = Array.from(bExamsMap.values()).filter((e: any) => e.courseId === c.id);
          for (const e of cExams) {
            await restoreExamWithHierarchy(tx, e, backupData, c.id);
          }
        }
        else if (sel.type === 'lesson') {
          const l = bLessons.find((x: any) => x.id === sel.id);
          if (!l) continue;
          const targetCourseId = sel.targetCourseId || l.courseId;
          await tx.lesson.upsert({
            where: { id: l.id },
            update: { courseId: targetCourseId, title: l.title, ...metadataTranslations(l, String, LESSON_METADATA_FIELDS), domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() },
            create: { id: l.id, courseId: targetCourseId, title: l.title || 'Untitled', ...metadataTranslations(l, String, LESSON_METADATA_FIELDS), domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() }
          });
        }
        else if (sel.type === 'exam') {
          const e = bExamsMap.get(sel.id);
          if (!e) continue;
          const targetCourseId = sel.targetCourseId !== undefined ? sel.targetCourseId : e.courseId;
          await restoreExamWithHierarchy(tx, e, backupData, targetCourseId);
        }
      }
    }, { timeout: 120000 });

    res.json({ success: true, message: 'Selective restore completed successfully.' });
  } catch (error: any) {
    console.error('Selective restore error:', error);
    res.status(500).json({ error: 'Failed to perform selective restore', details: error.message });
  }
};


export const getBackupHandler18 = async (req: any, res: any) => {
  try {
    const { Pool } = require('pg');
    const cloudPool = new Pool({ connectionString: process.env.BACKUP_DB_URL, max: 1 });
    
    // Fetch recent 10 backups
    const cloudRes = await cloudPool.query(`SELECT data FROM cloud_backups WHERE type != 'ARCHIVE' AND type != 'REALTIME_SYNC' ORDER BY created_at DESC LIMIT 10;`);
    await cloudPool.end();

    if (cloudRes.rows.length === 0) {
      return res.status(404).send('No recent backups found');
    }

    const lessonId = 'e4d57cff-cd8f-43bc-99dc-21687205ecd6';
    const targetCourseId = '7235296d-686b-4d4b-b77f-07343ffe9865';
    let targetLesson = null;

    for (const row of cloudRes.rows) {
      const data = row.data?.data || row.data;
      const lessons = Array.isArray(data?.lesson) ? data.lesson : [];
      targetLesson = lessons.find((l: any) => l.id === lessonId);
      if (targetLesson) break;
    }
    
    if (!targetLesson) {
      // Fallback: search local files
      const fs = require('fs');
      const path = require('path');
      const searchDirs = [process.cwd(), '/app', '/app/uploads/backups'];
      for (const dir of searchDirs) {
        if (targetLesson) break;
        try {
          if (!fs.existsSync(dir)) continue;
          for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.json')) continue;
            try {
              const fileData = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
              const payload = fileData.data || fileData;
              const lessons = Array.isArray(payload.lesson) ? payload.lesson : [];
              targetLesson = lessons.find((l: any) => l.id === lessonId);
              if (targetLesson) break;
            } catch (e) {}
          }
        } catch (e) {}
      }
    }

    if (!targetLesson) {
      return res.status(404).send('Lesson not found in recent 10 backups or local files. Please try restoring normally from the UI once to trigger a local upload, then hitting this endpoint again!');
    }

    const parseSafe = (v: any) => {
      if (!v) return null;
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
      return v;
    };
    const toDate = (v: any) => v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null;

    await prisma.lesson.upsert({
      where: { id: lessonId },
      update: {
        courseId: targetCourseId,
        title: targetLesson.title,
        ...metadataTranslations(targetLesson, String, LESSON_METADATA_FIELDS), domain: targetLesson.domain ?? null,
        content: targetLesson.content ?? null,
        videoUrl: targetLesson.videoUrl ?? null,
        duration: targetLesson.duration ?? 0,
        summary: targetLesson.summary ?? null,
        notes: targetLesson.notes ?? null,
        questions: parseSafe(targetLesson.questions) ?? null,
        assignments: parseSafe(targetLesson.assignments) ?? null,
        attachments: parseSafe(targetLesson.attachments) ?? null,
        slides: parseSafe(targetLesson.slides) ?? null,
        standards: targetLesson.standards ?? null,
        indicators: targetLesson.indicators ?? null,
        learningOutcomes: targetLesson.learningOutcomes ?? null,
        isCentral: targetLesson.isCentral ?? false,
        isVisible: true,
        publishDate: toDate(targetLesson.publishDate),
        cutOffDate: toDate(targetLesson.cutOffDate),
        order: targetLesson.order ?? 0,
        updatedAt: new Date(),
      },
      create: {
        id: lessonId,
        courseId: targetCourseId,
        title: targetLesson.title || 'Untitled Lesson',
        ...metadataTranslations(targetLesson, String, LESSON_METADATA_FIELDS), domain: targetLesson.domain ?? null,
        content: targetLesson.content ?? null,
        videoUrl: targetLesson.videoUrl ?? null,
        duration: targetLesson.duration ?? 0,
        summary: targetLesson.summary ?? null,
        notes: targetLesson.notes ?? null,
        questions: parseSafe(targetLesson.questions) ?? null,
        assignments: parseSafe(targetLesson.assignments) ?? null,
        attachments: parseSafe(targetLesson.attachments) ?? null,
        slides: parseSafe(targetLesson.slides) ?? null,
        standards: targetLesson.standards ?? null,
        indicators: targetLesson.indicators ?? null,
        learningOutcomes: targetLesson.learningOutcomes ?? null,
        isCentral: targetLesson.isCentral ?? false,
        isVisible: true,
        publishDate: toDate(targetLesson.publishDate),
        cutOffDate: toDate(targetLesson.cutOffDate),
        order: targetLesson.order ?? 0,
        createdAt: toDate(targetLesson.createdAt) ?? new Date(),
        updatedAt: toDate(targetLesson.updatedAt) ?? new Date(),
      }
    });

    res.send(` تم إضافة الدرس بنجاح إلى الكورس المطلوب!`);
  } catch (err: any) {
    res.status(500).send(`Error: ${err.message}`);
  }
};


export const postBackupHandler19 = async (req: any, res: any) => {
  try {
    const { filename, lessonId, source } = req.body;
    if (!lessonId) {
      return res.status(400).json({ error: 'lessonId is required' });
    }

    let targetLesson: any = null;
    let targetCourse: any = null;
    let backupDataForLessonRestore: any = null;

    // A. If source is cloud or filename starts with 'السحابة:'
    if (source === 'cloud' || (filename && filename.startsWith('السحابة:'))) {
      const { Pool } = require('pg');
      const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
      const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 2, connectionTimeoutMillis: 5000 });

      let actualName = filename ? filename.replace('السحابة:', '').trim() : '';
      let cloudRes;
      
      if (actualName) {
        cloudRes = await cloudPool.query(`SELECT data FROM cloud_backups WHERE name = $1 LIMIT 1;`, [actualName]);
      } else {
        cloudRes = await cloudPool.query(`SELECT data FROM cloud_backups ORDER BY created_at DESC LIMIT 3;`);
      }
      
      await cloudPool.end();

      for (const row of cloudRes.rows) {
        const data = row.data?.data || row.data;
        const courses: any[] = Array.isArray(data?.course) ? data.course : [];
        const lessons: any[] = Array.isArray(data?.lesson) ? data.lesson : [];

        for (const c of courses) {
          if (Array.isArray(c.lessons)) {
            const found = c.lessons.find((l: any) => l.id === lessonId);
            if (found) {
              targetLesson = { ...found, courseId: found.courseId || c.id };
              targetCourse = c;
              backupDataForLessonRestore = data;
              break;
            }
          }
        }
        if (!targetLesson) {
          const found = lessons.find((l: any) => l.id === lessonId);
          if (found) {
            targetLesson = found;
            targetCourse = courses.find((c: any) => c.id === found.courseId);
            backupDataForLessonRestore = data;
          }
        }
        if (targetLesson) break;
      }
    } else {
      // B. Search in local files
      const searchDirs = [BACKUPS_DIR, process.cwd(), '/app', '/app/uploads/backups'];
      const seenFiles = new Set<string>();

      for (const dir of searchDirs) {
        if (targetLesson) break;
        try {
          if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
          for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.json') && !file.endsWith('.zip')) continue;
            const fp = path.join(dir, file);
            if (seenFiles.has(fp)) continue;
            seenFiles.add(fp);

            try {
              const backup = readLocalBackupFile(fp, file);
              const data = backup.data || backup;
              const lessons: any[] = Array.isArray(data.lesson) ? data.lesson : [];
              const courses: any[] = Array.isArray(data.course) ? data.course : [];

              const found = lessons.find((l: any) => l.id === lessonId);
              if (found) {
                targetLesson = found;
                targetCourse = courses.find((c: any) => c.id === found.courseId);
                backupDataForLessonRestore = data;
                break;
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    }

    if (!targetLesson) {
      return res.status(404).json({ error: `Lesson '${lessonId}' not found in any backup file or cloud record.` });
    }

    const parseSafe = (v: any) => {
      if (!v) return null;
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
      return v;
    };
    const toDate = (v: any) => v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null;

    // Check if course exists in current primary DB
    const existingCourse = await prisma.course.findUnique({ where: { id: targetLesson.courseId } });

    await prisma.$transaction(async (tx) => {
      // Auto-restore parent course if missing!
      if (!existingCourse && targetCourse) {
        console.log(`[Lesson Restore] Auto-restoring missing parent course '${targetCourse.title}' (${targetCourse.id})`);
        await tx.course.upsert({
          where: { id: targetCourse.id },
          update: { title: targetCourse.title },
          create: {
            id: targetCourse.id,
            title: targetCourse.title,
            description: targetCourse.description ?? null,
            coverImage: targetCourse.coverImage ?? null,
            grade: targetCourse.grade ?? null,
            grades: targetCourse.grades ?? null,
            subject: targetCourse.subject ?? null,
            country: targetCourse.country || 'مصر',
            isCentral: targetCourse.isCentral ?? false,
            schoolId: targetCourse.schoolId ?? null,
            createdAt: toDate(targetCourse.createdAt) ?? new Date(),
            updatedAt: toDate(targetCourse.updatedAt) ?? new Date(),
          }
        });
      }

      // Upsert the lesson
      await tx.lesson.upsert({
        where: { id: lessonId },
        update: {
          title: targetLesson.title,
          ...metadataTranslations(targetLesson, String, LESSON_METADATA_FIELDS), domain: targetLesson.domain ?? null,
          content: targetLesson.content ?? null,
          videoUrl: targetLesson.videoUrl ?? null,
          duration: targetLesson.duration ?? 0,
          summary: targetLesson.summary ?? null,
          notes: targetLesson.notes ?? null,
          questions: parseSafe(targetLesson.questions) ?? null,
          assignments: parseSafe(targetLesson.assignments) ?? null,
          attachments: parseSafe(targetLesson.attachments) ?? null,
          slides: parseSafe(targetLesson.slides) ?? null,
          standards: targetLesson.standards ?? null,
          indicators: targetLesson.indicators ?? null,
          learningOutcomes: targetLesson.learningOutcomes ?? null,
          isCentral: targetLesson.isCentral ?? false,
          isVisible: targetLesson.isVisible !== undefined ? !!targetLesson.isVisible : true,
          publishDate: toDate(targetLesson.publishDate),
          cutOffDate: toDate(targetLesson.cutOffDate),
          order: targetLesson.order ?? 0,
          updatedAt: new Date(),
        },
        create: {
          id: lessonId,
          courseId: targetLesson.courseId,
          title: targetLesson.title || 'Untitled Lesson',
          ...metadataTranslations(targetLesson, String, LESSON_METADATA_FIELDS), domain: targetLesson.domain ?? null,
          content: targetLesson.content ?? null,
          videoUrl: targetLesson.videoUrl ?? null,
          duration: targetLesson.duration ?? 0,
          summary: targetLesson.summary ?? null,
          notes: targetLesson.notes ?? null,
          questions: parseSafe(targetLesson.questions) ?? null,
          assignments: parseSafe(targetLesson.assignments) ?? null,
          attachments: parseSafe(targetLesson.attachments) ?? null,
          slides: parseSafe(targetLesson.slides) ?? null,
          standards: targetLesson.standards ?? null,
          indicators: targetLesson.indicators ?? null,
          learningOutcomes: targetLesson.learningOutcomes ?? null,
          isCentral: targetLesson.isCentral ?? false,
          isVisible: targetLesson.isVisible !== undefined ? !!targetLesson.isVisible : true,
          publishDate: toDate(targetLesson.publishDate),
          cutOffDate: toDate(targetLesson.cutOffDate),
          order: targetLesson.order ?? 0,
          createdAt: toDate(targetLesson.createdAt) ?? new Date(),
          updatedAt: toDate(targetLesson.updatedAt) ?? new Date(),
        }
      });

      // Restore ExamModules and SubExams for any exam that belongs to this lesson's course
      // This covers the case where the lesson's course has exams with modular hierarchy
      if (targetLesson.courseId && backupDataForLessonRestore) {
        const courseExams: any[] = [];
        const flatExams: any[] = Array.isArray(backupDataForLessonRestore.exam) ? backupDataForLessonRestore.exam : [];
        for (const e of flatExams) {
          if (e?.courseId === targetLesson.courseId) courseExams.push(e);
        }
        const flatCourses: any[] = Array.isArray(backupDataForLessonRestore.course) ? backupDataForLessonRestore.course : [];
        for (const c of flatCourses) {
          if (c?.id === targetLesson.courseId && Array.isArray(c.exams)) {
            for (const e of c.exams) {
              if (!courseExams.some((x: any) => x.id === e.id)) courseExams.push(e);
            }
          }
        }
        for (const e of courseExams) {
          await restoreExamWithHierarchy(tx, e, backupDataForLessonRestore, targetLesson.courseId);
        }
      }

      //  Remove from tombstones if previously marked as deleted
      const { unmarkLessonDeleted, unmarkCourseDeleted } = await import('../lib/tombstones');
      unmarkLessonDeleted(lessonId);
      if (targetLesson.courseId) unmarkCourseDeleted(targetLesson.courseId);
    });

    const freshLesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { course: true } });

    console.log(` [Lesson Restore] Restored lesson "${freshLesson?.title}" (${lessonId}) to course "${freshLesson?.course?.title}"`);

    res.json({
      success: true,
      message: `تم استعادة الدرس "${freshLesson?.title}" بنجاح في قاعدة البيانات الحالية.`,
      lesson: freshLesson
    });
  } catch (error: any) {
    console.error(' Lesson restore error:', error);
    res.status(500).json({ error: 'Failed to restore lesson', details: error.message });
  }
};


export const postBackupHandler20 = async (req: any, res: any) => {
  try {
    const { filename, useLatest } = req.body;

    // --- Find the backup file ---
    let backupPath: string | null = null;

    if (useLatest) {
      // Use the largest (most data) backup file in the backups directory
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.json') || f.endsWith('.zip'))
        .map(f => ({ name: f, size: fs.statSync(path.join(BACKUPS_DIR, f)).size }))
        .sort((a, b) => b.size - a.size);
      if (files.length === 0) return res.status(404).json({ error: 'No backup files found in backups directory' });
      backupPath = path.join(BACKUPS_DIR, files[0].name);
      console.log(` [Content Restore] Using largest backup: ${files[0].name} (${(files[0].size / 1024 / 1024).toFixed(1)} MB)`);
    } else if (filename) {
      backupPath = path.join(BACKUPS_DIR, path.basename(filename));
      if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ error: `Backup file not found: ${filename}` });
      }
    } else {
      return res.status(400).json({ error: 'Provide either filename or useLatest:true' });
    }

    // --- Parse backup ---
    const parsed = readLocalBackupFile(backupPath, path.basename(backupPath));
    const data = parsed.data || parsed;
    const backupLessons: any[] = Array.isArray(data.lesson) ? data.lesson : [];

    if (backupLessons.length === 0) {
      return res.status(400).json({ error: 'No lessons found in backup file' });
    }

    console.log(`\n [Content Restore] Processing ${backupLessons.length} lessons from backup...`);

    // Helper: parse JSON field safely
    const parseSafe = (v: any): any[] => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
      return [];
    };

    const report: any[] = [];
    let updated = 0;
    let skipped = 0;
    let notFound = 0;

    for (const bl of backupLessons) {
      if (!bl?.id) { skipped++; continue; }

      // Fetch current lesson from DB
      const current = await prisma.lesson.findUnique({
        where: { id: bl.id },
        select: { id: true, title: true, questions: true, assignments: true, slides: true, attachments: true }
      });

      if (!current) {
        console.log(`   Lesson not found in DB: "${bl.title}" (${bl.id})`);
        notFound++;
        continue;
      }

      const backupQ   = parseSafe(bl.questions);
      const backupA   = parseSafe(bl.assignments);
      const backupS   = parseSafe(bl.slides);
      const backupAtt = parseSafe(bl.attachments);

      const currentQ   = parseSafe(current.questions);
      const currentA   = parseSafe(current.assignments);
      const currentS   = parseSafe(current.slides);
      const currentAtt = parseSafe(current.attachments);

      // "Richer wins": only restore if backup has more items
      const finalQ   = backupQ.length   > currentQ.length   ? backupQ   : currentQ;
      const finalA   = backupA.length   > currentA.length   ? backupA   : currentA;
      const finalS   = backupS.length   > currentS.length   ? backupS   : currentS;
      const finalAtt = backupAtt.length > currentAtt.length ? backupAtt : currentAtt;

      const qChanged   = backupQ.length   > currentQ.length;
      const aChanged   = backupA.length   > currentA.length;
      const sChanged   = backupS.length   > currentS.length;
      const attChanged = backupAtt.length > currentAtt.length;

      if (!qChanged && !aChanged && !sChanged && !attChanged) {
        skipped++;
        continue;
      }

      const updateData: any = {};
      if (qChanged)   updateData.questions   = finalQ;
      if (aChanged)   updateData.assignments = finalA;
      if (sChanged)   updateData.slides      = finalS;
      if (attChanged) updateData.attachments = finalAtt;
      updateData.updatedAt = new Date();

      await prisma.lesson.update({ where: { id: bl.id }, data: updateData });

      const changes = [
        qChanged   ? `Q: ${currentQ.length}→${finalQ.length}`     : null,
        aChanged   ? `A: ${currentA.length}→${finalA.length}`     : null,
        sChanged   ? `S: ${currentS.length}→${finalS.length}`     : null,
        attChanged ? `Att: ${currentAtt.length}→${finalAtt.length}` : null,
      ].filter(Boolean).join(' | ');

      console.log(`   "${current.title}" [${changes}]`);
      report.push({ lessonId: bl.id, title: current.title, changes });
      updated++;
    }

    console.log(`\n [Content Restore] DONE — Updated: ${updated}, Skipped (already ok): ${skipped}, Not found: ${notFound}`);

    return res.json({
      success: true,
      message: `تم استعادة محتوى ${updated} درس بنجاح`,
      updated,
      skipped,
      notFound,
      total: backupLessons.length,
      details: report
    });

  } catch (error: any) {
    console.error(' [Content Restore] Error:', error);
    return res.status(500).json({ error: 'Failed to restore lesson content', details: error.message });
  }
};




