function resolvePrismaStartupMode(input) {
  const migrationEntries = Array.isArray(input?.migrationEntries) ? input.migrationEntries : [];
  const migrationsExists = Boolean(input?.migrationsExists);
  const realMigrations = migrationEntries.filter((entry) => {
    const name = String(entry || '').trim();
    return name && !name.startsWith('.') && name !== 'migration_lock.toml';
  });

  if (migrationsExists && realMigrations.length > 0) {
    return {
      strategy: 'migrate-deploy',
      shouldRunMigrateDeploy: true,
      shouldRunDbPush: false,
      reason: 'Migration history exists in prisma/migrations.',
    };
  }

  return {
    strategy: 'skip-prisma-sync',
    shouldRunMigrateDeploy: false,
    shouldRunDbPush: false,
    reason: 'No bundled Prisma migrations; automatic schema migration is disabled. Continuing startup without running Prisma schema changes.',
  };
}

module.exports = {
  resolvePrismaStartupMode,
};
