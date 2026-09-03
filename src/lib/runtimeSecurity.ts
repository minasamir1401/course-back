const MAX_ARCHIVE_ENTRIES = 1_000;
const MAX_ARCHIVE_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 250 * 1024 * 1024;

type ArchiveEntry = {
  entryName?: string;
  isDirectory?: boolean;
  header?: { size?: number };
};

export const requireInitialAdminPassword = (password: string | undefined, environment: string | undefined): string => {
  const normalized = password?.trim();
  if (!normalized || normalized.length < 16) {
    throw new Error(
      'SUPER_ADMIN_INITIAL_PASSWORD must be set before creating the first super-admin account and be at least 16 characters long',
    );
  }

  // The environment argument is intentionally retained for an explicit, testable policy boundary.
  void environment;
  return normalized;
};

const hasUnsafeArchivePath = (entryName: string): boolean => {
  const normalized = entryName.replace(/\\/g, '/');
  return !normalized
    || normalized.includes('\0')
    || normalized.startsWith('/')
    || /^[a-zA-Z]:\//.test(normalized)
    || normalized.split('/').some((part) => part === '.' || part === '..');
};

export const assertSafeArchiveEntries = (entries: ArchiveEntry[]): void => {
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('ZIP archive exceeds the maximum entry count');
  }

  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const entryName = String(entry.entryName || '');
    if (hasUnsafeArchivePath(entryName)) {
      throw new Error('ZIP archive contains an unsafe path');
    }

    const size = Number(entry.header?.size || 0);
    if (!Number.isFinite(size) || size < 0 || size > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error('ZIP archive entry exceeds the maximum uncompressed size');
    }

    totalUncompressedBytes += size;
    if (totalUncompressedBytes > MAX_ARCHIVE_TOTAL_BYTES) {
      throw new Error('ZIP archive exceeds the maximum total uncompressed size');
    }
  }
};
