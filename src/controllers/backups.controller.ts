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
    console.error('❌ Backup creation error:', error);
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
    console.error('❌ Backup list error:', error);
    res.status(500).json({ error: 'Failed to list backups', details: error.message });
  }
};


export const getBackupHandler3 = async (req: any, res: any) => {
  try {
    const cloudBackups = await getCloudBackups();
    const filtered = cloudBackups.filter((cb: any) => cb.type !== 'REALTIME_SYNC');
    res.json(filtered);
  } catch (error: any) {
    console.error('❌ Cloud backup list error:', error);
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
    console.error('❌ Cloud backup create error:', error);
    res.status(500).json({ error: 'Failed to create cloud backup', details: error.message });
  }
};


export const postBackupHandler5 = async (req: any, res: any) => {
  try {
    const allCourses = await prisma.course.findMany({
      include: {
        lessons: { include: { blocks: true } },
        exams: { include: { questions: true } },
        schools: true,
        school: true
      }
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_forced_sync_${timestamp}`;
    const saved = await saveToCloudBackup(backupName, 'REALTIME_SYNC', {
      data: { course: allCourses }
    });

    if (!saved) {
      return res.status(500).json({ error: 'Failed to sync courses to Cloud Backup' });
    }

    console.log(`☁️ [Force Sync] Synced ${allCourses.length} courses to Cloud Backup as REALTIME_SYNC`);
    res.json({
      message: `تمت مزامنة ${allCourses.length} كورس بنجاح إلى Cloud Backup`,
      coursesCount: allCourses.length,
      backupName
    });
  } catch (error: any) {
    console.error('❌ Cloud sync-all error:', error);
    res.status(500).json({ error: 'Failed to sync all courses', details: error.message });
  }
};


export const postBackupHandler6 = async (req: any, res: any) => {
  try {
    const { Pool } = require('pg');
    const BACKUP_DB_URL = process.env.BACKUP_DB_URL as string;
    const cloudPool = new Pool({ connectionString: BACKUP_DB_URL, max: 3, connectionTimeoutMillis: 8000 });

    // 1. Fetch the most recent cloud backup records (prefer REALTIME_SYNC then AUTO_HOURLY)
    const result = await cloudPool.query(`
      SELECT data, created_at, type
      FROM cloud_backups
      WHERE type IN ('REALTIME_SYNC', 'AUTO_HOURLY', 'MANUAL')
      ORDER BY created_at DESC
      LIMIT 30;
    `);
    await cloudPool.end();

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'No cloud backup records found' });
    }

    // 2. Merge all course + lesson data from cloud records (newest first)
    const mergedCourses = new Map<string, any>();
    const mergedLessons = new Map<string, any>();

    for (const row of result.rows) {
      try {
        const payload = row.data;
        const data = payload?.data || payload;

        const courses: any[] = Array.isArray(data?.course) ? data.course : [];
        const lessons: any[] = Array.isArray(data?.lesson) ? data.lesson : [];

        for (const c of courses) {
          if (c?.id && !mergedCourses.has(c.id)) {
            mergedCourses.set(c.id, c);
            // Also extract lessons embedded inside course objects (REALTIME_SYNC format)
            if (Array.isArray(c.lessons)) {
              for (const l of c.lessons) {
                if (l?.id && !mergedLessons.has(l.id)) {
                  mergedLessons.set(l.id, { ...l, courseId: l.courseId || c.id });
                }
              }
            }
          }
        }
        for (const l of lessons) {
          if (l?.id && !mergedLessons.has(l.id)) {
            mergedLessons.set(l.id, l);
          }
        }
      } catch { /* skip malformed records */ }
    }

    console.log(`☁️ [Cloud Restore] Found ${mergedCourses.size} courses and ${mergedLessons.size} lessons in cloud backup pool`);

    // 3. Load current primary DB state
    const [activeCourses, activeLessons] = await Promise.all([
      prisma.course.findMany({ select: { id: true } }),
      prisma.lesson.findMany({ select: { id: true } }),
    ]);
    const activeCourseIds = new Set(activeCourses.map((c: any) => c.id));
    const activeLessonIds = new Set(activeLessons.map((l: any) => l.id));

    const toDate = (v: any) => v ? (isNaN(new Date(v).getTime()) ? null : new Date(v)) : null;

    let restoredCourses = 0;
    let restoredLessons = 0;
    let skippedCourses = 0;
    let skippedLessons = 0;
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
        details.push(`✅ Course: "${c.title}"`);
        console.log(`✅ [Cloud Restore] Restored course: "${c.title}" (${courseId})`);
      } catch (err: any) {
        if (err.code === 'P2002') { skippedCourses++; activeCourseIds.add(courseId); }
        else { details.push(`⚠️ Course "${c.title}": ${err.message}`); skippedCourses++; }
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
            domain: l.domain ?? null,
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
        details.push(`  📚 Lesson: "${l.title}"`);
        console.log(`✅ [Cloud Restore] Restored lesson: "${l.title}" → course ${l.courseId}`);
      } catch (err: any) {
        if (err.code === 'P2002') { skippedLessons++; }
        else { details.push(`  ⚠️ Lesson "${l.title}": ${err.message}`); skippedLessons++; }
      }
    }

    const summary = {
      success: true,
      message: `تم استعادة ${restoredCourses} كورس و ${restoredLessons} درس من Cloud Backup إلى قاعدة البيانات الأساسية`,
      restoredCourses,
      restoredLessons,
      skippedCourses,
      skippedLessons,
      cloudRecordsScanned: result.rows.length,
      details: details.slice(0, 100) // limit details output
    };

    console.log(`\n☁️ [Cloud Restore] COMPLETE — Courses: ${restoredCourses} restored, ${skippedCourses} skipped | Lessons: ${restoredLessons} restored, ${skippedLessons} skipped`);
    res.json(summary);
  } catch (error: any) {
    console.error('❌ Cloud restore error:', error);
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
    console.error('❌ Backup download error:', error);
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
    console.error('❌ Download full backup with media error:', error);
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
    console.error('❌ Download all backups error:', error);
    res.status(500).json({ error: 'Failed to create zip for all backups', details: error.message });
  }
};


export const postBackupHandler10 = async (req: any, res: any) => {
  try {
    const result = await createManualBundle();
    res.json(result);
  } catch (error: any) {
    console.error('❌ Manual bundle backups error:', error);
    res.status(500).json({ error: error.message || 'Failed to create manual bundle' });
  }
};

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
          console.log(`✅ Extracted ${extractedMediaCount} media files from uploaded backup`);
        }
      } catch (err: any) {
        console.error('⚠️ Failed to extract media from ZIP:', err.message);
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
    console.error('❌ Backup upload error:', error);
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
    console.error('❌ Delete backup error:', error);
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

    const backupCourses: any[] = Array.isArray(data.course) ? data.course : [];
    const backupLessons: any[] = Array.isArray(data.lesson) ? data.lesson : [];
    if (backupCourses.length === 0 || backupLessons.length === 0) {
      return res.status(400).json({
        error: 'Invalid backup content',
        details: 'A full restore requires both course and lesson arrays. Refusing to wipe current data with an incomplete backup.'
      });
    }

    // Preserve a safety snapshot before any restore attempt so we can roll back manually if needed.
    try {
      await performBackupAndPruning();
    } catch (snapshotError: any) {
      console.warn('⚠️ Failed to create safety snapshot before restore:', snapshotError.message);
    }

    // Merge restore: update/create records instead of deleting the current database.
    // This prevents accidental data loss if the selected backup is incomplete or older than the current state.
    await prisma.$transaction(async (tx) => {
      const toDate = (value: any) => (value ? new Date(value) : value === null ? null : undefined);

      if (data.school && data.school.length > 0) {
        for (const school of data.school) {
          if (!school?.id) continue;
          const payload = {
            name: school.name,
            subdomain: school.subdomain ?? null,
            themeColor: school.themeColor ?? null,
            status: school.status ?? 'ACTIVE',
            createdAt: toDate(school.createdAt) ?? new Date(),
            updatedAt: toDate(school.updatedAt) ?? new Date()
          };
          await tx.school.upsert({
            where: { id: school.id },
            update: payload,
            create: { id: school.id, ...payload }
          });
        }
      }
      if (data.user && data.user.length > 0) {
        for (const user of data.user) {
          if (!user?.id) continue;
          const payload = {
            name: user.name,
            username: user.username,
            email: user.email ?? null,
            password: user.password,
            role: user.role ?? 'STUDENT',
            avatar: user.avatar ?? null,
            phone: user.phone ?? null,
            status: user.status ?? 'ACTIVE',
            gender: user.gender ?? null,
            address: user.address ?? null,
            grade: user.grade ?? null,
            specialization: user.specialization ?? null,
            schoolId: user.schoolId ?? null,
            classroomId: user.classroomId ?? null,
            parentId: user.parentId ?? null,
            xp: user.xp ?? 0,
            createdAt: toDate(user.createdAt) ?? new Date(),
            updatedAt: toDate(user.updatedAt) ?? new Date() };

            const orConditions: any[] = [{ username: user.username }];
            if (user.email) orConditions.push({ email: user.email });
            const conflictingUser = await tx.user.findFirst({ where: { OR: orConditions } });
            if (conflictingUser && conflictingUser.id !== user.id) {
              try {
                await tx.user.delete({ where: { id: conflictingUser.id } });
              } catch (e) {
                console.warn("Could not delete conflicting user, skipping restore for this user.");
                continue;
              }
            }

            await tx.user.upsert({
            where: { id: user.id },
            update: payload,
            create: { id: user.id, ...payload }
          });
        }
      }
      if (data.classroom && data.classroom.length > 0) {
        for (const classroom of data.classroom) {
          if (!classroom?.id) continue;
          const payload = {
            name: classroom.name,
            grade: classroom.grade,
            schoolId: classroom.schoolId,
            teacherId: classroom.teacherId ?? null,
            createdAt: toDate(classroom.createdAt) ?? new Date(),
            updatedAt: toDate(classroom.updatedAt) ?? new Date()
          };
          await tx.classroom.upsert({
            where: { id: classroom.id },
            update: payload,
            create: { id: classroom.id, ...payload }
          });
        }
      }
      if (data.course && data.course.length > 0) {
        for (const course of data.course) {
          if (!course?.id) continue;
          const payload = {
            title: course.title,
            description: normalizeRestoredValue(course.description ?? null),
            coverImage: normalizeRestoredValue(course.coverImage ?? null),
            grade: course.grade ?? null,
            grades: course.grades ?? null,
            subject: course.subject ?? null,
            country: course.country ?? 'مصر',
            isCentral: course.isCentral ?? false,
            schoolId: course.schoolId ?? null,
            createdAt: toDate(course.createdAt) ?? new Date(),
            updatedAt: toDate(course.updatedAt) ?? new Date()
          };
          await tx.course.upsert({
            where: { id: course.id },
            update: payload,
            create: { id: course.id, ...payload }
          });
        }
      }
      // Pre-fetch valid course IDs to prevent FK constraint failures on orphaned items
      const validCourseIds = new Set<string>();
      const existingCourses = await tx.course.findMany({ select: { id: true } });
      existingCourses.forEach(c => validCourseIds.add(c.id));

      if (data.studentEnrollment && data.studentEnrollment.length > 0) {
        await tx.studentEnrollment.createMany({
          data: data.studentEnrollment.filter((x: any) => validCourseIds.has(x.courseId)).map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.teacherCourse && data.teacherCourse.length > 0) {
        await tx.teacherCourse.createMany({
          data: data.teacherCourse.filter((x: any) => validCourseIds.has(x.courseId)).map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt)
          })),
          skipDuplicates: true
        });
      }

      if (data.lesson && data.lesson.length > 0) {
        for (const lesson of data.lesson) {
          if (!lesson?.id) continue;
          if (lesson.courseId && !validCourseIds.has(lesson.courseId)) {
            console.warn(`Skipping lesson ${lesson.title} because courseId ${lesson.courseId} is missing.`);
            continue;
          }
          const payload = {
            courseId: lesson.courseId,
            title: lesson.title,
            domain: lesson.domain ?? null,
            content: normalizeRestoredValue(lesson.content ?? null),
            videoUrl: lesson.videoUrl ?? null,
            summary: normalizeRestoredValue(lesson.summary ?? null),
            notes: normalizeRestoredValue(lesson.notes ?? null),
            questions: normalizeRestoredValue(lesson.questions ?? null),
            attachments: normalizeRestoredValue(lesson.attachments ?? null),
            slides: normalizeRestoredValue(lesson.slides ?? null),
            assignments: normalizeRestoredValue(lesson.assignments ?? null),
            standards: lesson.standards ?? null,
            indicators: lesson.indicators ?? null,
            learningOutcomes: lesson.learningOutcomes ?? null,
            isCentral: lesson.isCentral ?? false,
            isVisible: lesson.isVisible !== undefined ? !!lesson.isVisible : true,
            publishDate: lesson.publishDate ? new Date(lesson.publishDate) : null,
            cutOffDate: lesson.cutOffDate ? new Date(lesson.cutOffDate) : null,
            order: lesson.order ?? 0,
            duration: lesson.duration ?? 0,
            createdAt: toDate(lesson.createdAt) ?? new Date(),
            updatedAt: toDate(lesson.updatedAt) ?? new Date()
          };
          await tx.lesson.upsert({
            where: { id: lesson.id },
            update: payload,
            create: { id: lesson.id, ...payload }
          });
        }
      }
      if (data.lessonProgress && data.lessonProgress.length > 0) {
        await tx.lessonProgress.createMany({
          data: data.lessonProgress.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt),
            updatedAt: new Date(x.updatedAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.courseProgress && data.courseProgress.length > 0) {
        await tx.courseProgress.createMany({
          data: data.courseProgress.filter((x: any) => validCourseIds.has(x.courseId)).map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt),
            updatedAt: new Date(x.updatedAt),
            lastAccessedAt: new Date(x.lastAccessedAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.exam && data.exam.length > 0) {
        for (const exam of data.exam) {
          if (!exam?.id) continue;
          if (exam.courseId && !validCourseIds.has(exam.courseId)) {
            console.warn(`Skipping exam ${exam.title} because courseId ${exam.courseId} is missing.`);
            continue;
          }
          const payload = {
            title: exam.title,
            description: normalizeRestoredValue(exam.description ?? null),
            type: exam.type ?? 'Quiz',
            duration: exam.duration ?? 30,
            passingScore: exam.passingScore ?? 50,
            isCentral: exam.isCentral ?? false,
            showAnswers: exam.showAnswers ?? true,
            resultVisibility: exam.resultVisibility ?? 'SHOW_SCORE',
            password: exam.password ?? null,
            startDate: exam.startDate ? new Date(exam.startDate) : null,
            endDate: exam.endDate ? new Date(exam.endDate) : null,
            attemptsAllowed: exam.attemptsAllowed ?? 1,
            status: exam.status ?? 'PUBLISHED',
            category: exam.category ?? null,
            grade: exam.grade ?? null,
            grades: exam.grades ?? null,
            subjects: exam.subjects ?? null,
            schoolId: exam.schoolId ?? null,
            courseId: exam.courseId ?? null,
            skill: exam.skill ?? null,
            level: exam.level ?? 'Medium',
            createdAt: toDate(exam.createdAt) ?? new Date(),
            updatedAt: toDate(exam.updatedAt) ?? new Date()
          };
          await tx.exam.upsert({
            where: { id: exam.id },
            update: payload,
            create: { id: exam.id, ...payload }
          });
        }
      }
      if (data.question && data.question.length > 0) {
        for (const question of data.question) {
          if (!question?.id) continue;
          const payload = {
            examId: question.examId,
            text: normalizeRestoredValue(question.text),
            type: question.type ?? 'MCQ',
            options: normalizeRestoredValue(question.options),
            correctAnswer: normalizeRestoredValue(question.correctAnswer),
            points: question.points ?? 0,
            skill: question.skill ?? null,
            standard: question.standard ?? null,
            learningOutcome: question.learningOutcome ?? null,
            level: question.level ?? 'Medium',
            order: question.order ?? 0,
            explanation: normalizeRestoredValue(question.explanation ?? null),
            createdAt: toDate(question.createdAt) ?? new Date(),
            updatedAt: toDate(question.updatedAt) ?? new Date()
          };
          await tx.question.upsert({
            where: { id: question.id },
            update: payload,
            create: { id: question.id, ...payload }
          });
        }
      }
      if (data.examSubmission && data.examSubmission.length > 0) {
        await tx.examSubmission.createMany({
          data: data.examSubmission.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.studentAnswer && data.studentAnswer.length > 0) {
        await tx.studentAnswer.createMany({
          data: data.studentAnswer.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.activityLog && data.activityLog.length > 0) {
        await tx.activityLog.createMany({
          data: data.activityLog.map((x: any) => ({
            ...x,
            timestamp: new Date(x.timestamp)
          })),
          skipDuplicates: true
        });
      }
      if (data.lessonBlock && data.lessonBlock.length > 0) {
        for (const block of data.lessonBlock) {
          if (!block?.id) continue;
          const blockPayload = {
            lessonId: block.lessonId,
            type: block.type,
            content: block.content ?? null,
            order: block.order ?? 0,
            createdAt: block.createdAt ? new Date(block.createdAt) : new Date(),
            updatedAt: block.updatedAt ? new Date(block.updatedAt) : new Date()
          };
          await tx.lessonBlock.upsert({
            where: { id: block.id },
            update: blockPayload,
            create: { id: block.id, ...blockPayload }
          });
        }
      }
      if (data.dynamicSection && data.dynamicSection.length > 0) {
        await tx.dynamicSection.createMany({
          data: data.dynamicSection.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt),
            updatedAt: new Date(x.updatedAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.blockAnswer && data.blockAnswer.length > 0) {
        await tx.blockAnswer.createMany({
          data: data.blockAnswer.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt),
            updatedAt: new Date(x.updatedAt)
          })),
          skipDuplicates: true
        });
      }

      if (data.skillCluster && data.skillCluster.length > 0) {
        await tx.skillCluster.createMany({
          data: data.skillCluster.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt),
            updatedAt: new Date(x.updatedAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.skillLesson && data.skillLesson.length > 0) {
        await tx.skillLesson.createMany({
          data: data.skillLesson.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt),
            updatedAt: new Date(x.updatedAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.interactiveActivity && data.interactiveActivity.length > 0) {
        await tx.interactiveActivity.createMany({
          data: data.interactiveActivity.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt),
            updatedAt: new Date(x.updatedAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.activityAttempt && data.activityAttempt.length > 0) {
        await tx.activityAttempt.createMany({
          data: data.activityAttempt.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt)
          })),
          skipDuplicates: true
        });
      }
      if (data.xpHistory && data.xpHistory.length > 0) {
        await tx.xPHistory.createMany({
          data: data.xpHistory.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt)
          })),
          skipDuplicates: true
        });
      }

      // 3. Connect implicit M:N relationships
      if (data.courseToSchool && data.courseToSchool.length > 0) {
        for (const item of data.courseToSchool) {
          const validSchools = (item.schools || [])
            .map((s: any) => (typeof s === "object" && s ? s.id : s))
            .filter((id: any): id is string => Boolean(id && typeof id === "string" && id !== "null" && id !== "undefined" && id.trim() !== ""))
            .map((id: string) => ({ id: id.trim() }));
          if (validSchools.length > 0) {
            await tx.course.update({
              where: { id: item.id },
              data: {
                schools: {
                  connect: validSchools
                }
              }
            });
          }
        }
      }
      if (data.examToSchool && data.examToSchool.length > 0) {
        for (const item of data.examToSchool) {
          const validSchools = (item.schools || [])
            .map((s: any) => (typeof s === "object" && s ? s.id : s))
            .filter((id: any): id is string => Boolean(id && typeof id === "string" && id !== "null" && id !== "undefined" && id.trim() !== ""))
            .map((id: string) => ({ id: id.trim() }));
          if (validSchools.length > 0) {
            await tx.exam.update({
              where: { id: item.id },
              data: {
                schools: {
                  connect: validSchools
                }
              }
            });
          }
        }
      }
    }, {
      timeout: 300000  // 5 minutes - needed for large datasets with many slides
    });

    res.json({ success: true, message: 'Database restored successfully from backup.' });
} catch (error: any) {
  console.error('❌ Restore error:', error);
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

    // Find lessons for this course
    const backupLessons: any[] = (Array.isArray(data.lesson) ? data.lesson : [])
      .filter((l: any) => l.courseId === courseId);

    console.log(`[Partial Restore] Found ${backupLessons.length} lessons for course '${targetCourse.title}' in backup ${filename}`);

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

      console.log(`[Partial Restore] Restored: ${restoredCount}, Skipped (already exist): ${skippedCount}`);
    }, { timeout: 120000 });

    // Return fresh course data
    const freshCourse = await prisma.course.findUnique({
      where: { id: courseId },
      include: { lessons: { orderBy: { order: 'asc' } } }
    });

    res.json({
      success: true,
      message: `Course lessons restored from backup. Backup date: ${backup.timestamp || 'unknown'}`,
      course: freshCourse
    });
  } catch (error: any) {
    console.error('❌ Partial restore error:', error);
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
    console.error('❌ Search lesson error:', error);
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

    const tree: any[] = [];
    
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
      for (const e of courseExams) {
        courseNode.children.push({ id: e.id, type: 'exam', title: e.title });
      }
      
      tree.push(courseNode);
    }
    
    // Check for orphaned lessons/exams (just in case)
    const orphanedLessons = lessons.filter((l: any) => !courses.find((c: any) => c.id === l.courseId));
    if (orphanedLessons.length > 0) {
      const orphanNode = { id: 'orphans', type: 'course', title: 'Orphaned Items', children: [] as any[] };
      for (const l of orphanedLessons) orphanNode.children.push({ id: l.id, type: 'lesson', title: l.title });
      tree.push(orphanNode);
    }

    res.json({ tree });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to explore backup', details: error.message });
  }
};


export const postBackupHandler17 = async (req: any, res: any) => {
  try {
    const { filename, source, selections } = req.body;
    if (!selections || !Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ error: 'No items selected for restore.' });
    }

    let backupData: any = null;

    // ... Load backupData (same logic as explore)
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
    const bExams = Array.isArray(backupData.exam) ? backupData.exam : [];
    
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
              update: { courseId: c.id, title: l.title, domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() },
              create: { id: l.id, courseId: c.id, title: l.title || 'Untitled', domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() }
            });
          }
          
          // Restore all its exams
          const cExams = bExams.filter((e: any) => e.courseId === c.id);
          for (const e of cExams) {
            const ePayload = {
              title: e.title ?? 'Untitled',
              description: e.description ?? null,
              type: e.type ?? 'Quiz',
              duration: e.duration ?? 30,
              passingScore: e.passingScore ?? 50,
              isCentral: e.isCentral ?? false,
              showAnswers: e.showAnswers ?? true,
              resultVisibility: e.resultVisibility ?? 'SHOW_SCORE',
              password: e.password ?? null,
              startDate: e.startDate ? new Date(e.startDate) : null,
              endDate: e.endDate ? new Date(e.endDate) : null,
              attemptsAllowed: e.attemptsAllowed ?? 1,
              status: e.status ?? 'PUBLISHED',
              category: e.category ?? null,
              grade: e.grade ?? null,
              grades: e.grades ?? null,
              subjects: e.subjects ?? null,
              schoolId: e.schoolId ?? null,
              courseId: c.id,
              skill: e.skill ?? null,
              level: e.level ?? 'Medium',
              createdAt: toDate(e.createdAt) ?? new Date(),
              updatedAt: toDate(e.updatedAt) ?? new Date()
            };
            await tx.exam.upsert({
              where: { id: e.id },
              update: ePayload,
              create: { id: e.id, ...ePayload }
            });
          }
        } 
        else if (sel.type === 'lesson') {
          const l = bLessons.find((x: any) => x.id === sel.id);
          if (!l) continue;
          const targetCourseId = sel.targetCourseId || l.courseId;
          await tx.lesson.upsert({
            where: { id: l.id },
            update: { courseId: targetCourseId, title: l.title, domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, updatedAt: new Date() },
            create: { id: l.id, courseId: targetCourseId, title: l.title || 'Untitled', domain: l.domain, content: l.content, videoUrl: l.videoUrl, duration: l.duration || 0, summary: l.summary, notes: l.notes, questions: parseSafe(l.questions), assignments: parseSafe(l.assignments), attachments: parseSafe(l.attachments), slides: parseSafe(l.slides), standards: l.standards, indicators: l.indicators, learningOutcomes: l.learningOutcomes, isCentral: l.isCentral || false, isVisible: l.isVisible !== false, publishDate: toDate(l.publishDate), cutOffDate: toDate(l.cutOffDate), order: l.order || 0, createdAt: toDate(l.createdAt) || new Date(), updatedAt: toDate(l.updatedAt) || new Date() }
          });
        }
        else if (sel.type === 'exam') {
          const e = bExams.find((x: any) => x.id === sel.id);
          if (!e) continue;
          const targetCourseId = sel.targetCourseId || e.courseId;
          const ePayload = {
            title: e.title ?? 'Untitled',
            description: e.description ?? null,
            type: e.type ?? 'Quiz',
            duration: e.duration ?? 30,
            passingScore: e.passingScore ?? 50,
            isCentral: e.isCentral ?? false,
            showAnswers: e.showAnswers ?? true,
            resultVisibility: e.resultVisibility ?? 'SHOW_SCORE',
            password: e.password ?? null,
            startDate: e.startDate ? new Date(e.startDate) : null,
            endDate: e.endDate ? new Date(e.endDate) : null,
            attemptsAllowed: e.attemptsAllowed ?? 1,
            status: e.status ?? 'PUBLISHED',
            category: e.category ?? null,
            grade: e.grade ?? null,
            grades: e.grades ?? null,
            subjects: e.subjects ?? null,
            schoolId: e.schoolId ?? null,
            courseId: targetCourseId,
            skill: e.skill ?? null,
            level: e.level ?? 'Medium',
            createdAt: toDate(e.createdAt) ?? new Date(),
            updatedAt: toDate(e.updatedAt) ?? new Date()
          };
          await tx.exam.upsert({
            where: { id: e.id },
            update: ePayload,
            create: { id: e.id, ...ePayload }
          });
        }
      }
    }, { timeout: 60000 }); // 60s timeout for large restores

    res.json({ success: true, message: 'Selective restore completed successfully.' });
  } catch (error: any) {
    console.error('❌ Selective restore error:', error);
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
        domain: targetLesson.domain ?? null,
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
        domain: targetLesson.domain ?? null,
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

    res.send(`✅ تم إضافة الدرس بنجاح إلى الكورس المطلوب!`);
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
              break;
            }
          }
        }
        if (!targetLesson) {
          const found = lessons.find((l: any) => l.id === lessonId);
          if (found) {
            targetLesson = found;
            targetCourse = courses.find((c: any) => c.id === found.courseId);
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
          domain: targetLesson.domain ?? null,
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
          domain: targetLesson.domain ?? null,
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

      // 🔓 Remove from tombstones if previously marked as deleted
      const { unmarkLessonDeleted, unmarkCourseDeleted } = await import('../lib/tombstones');
      unmarkLessonDeleted(lessonId);
      if (targetLesson.courseId) unmarkCourseDeleted(targetLesson.courseId);
    });

    const freshLesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { course: true } });

    console.log(`✅ [Lesson Restore] Restored lesson "${freshLesson?.title}" (${lessonId}) to course "${freshLesson?.course?.title}"`);

    res.json({
      success: true,
      message: `تم استعادة الدرس "${freshLesson?.title}" بنجاح في قاعدة البيانات الحالية.`,
      lesson: freshLesson
    });
  } catch (error: any) {
    console.error('❌ Lesson restore error:', error);
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
      console.log(`📂 [Content Restore] Using largest backup: ${files[0].name} (${(files[0].size / 1024 / 1024).toFixed(1)} MB)`);
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

    console.log(`\n🎯 [Content Restore] Processing ${backupLessons.length} lessons from backup...`);

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
        console.log(`  ⚠ Lesson not found in DB: "${bl.title}" (${bl.id})`);
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

      console.log(`  ✅ "${current.title}" [${changes}]`);
      report.push({ lessonId: bl.id, title: current.title, changes });
      updated++;
    }

    console.log(`\n🎯 [Content Restore] DONE — Updated: ${updated}, Skipped (already ok): ${skipped}, Not found: ${notFound}`);

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
    console.error('❌ [Content Restore] Error:', error);
    return res.status(500).json({ error: 'Failed to restore lesson content', details: error.message });
  }
};


export const BACKUPS_DIR = path.join(process.cwd(), 'uploads', 'backups');

export function parseBackupBuffer(buffer: Buffer, filename: string): any {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith('.zip')) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buffer);
    assertSafeArchiveEntries(zip.getEntries());
    const entries = zip.getEntries()
      .filter((entry: any) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.json'))
      .sort((a: any, b: any) => b.header.size - a.header.size);

    if (entries.length === 0) {
      throw new Error('ZIP backup does not contain a JSON payload.');
    }

    return JSON.parse(entries[0].getData().toString('utf-8'));
  }

  return JSON.parse(buffer.toString('utf-8'));
}

export async function generateFullSystemBackupData() {
  const [
    schools,
    users,
    classrooms,
    courses,
    studentEnrollments,
    teacherCourses,
    lessons,
    exams,
    questions,
    lessonBlocks,
    dynamicSections,
    examsWithSchools,
    coursesWithSchools,
    skillClusters,
    skillLessons,
    interactiveActivities,
    lessonProgress,
    courseProgress,
    examSubmission,
    studentAnswer,
    activityLog,
    blockAnswer,
    activityAttempt,
    xpHistory
  ] = await Promise.all([
    prisma.school.findMany(),
    prisma.user.findMany(),
    prisma.classroom.findMany(),
    prisma.course.findMany({ where: { deletedAt: null } }),
    prisma.studentEnrollment.findMany(),
    prisma.teacherCourse.findMany(),
    prisma.lesson.findMany({ where: { deletedAt: null } }),
    prisma.exam.findMany(),
    prisma.question.findMany(),
    prisma.lessonBlock.findMany(),
    prisma.dynamicSection.findMany(),
    prisma.exam.findMany({ select: { id: true, schools: { select: { id: true } } } }),
    prisma.course.findMany({ where: { deletedAt: null }, select: { id: true, schools: { select: { id: true } } } }),
    prisma.skillCluster.findMany(),
    prisma.skillLesson.findMany(),
    prisma.interactiveActivity.findMany(),
    prisma.lessonProgress.findMany(),
    prisma.courseProgress.findMany(),
    prisma.examSubmission.findMany(),
    prisma.studentAnswer.findMany(),
    prisma.activityLog.findMany(),
    prisma.blockAnswer.findMany(),
    prisma.activityAttempt.findMany(),
    prisma.xPHistory.findMany()
  ]);

  return {
    version: '1.0',
    timestamp: new Date().toISOString(),
    data: {
      school: schools,
      user: users,
      classroom: classrooms,
      course: courses,
      studentEnrollment: studentEnrollments,
      teacherCourse: teacherCourses,
      lesson: lessons,
      exam: exams,
      question: questions,
      lessonBlock: lessonBlocks,
      dynamicSection: dynamicSections,
      examToSchool: examsWithSchools,
      courseToSchool: coursesWithSchools,
      skillCluster: skillClusters,
      skillLesson: skillLessons,
      interactiveActivity: interactiveActivities,
      lessonProgress: lessonProgress,
      courseProgress: courseProgress,
      examSubmission: examSubmission,
      studentAnswer: studentAnswer,
      activityLog: activityLog,
      blockAnswer: blockAnswer,
      activityAttempt: activityAttempt,
      xpHistory: xpHistory
    }
  };
}

export async function performBackupAndPruning(): Promise<{ filename: string; size: number; createdAt: string }> {
  const egyptTime = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour12: false });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.json`;
  const filePath = path.join(BACKUPS_DIR, filename);

  const backupData = await generateFullSystemBackupData();

  // 1️⃣ Save locally
  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');
  const size = fs.statSync(filePath).size;
  console.log(`💾 [Backup] Saved locally: ${filename} | توقيت مصر: ${egyptTime}`);

  // 2️⃣ Save to Cloud Backup cloud in background (non-blocking)
  const cloudName = `auto_hourly_backup_egypt_${egyptTime.replace(/[/,:\s]/g, '-')}`;
  saveToCloudBackup(cloudName, 'AUTO_HOURLY', backupData)
    .then(saved => {
      if (saved) {
        console.log(`☁️ [Backup] Saved to Cloud Backup cloud: ${cloudName}`);
      } else {
        console.warn(`⚠️ [Backup] Cloud save skipped (Cloud Backup unavailable): ${cloudName}`);
      }
    })
    .catch((err: any) => {
      console.error(`❌ [Backup] Cloud save failed: ${err.message}`);
    });

  // 3️⃣ Prune local backups — keep only the latest 100
  // Keep only the latest 100 backups (= ~100 hours at hourly intervals, Egypt time)
  // Older backups are deleted only when the count exceeds 100
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(file => (file.startsWith('auto_hourly_') || file.startsWith('backup-') || file.startsWith('backup_')) && (file.endsWith('.json') || file.endsWith('.zip')))
      .map(file => {
        const fp = path.join(BACKUPS_DIR, file);
        const stats = fs.statSync(fp);
        return {
          filename: file,
          filePath: fp,
          createdAt: stats.birthtime || stats.mtime
        };
      })
      .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());

    if (files.length > 50) {
      const filesToDelete = files.slice(50);
      for (const f of filesToDelete) {
        fs.unlinkSync(f.filePath);
        console.log(`🗑️ [Backup Scheduler] Deleted old backup (kept latest 50): ${f.filename}`);
      }
    }
  } catch (err: any) {
    console.error('❌ [Backup Scheduler] Error pruning old backups:', err.message);
  }

  return {
    filename,
    size,
    createdAt: backupData.timestamp
  };
}

export const normalizeRestoredValue = (value: any) => externalizeEmbeddedDataImages(value);

export function readLocalBackupFile(filePath: string, filename: string): any {
  return parseBackupBuffer(fs.readFileSync(filePath), filename);
}
