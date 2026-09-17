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

function resolveUntrackedDatabaseAction(input) {
  const hasBaselineMigration = Boolean(input?.hasBaselineMigration);
  const applicationTableCount = Number(input?.applicationTableCount || 0);
  const schemaMatches = input?.schemaMatches;

  if (hasBaselineMigration) {
    return {
      action: 'deploy',
      reason: 'The bundled baseline is already recorded in Prisma migration history.',
    };
  }

  if (applicationTableCount === 0) {
    return {
      action: 'deploy',
      reason: 'The database is empty; the baseline migration can create the schema.',
    };
  }

  if (schemaMatches === true) {
    return {
      action: 'resolve-baseline',
      reason: 'The existing unmanaged database matches the Prisma schema exactly.',
    };
  }

  return {
    action: 'abort',
    reason: 'The existing unmanaged database differs from the Prisma schema; refusing to mark the baseline as applied.',
  };
}

module.exports = {
  resolvePrismaStartupMode,
  resolveUntrackedDatabaseAction,
};
