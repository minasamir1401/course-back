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
  return collectFullSnapshot(prisma);
}

export async function performBackupAndPruning(): Promise<{ filename: string; size: number; createdAt: string }> {
  await ensureBackupStorage();
  const filename = 'backup-full-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + require('crypto').randomUUID() + '.json';
  const filePath = path.join(BACKUPS_DIR, filename);
  const saved = await writeFullSnapshot(prisma, filePath);
  // Mirror to Cloud Backup DB (JSONB) if configured
  if (CLOUD_BACKUP_ENABLED) {
    const payload = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    const cloud = await saveToCloudBackup(filename.slice(0, -5), 'FULL_SYSTEM', payload);
    if (!cloud) console.warn('[Backup] Local snapshot saved; cloud DB copy failed.');
  }
  // Mirror the raw JSON file to R2/S3 object storage if configured (non-fatal)
  if (isCloudStorageActive()) {
    persistUpload(filePath, filename, 'application/json').catch(err =>
      console.warn('[Backup] R2 file mirror failed (local copy kept):', err.message)
    );
  }
  await pruneFullSnapshots();
  return { filename, size: saved.size, createdAt: saved.timestamp };
}

export const normalizeRestoredValue = (value: any) => externalizeEmbeddedDataImages(value);

export function readLocalBackupFile(filePath: string, filename: string): any {
  return parseBackupBuffer(fs.readFileSync(filePath), filename);
}

