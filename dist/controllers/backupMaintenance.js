"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRestoredValue = void 0;
exports.parseBackupBuffer = parseBackupBuffer;
exports.generateFullSystemBackupData = generateFullSystemBackupData;
exports.performBackupAndPruning = performBackupAndPruning;
exports.readLocalBackupFile = readLocalBackupFile;
const backupSnapshot_1 = require("../lib/backupSnapshot");
const storage_1 = require("../lib/storage");
const db_backup_1 = require("../lib/db-backup");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const shared_1 = require("../shared");
const db_backup_2 = require("../lib/db-backup");
const runtimeSecurity_1 = require("../lib/runtimeSecurity");
function parseBackupBuffer(buffer, filename) {
    const lowerName = filename.toLowerCase();
    if (lowerName.endsWith('.zip')) {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(buffer);
        (0, runtimeSecurity_1.assertSafeArchiveEntries)(zip.getEntries());
        const entries = zip.getEntries()
            .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.json'))
            .sort((a, b) => b.header.size - a.header.size);
        if (entries.length === 0) {
            throw new Error('ZIP backup does not contain a JSON payload.');
        }
        return JSON.parse(entries[0].getData().toString('utf-8'));
    }
    return JSON.parse(buffer.toString('utf-8'));
}
function generateFullSystemBackupData() {
    return __awaiter(this, void 0, void 0, function* () {
        return (0, backupSnapshot_1.collectFullSnapshot)(prisma_1.default);
    });
}
function performBackupAndPruning() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, backupSnapshot_1.ensureBackupStorage)();
        const filename = 'backup-full-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + require('crypto').randomUUID() + '.json';
        const filePath = path_1.default.join(backupSnapshot_1.BACKUPS_DIR, filename);
        const saved = yield (0, backupSnapshot_1.writeFullSnapshot)(prisma_1.default, filePath);
        // Mirror to Cloud Backup DB (JSONB) if configured
        if (db_backup_1.CLOUD_BACKUP_ENABLED) {
            const payload = JSON.parse(yield fs_1.default.promises.readFile(filePath, 'utf8'));
            const cloud = yield (0, db_backup_2.saveToCloudBackup)(filename.slice(0, -5), 'FULL_SYSTEM', payload);
            if (!cloud)
                console.warn('[Backup] Local snapshot saved; cloud DB copy failed.');
        }
        // Mirror the raw JSON file to R2/S3 object storage if configured (non-fatal)
        if ((0, storage_1.isCloudStorageActive)()) {
            (0, storage_1.persistUpload)(filePath, filename, 'application/json').catch(err => console.warn('[Backup] R2 file mirror failed (local copy kept):', err.message));
        }
        yield (0, backupSnapshot_1.pruneFullSnapshots)();
        return { filename, size: saved.size, createdAt: saved.timestamp };
    });
}
const normalizeRestoredValue = (value) => (0, shared_1.externalizeEmbeddedDataImages)(value);
exports.normalizeRestoredValue = normalizeRestoredValue;
function readLocalBackupFile(filePath, filename) {
    return parseBackupBuffer(fs_1.default.readFileSync(filePath), filename);
}
