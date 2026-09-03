"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSafeArchiveEntries = exports.requireInitialAdminPassword = void 0;
const MAX_ARCHIVE_ENTRIES = 1000;
const MAX_ARCHIVE_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 250 * 1024 * 1024;
const requireInitialAdminPassword = (password, environment) => {
    const normalized = password === null || password === void 0 ? void 0 : password.trim();
    if (!normalized || normalized.length < 16) {
        throw new Error('SUPER_ADMIN_INITIAL_PASSWORD must be set before creating the first super-admin account and be at least 16 characters long');
    }
    // The environment argument is intentionally retained for an explicit, testable policy boundary.
    void environment;
    return normalized;
};
exports.requireInitialAdminPassword = requireInitialAdminPassword;
const hasUnsafeArchivePath = (entryName) => {
    const normalized = entryName.replace(/\\/g, '/');
    return !normalized
        || normalized.includes('\0')
        || normalized.startsWith('/')
        || /^[a-zA-Z]:\//.test(normalized)
        || normalized.split('/').some((part) => part === '.' || part === '..');
};
const assertSafeArchiveEntries = (entries) => {
    var _a;
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
        throw new Error('ZIP archive exceeds the maximum entry count');
    }
    let totalUncompressedBytes = 0;
    for (const entry of entries) {
        const entryName = String(entry.entryName || '');
        if (hasUnsafeArchivePath(entryName)) {
            throw new Error('ZIP archive contains an unsafe path');
        }
        const size = Number(((_a = entry.header) === null || _a === void 0 ? void 0 : _a.size) || 0);
        if (!Number.isFinite(size) || size < 0 || size > MAX_ARCHIVE_ENTRY_BYTES) {
            throw new Error('ZIP archive entry exceeds the maximum uncompressed size');
        }
        totalUncompressedBytes += size;
        if (totalUncompressedBytes > MAX_ARCHIVE_TOTAL_BYTES) {
            throw new Error('ZIP archive exceeds the maximum total uncompressed size');
        }
    }
};
exports.assertSafeArchiveEntries = assertSafeArchiveEntries;
