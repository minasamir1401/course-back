const { resolvePrismaStartupMode } = require('../../../src/scripts/lib/prisma-startup-mode.js');

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
    expect(mode.reason).toMatch(/no migration files/i);
  });
});
