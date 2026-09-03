require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolvePrismaStartupMode } = require('./lib/prisma-startup-mode');

const rootDir = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(rootDir, 'prisma', 'migrations');

function spawnCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  const migrationsExists = fs.existsSync(migrationsDir);
  const migrationEntries = migrationsExists ? fs.readdirSync(migrationsDir) : [];
  const mode = resolvePrismaStartupMode({ migrationsExists, migrationEntries });

  console.log(`[startup] Prisma startup strategy: ${mode.strategy}`);
  console.log(`[startup] ${mode.reason}`);

  if (mode.shouldRunMigrateDeploy) {
    await spawnCommand('npx', ['prisma', 'migrate', 'deploy']);
  } else {
    console.log('[startup] Skipping Prisma schema sync to avoid P3005 on an already-populated production database.');
  }

  // Automatically check and clean invalid indexes before PM2 cluster workers start
  try {
    const cleanIndexesScript = path.join(rootDir, 'dist', 'scripts', 'clean-invalid-indexes.js');
    if (fs.existsSync(cleanIndexesScript)) {
      console.log('[startup] Running automatic index maintenance (clean invalid indexes & optimize)...');
      await spawnCommand('node', [cleanIndexesScript]);
    }
  } catch (idxError) {
    console.warn('[startup] Non-fatal index maintenance notice:', idxError.message || idxError);
  }

  await spawnCommand('pm2-runtime', ['start', 'dist/index.js', '-i', 'max', '--max-memory-restart', '1024M']);
}

main().catch((error) => {
  console.error('[startup] Failed to start production server.');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
