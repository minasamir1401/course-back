require('ts-node/register/transpile-only');

const {
  assertSafeArchiveEntries,
  requireInitialAdminPassword,
} = require('../../../src/lib/runtimeSecurity');

describe('runtime security policy', () => {
  test('requires an explicit initial super-admin password outside development', () => {
    expect(() => requireInitialAdminPassword(undefined, 'production')).toThrow(
      'SUPER_ADMIN_INITIAL_PASSWORD must be set before creating the first super-admin account',
    );
  });

  test('rejects backup archives containing unsafe or oversized entries', () => {
    expect(() => assertSafeArchiveEntries([
      { entryName: '../outside.json', header: { size: 32 } },
    ])).toThrow('unsafe path');

    expect(() => assertSafeArchiveEntries([
      { entryName: 'backup.json', header: { size: 51 * 1024 * 1024 } },
    ])).toThrow('maximum uncompressed size');
  });
});
