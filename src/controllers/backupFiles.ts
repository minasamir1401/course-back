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
const resolveBackupUploadEntryPath = (entryName: string): string => {
  const normalizedEntryName = entryName.replace(/\\/g, '/');
  if (!normalizedEntryName.startsWith('uploads/')) {
    throw new Error('ZIP entry is outside the uploads directory');
  }

  const relativePath = normalizedEntryName.slice('uploads/'.length);
  if (!relativePath || relativePath.includes('\0')) {
    throw new Error('ZIP entry has an invalid upload path');
  }

  const uploadsRoot = path.resolve(UPLOADS_DIR);
  const targetPath = path.resolve(uploadsRoot, relativePath);
  if (!targetPath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error('ZIP entry path escapes the uploads directory');
  }

  return targetPath;
};


export const postBackupHandler11 = async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No backup file uploaded' });
    }
    const tempPath = req.file.path;
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (ext !== '.json' && ext !== '.zip') {
      fs.unlinkSync(tempPath);
      return res.status(400).json({ error: 'Only JSON or ZIP backup files are allowed' });
    }

    const parsed = parseBackupBuffer(fs.readFileSync(tempPath), req.file.originalname || req.file.filename);
    if (!parsed.data) {
      fs.unlinkSync(tempPath);
      return res.status(400).json({ error: 'Invalid backup format' });
    }

    const filename = `backup-uploaded-${Date.now()}${ext}`;
    const destPath = path.join(BACKUPS_DIR, filename);
    fs.copyFileSync(tempPath, destPath);
    fs.unlinkSync(tempPath);

    let extractedMediaCount = 0;

    if (ext === '.zip') {
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(destPath);
        
        const mediaEntries = zip.getEntries().filter((entry: any) => {
          const entryName = String(entry.entryName || '').replace(/\\/g, '/');
          return entryName.startsWith('uploads/') && !entry.isDirectory;
        });

        // Validate every path before writing any file from the archive.
        const safeMediaEntries = mediaEntries.map((entry: any) => ({
          entry,
          targetPath: resolveBackupUploadEntryPath(String(entry.entryName || '')),
        }));

        safeMediaEntries.forEach(({ entry, targetPath }: any) => {
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          fs.writeFileSync(targetPath, entry.getData());
          extractedMediaCount++;
        });
        
        if (extractedMediaCount > 0) {
          console.log(` Extracted ${extractedMediaCount} media files from uploaded backup`);
        }
      } catch (err: any) {
        console.error('️ Failed to extract media from ZIP:', err.message);
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        return res.status(400).json({ error: 'ZIP backup contains an unsafe or invalid media path' });
      }
    }

    res.json({
      message: extractedMediaCount > 0 ? `Backup uploaded successfully and ${extractedMediaCount} images/media extracted` : 'Backup uploaded successfully',
      filename,
      size: fs.statSync(destPath).size,
      createdAt: new Date(),
      extractedMediaCount
    });
  } catch (error: any) {
    console.error(' Backup upload error:', error);
    res.status(500).json({ error: 'Failed to upload backup', details: error.message });
  }
};


export const deleteBackupHandler12 = async (req: any, res: any) => {
  try {
    const { filename } = req.params;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
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
          const result = await cloudPool.query('DELETE FROM cloud_backups WHERE id = $1 RETURNING id', [cloudId]);
          if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Cloud backup not found' });
          }
          return res.json({ success: true, message: 'Cloud backup deleted successfully' });
        } finally {
          await cloudPool.end();
        }
      }
    } else if (filename.includes('مجمع')) {
        // Special case for manual bundles or 50-hour archives
        const { Pool } = require('pg');
        const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
        const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 1 });
        try {
          const result = await cloudPool.query('DELETE FROM cloud_backups WHERE name = $1 RETURNING id', [filename]);
          if (result.rowCount === 0) {
             return res.status(404).json({ error: 'Archive not found' });
          }
          return res.json({ success: true, message: 'Archive deleted successfully' });
        } finally {
          await cloudPool.end();
        }
    }

    const filePath = path.join(BACKUPS_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.json({ success: true, message: 'Local backup deleted successfully' });
    }

    return res.status(404).json({ error: 'Backup not found' });
  } catch (error: any) {
    console.error(' Delete backup error:', error);
    res.status(500).json({ error: 'Failed to delete backup', details: error.message });
  }
};


export const postBackupHandler13 = async (req: any, res: any) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    let backupData: any = null;

    // --- Cloud backup: filename starts with 'cloud_' ---
    if (filename.startsWith('cloud_')) {
      const match = filename.match(/^cloud_([0-9a-fA-F-]+)_/);
      if (!match || !match[1]) {
        return res.status(400).json({ error: 'Invalid cloud backup filename' });
      }
      const cloudId = match[1];
      const { Pool } = require('pg');
      const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
      const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 1, connectionTimeoutMillis: 8000 });
      try {
        const result = await cloudPool.query('SELECT data FROM cloud_backups WHERE id = $1 LIMIT 1', [cloudId]);
        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Cloud backup record not found' });
        }
        backupData = result.rows[0].data;
      } finally {
        await cloudPool.end().catch(() => {});
      }
    } else {
      // --- Local backup file ---
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const filePath = path.join(BACKUPS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Backup file not found' });
      }
      backupData = readLocalBackupFile(filePath, filename);
    }

    const data = backupData?.data || backupData; // Handle both wrapper structure and plain object

    // v2 backups are validated inside restoreSnapshot using DMMF; v1 legacy backups may lack course/lesson arrays
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Incomplete backup: no data payload found' });
    }
    await performBackupAndPruning();
    await restoreSnapshot(prisma, backupData);

    res.json({ success: true, message: 'Database restored successfully from backup.' });
} catch (error: any) {
  console.error(' Restore error:', error);
  res.status(500).json({ error: 'Failed to restore database', details: error.message });
}
};


export const postBackupHandler14 = async (req: any, res: any) => {
  try {
    const { filename, courseId } = req.body;
    if (!filename || !courseId) {
      return res.status(400).json({ error: 'filename and courseId are required' });
    }
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Search in backups dir AND root dir for the file
    const searchPaths = [
      path.join(BACKUPS_DIR, filename),
      path.join(process.cwd(), filename)
    ];
    let filePath = searchPaths.find(p => fs.existsSync(p));
    if (!filePath) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    const backup = readLocalBackupFile(filePath, filename);
    const data = backup.data || backup;

    // Find the course in the backup
    const backupCourses: any[] = Array.isArray(data.course) ? data.course : [];
    const targetCourse = backupCourses.find((c: any) => c.id === courseId);
    if (!targetCourse) {
      return res.status(404).json({ error: `Course '${courseId}' not found in this backup file` });
    }

    // Find lessons and exams for this course
    const backupLessons: any[] = (Array.isArray(data.lesson) ? data.lesson : [])
      .filter((l: any) => l.courseId === courseId);

    const backupExams: any[] = (Array.isArray(data.exam) ? data.exam : [])
      .filter((e: any) => e.courseId === courseId);
    if (Array.isArray(targetCourse.exams)) {
      for (const ce of targetCourse.exams) {
        if (!backupExams.some((x: any) => x.id === ce.id)) backupExams.push(ce);
      }
    }

    console.log(`[Partial Restore] Found ${backupLessons.length} lessons and ${backupExams.length} exams for course '${targetCourse.title}' in backup ${filename}`);

    // Check if course exists in current DB
    const existingCourse = await prisma.course.findUnique({ where: { id: courseId } });

    await prisma.$transaction(async (tx) => {
      // Restore course if missing
      if (!existingCourse) {
        await tx.course.create({
          data: {
            ...targetCourse,
            createdAt: new Date(targetCourse.createdAt),
            updatedAt: new Date(targetCourse.updatedAt)
          }
        });
        console.log(`[Partial Restore] Restored missing course '${targetCourse.title}'`);
      }

      // For each lesson in backup: upsert (restore if missing, skip if exists)
      let restoredCount = 0;
      let skippedCount = 0;
      for (const lesson of backupLessons) {
        const existing = await tx.lesson.findUnique({ where: { id: lesson.id } });
        if (!existing) {
          await tx.lesson.create({
            data: {
              ...lesson,
              courseId,
              createdAt: new Date(lesson.createdAt),
              updatedAt: new Date(lesson.updatedAt),
              publishDate: lesson.publishDate ? new Date(lesson.publishDate) : null,
              cutOffDate: lesson.cutOffDate ? new Date(lesson.cutOffDate) : null
            }
          });
          restoredCount++;
        } else {
          skippedCount++;
        }
      }

      // Restore course exams with modular hierarchy and bilingual questions
      for (const exam of backupExams) {
        await restoreExamWithHierarchy(tx, exam, data, courseId);
      }

      console.log(`[Partial Restore] Restored: ${restoredCount}, Skipped (already exist): ${skippedCount}`);
    }, { timeout: 120000 });

    // Return fresh course data
    const freshCourse = await prisma.course.findUnique({
      where: { id: courseId },
      include: { lessons: { orderBy: { order: 'asc' } }, exams: true }
    });

    res.json({
      success: true,
      message: `Course lessons and exams restored from backup. Backup date: ${backup.timestamp || 'unknown'}`,
      course: freshCourse
    });
  } catch (error: any) {
    console.error('Partial restore error:', error);
    res.status(500).json({ error: 'Failed to restore course', details: error.message });
  }
};


export const getBackupHandler15 = async (req: any, res: any) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters long' });
    }

    const searchQuery = String(query).toLowerCase();
    const results: any[] = [];
    const foundLessonIds = new Set<string>();

    // 1️⃣ Search in Current Active Database
    try {
      const dbLessons = await prisma.lesson.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { domain: { contains: query, mode: 'insensitive' } },
            { course: { title: { contains: query, mode: 'insensitive' } } }
          ]
        },
        include: { course: true },
        take: 20
      });

      for (const lesson of dbLessons) {
        foundLessonIds.add(lesson.id);
        results.push({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          courseId: lesson.courseId,
          courseTitle: lesson.course?.title || 'Unknown Course',
          backupFilename: 'قاعدة البيانات الحالية (Active DB)',
          backupDate: lesson.updatedAt,
          isCurrentDB: true,
          source: 'active'
        });
      }
    } catch (err: any) {
      console.error('Error searching active DB:', err.message);
    }

    // 2️⃣ Search in ALL Local Backup Files (backups/, root, recovery.json, etc.)
    const searchDirs = [
      BACKUPS_DIR,
      process.cwd(),
      '/app',
      '/app/uploads/backups'
    ];
    const seenFiles = new Set<string>();
    const localFiles: { filename: string; filePath: string; mtime: Date }[] = [];

    for (const dir of searchDirs) {
      try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith('.json') && !file.endsWith('.zip')) continue;
          if (file.startsWith('backup-') || file.startsWith('backup_') || file === 'recovery.json' || file === 'courses_dump.json') {
            const fp = path.join(dir, file);
            if (!seenFiles.has(fp)) {
              seenFiles.add(fp);
              localFiles.push({ filename: file, filePath: fp, mtime: fs.statSync(fp).mtime });
            }
          }
        }
      } catch { /* skip */ }
    }

    localFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    for (const bFile of localFiles) {
      try {
        const backup = readLocalBackupFile(bFile.filePath, bFile.filename);
        const data = backup.data || backup;

        const backupLessons: any[] = Array.isArray(data.lesson) ? data.lesson : [];
        const backupCourses: any[] = Array.isArray(data.course) ? data.course : [];
        const courseMap = new Map(backupCourses.map((c: any) => [c.id, c.title]));

        for (const lesson of backupLessons) {
          if (!lesson?.title || !lesson?.id) continue;
          const matchTitle = lesson.title.toLowerCase().includes(searchQuery);
          const matchDomain = lesson.domain && lesson.domain.toLowerCase().includes(searchQuery);
          const matchCourse = courseMap.get(lesson.courseId)?.toLowerCase().includes(searchQuery);

          if (matchTitle || matchDomain || matchCourse) {
            if (!foundLessonIds.has(lesson.id)) {
              foundLessonIds.add(lesson.id);
              results.push({
                lessonId: lesson.id,
                lessonTitle: lesson.title,
                courseId: lesson.courseId,
                courseTitle: courseMap.get(lesson.courseId) || 'Unknown Course',
                backupFilename: bFile.filename,
                backupDate: bFile.mtime,
                source: 'local'
              });
            }
          }
        }
      } catch { /* skip malformed */ }
    }

    // 3️⃣ Search in Cloud Backup DB (cloud_backups table)
    try {
      const { Pool } = require('pg');
      const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
      const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 2, connectionTimeoutMillis: 5000 });

      const cloudRes = await cloudPool.query(`
        SELECT name, data, created_at
        FROM cloud_backups
        ORDER BY created_at DESC
        LIMIT 3;
      `);
      await cloudPool.end();

      for (const row of cloudRes.rows) {
        try {
          const data = row.data?.data || row.data;
          const courses: any[] = Array.isArray(data?.course) ? data.course : [];
          const lessons: any[] = Array.isArray(data?.lesson) ? data.lesson : [];
          const courseMap = new Map(courses.map((c: any) => [c.id, c.title]));

          // Extract lessons embedded in courses array (REALTIME_SYNC format)
          for (const c of courses) {
            if (Array.isArray(c.lessons)) {
              for (const l of c.lessons) {
                if (!l?.id || !l?.title) continue;
                if (l.title.toLowerCase().includes(searchQuery) && !foundLessonIds.has(l.id)) {
                  foundLessonIds.add(l.id);
                  results.push({
                    lessonId: l.id,
                    lessonTitle: l.title,
                    courseId: l.courseId || c.id,
                    courseTitle: c.title || 'Unknown Course',
                    backupFilename: `السحابة: ${row.name}`,
                    backupDate: row.created_at,
                    source: 'cloud'
                  });
                }
              }
            }
          }

          for (const l of lessons) {
            if (!l?.id || !l?.title) continue;
            if (l.title.toLowerCase().includes(searchQuery) && !foundLessonIds.has(l.id)) {
              foundLessonIds.add(l.id);
              results.push({
                lessonId: l.id,
                lessonTitle: l.title,
                courseId: l.courseId,
                courseTitle: courseMap.get(l.courseId) || 'Unknown Course',
                backupFilename: `السحابة: ${row.name}`,
                backupDate: row.created_at,
                source: 'cloud'
              });
            }
          }
        } catch { /* skip */ }
      }
    } catch (cloudErr: any) {
      console.warn('Warning: Cloud backup DB search skipped:', cloudErr.message);
    }

    res.json({ results, totalCount: results.length });
  } catch (error: any) {
    console.error(' Search lesson error:', error);
    res.status(500).json({ error: 'Failed to search for lesson', details: error.message });
  }
};


export const postBackupHandler16 = async (req: any, res: any) => {
  try {
    const { filename, source } = req.body;
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
          if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
          const fp = path.join(dir, filename);
          if (fs.existsSync(fp)) {
            const parsed = readLocalBackupFile(fp, filename);
            backupData = parsed.data || parsed;
          }
        } catch {}
      }
    }

    if (!backupData) {
      return res.status(404).json({ error: 'Backup not found or unable to parse.' });
    }

    const courses = Array.isArray(backupData.course) ? backupData.course : [];
    const lessons = Array.isArray(backupData.lesson) ? backupData.lesson : [];
    const exams = Array.isArray(backupData.exam) ? backupData.exam : [];
    const questions = Array.isArray(backupData.question) ? backupData.question : [];
    const modules = Array.isArray(backupData.examModule) ? backupData.examModule : [];
    const subExams = Array.isArray(backupData.subExam) ? backupData.subExam : [];

    const formatExamLabel = (e: any) => {
      const examQuestions = questions.filter((q: any) => q.examId === e.id);
      const embeddedQ = Array.isArray(e.questions) ? e.questions : [];
      const totalQ = Math.max(examQuestions.length, embeddedQ.length);

      const examModules = modules.filter((m: any) => m.examId === e.id);
      const embeddedM = Array.isArray(e.modules) ? e.modules : [];
      const totalM = Math.max(examModules.length, embeddedM.length);

      const hasBilingual = [...examQuestions, ...embeddedQ].some((q: any) => q?.textEn || q?.optionsEn);
      const tags: string[] = [];
      if (totalQ > 0) tags.push(`${totalQ} سؤال`);
      if (totalM > 0) tags.push(`${totalM} موديول`);
      if (hasBilingual) tags.push('ثنائي اللغة');

      return tags.length > 0 ? `${e.title || 'Untitled'} (${tags.join(' - ')})` : (e.title || 'Untitled');
    };

    const tree: any[] = [];
    const attachedExamIds = new Set<string>();

    for (const c of courses) {
      const courseNode = {
        id: c.id,
        type: 'course',
        title: c.title,
        children: [] as any[]
      };

      const courseLessons = lessons.filter((l: any) => l.courseId === c.id);
      for (const l of courseLessons) {
        courseNode.children.push({ id: l.id, type: 'lesson', title: l.title });
      }

      const courseExams = exams.filter((e: any) => e.courseId === c.id);
      if (Array.isArray(c.exams)) {
        for (const ce of c.exams) {
          if (!courseExams.some((x: any) => x.id === ce.id)) courseExams.push(ce);
        }
      }
      for (const e of courseExams) {
        attachedExamIds.add(e.id);
        courseNode.children.push({ id: e.id, type: 'exam', title: formatExamLabel(e) });
      }

      tree.push(courseNode);
    }

    const standaloneExams = exams.filter((e: any) => !attachedExamIds.has(e.id));
    if (standaloneExams.length > 0) {
      const standaloneNode = {
        id: 'standalone_exams',
        type: 'course',
        title: 'امتحانات مستقلة ومركزية',
        children: standaloneExams.map((e: any) => ({
          id: e.id,
          type: 'exam',
          title: formatExamLabel(e)
        }))
      };
      tree.push(standaloneNode);
    }

    const courseIdSet = new Set(courses.map((c: any) => c.id));
    const orphanedLessons = lessons.filter((l: any) => !courseIdSet.has(l.courseId));
    if (orphanedLessons.length > 0) {
      const orphanNode = { id: 'orphaned_lessons', type: 'course', title: 'دروس منفصلة', children: [] as any[] };
      for (const l of orphanedLessons) orphanNode.children.push({ id: l.id, type: 'lesson', title: l.title });
      tree.push(orphanNode);
    }

    res.json({ tree });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to explore backup', details: error.message });
  }
};


