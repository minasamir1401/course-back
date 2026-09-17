const {
  resolvePrismaStartupMode,
  resolveUntrackedDatabaseAction,
} = require('../../../src/scripts/lib/prisma-startup-mode.js');

describe('prisma startup mode', () => {
  test('uses migrate deploy when migrations exist', () => {
    const mode = resolvePrismaStartupMode({
      migrationsExists: true,
      migrationEntries: ['20260825010101_init'],
    });

    expect(mode.strategy).toBe('migrate-deploy');
    expect(mode.shouldRunMigrateDeploy).toBe(true);
    expect(mode.shouldRunDbPush).toBe(false);
  });

  test('skips migrate deploy when migrations folder is missing', () => {
    const mode = resolvePrismaStartupMode({
      migrationsExists: false,
      migrationEntries: [],
    });

    expect(mode.strategy).toBe('skip-prisma-sync');
    expect(mode.shouldRunMigrateDeploy).toBe(false);
    expect(mode.shouldRunDbPush).toBe(false);
  });

  test('skips migrate deploy when schema exists but migration history is empty', () => {
    const mode = resolvePrismaStartupMode({
      migrationsExists: true,
      migrationEntries: [],
    });

    expect(mode.strategy).toBe('skip-prisma-sync');
    expect(mode.shouldRunMigrateDeploy).toBe(false);
    expect(mode.reason).toMatch(/no bundled Prisma migrations/i);
  });
});

describe('untracked database baseline safety', () => {
  test('deploys normally when this baseline exists in Prisma migration history', () => {
    expect(resolveUntrackedDatabaseAction({
      hasMigrationHistory: true,
      hasBaselineMigration: true,
      applicationTableCount: 20,
    }).action).toBe('deploy');
  });

  test('deploys the baseline into an empty database', () => {
    expect(resolveUntrackedDatabaseAction({
      hasMigrationHistory: false,
      hasBaselineMigration: false,
      applicationTableCount: 0,
    }).action).toBe('deploy');
  });

  test('adopts an existing database only after an exact schema match', () => {
    expect(resolveUntrackedDatabaseAction({
      hasMigrationHistory: false,
      hasBaselineMigration: false,
      applicationTableCount: 20,
      schemaMatches: true,
    }).action).toBe('resolve-baseline');
  });

  test('aborts when an unmanaged existing database has schema drift', () => {
    const result = resolveUntrackedDatabaseAction({
      hasMigrationHistory: false,
      hasBaselineMigration: false,
      applicationTableCount: 20,
      schemaMatches: false,
    });

    expect(result.action).toBe('abort');
    expect(result.reason).toMatch(/refusing/i);
  });

  test('verifies an existing database even when it has unrelated migration history', () => {
    expect(resolveUntrackedDatabaseAction({
      hasMigrationHistory: true,
      hasBaselineMigration: false,
      applicationTableCount: 20,
    }).action).toBe('abort');
  });
});
