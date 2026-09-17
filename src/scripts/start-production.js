require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const {
  resolvePrismaStartupMode,
  resolveUntrackedDatabaseAction,
} = require('./lib/prisma-startup-mode');

const rootDir = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(rootDir, 'prisma', 'migrations');
const baselineMigration = '20260917000000_baseline';

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      const acceptedExitCodes = options.acceptedExitCodes || [0];
      if (acceptedExitCodes.includes(code)) {
        resolve(code);
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function getPostgresConnection() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error('DATABASE_URL is required before Prisma migrations can run.');
  }

  const parsed = new URL(rawUrl);
  const schema = parsed.searchParams.get('schema') || 'public';

  // These parameters are understood by Prisma but not by node-postgres.
  ['connection_limit', 'pool_timeout', 'pgbouncer', 'statement_cache_size'].forEach((key) => {
    parsed.searchParams.delete(key);
  });

  return { connectionString: parsed.toString(), schema };
}

async function inspectDatabaseTables() {
  const { connectionString, schema } = getPostgresConnection();
  const client = new Client({ connectionString });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
      [schema]
    );
    const tableNames = new Set(result.rows.map((row) => row.table_name));
    const hasMigrationHistory = tableNames.has('_prisma_migrations');
    let hasBaselineMigration = false;
    if (hasMigrationHistory) {
      const escapedSchema = schema.replace(/"/g, '""');
      const baselineResult = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM "${escapedSchema}"."_prisma_migrations"
           WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
         ) AS applied`,
        [baselineMigration]
      );
      hasBaselineMigration = baselineResult.rows[0]?.applied === true;
    }

    return {
      hasMigrationHistory,
      hasBaselineMigration,
      applicationTableCount: [...tableNames].filter((name) => name !== '_prisma_migrations').length,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function prepareMigrationBaseline() {
  const databaseState = await inspectDatabaseTables();
  let action = resolveUntrackedDatabaseAction(databaseState);

  if (action.action === 'abort' && databaseState.applicationTableCount > 0) {
    console.log('[startup] Existing database has no record of this baseline; verifying its full schema.');
    const diffExitCode = await spawnCommand(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-schema-datasource',
        'prisma/schema.prisma',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { acceptedExitCodes: [0, 2] }
    );

    action = resolveUntrackedDatabaseAction({
      ...databaseState,
      schemaMatches: diffExitCode === 0,
    });
  }

  console.log(`[startup] Database baseline action: ${action.action}. ${action.reason}`);

  if (action.action === 'abort') {
    throw new Error(
      'Database schema drift detected before baseline adoption. Resolve the schema difference explicitly; startup made no schema changes.'
    );
  }

  if (action.action === 'resolve-baseline') {
    await spawnCommand('npx', ['prisma', 'migrate', 'resolve', '--applied', baselineMigration]);
  }
}

async function main() {
  const migrationsExists = fs.existsSync(migrationsDir);
  const migrationEntries = migrationsExists ? fs.readdirSync(migrationsDir) : [];
  const mode = resolvePrismaStartupMode({ migrationsExists, migrationEntries });

  console.log(`[startup] Prisma startup strategy: ${mode.strategy}`);
  console.log(`[startup] ${mode.reason}`);

  if (mode.shouldRunMigrateDeploy) {
    await prepareMigrationBaseline();
    await spawnCommand('npx', ['prisma', 'migrate', 'deploy']);
  }


  await spawnCommand('pm2-runtime', ['start', 'dist/index.js', '-i', 'max', '--max-memory-restart', '1024M']);
}

main().catch((error) => {
  console.error('[startup] Failed to start production server.');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
