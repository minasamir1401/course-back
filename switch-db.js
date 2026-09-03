const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'prisma', 'schema.prisma');
const envPath = path.join(__dirname, '.env');

let schema = fs.readFileSync(schemaPath, 'utf8');
let env = fs.readFileSync(envPath, 'utf8');

const target = process.argv[2]; // 'local' or 'prod'

if (target === 'local') {
  // Keep local development on PostgreSQL to match production behavior.
  schema = schema.replace(/provider = "sqlite"/, 'provider = "postgresql"');
  schema = schema.replace(/url\s*=\s*"file:\.\/dev\.db"/, 'url = env("DATABASE_URL")');

  const localUrl = process.env.DATABASE_URL || 'postgresql://USER:PASSWORD@localhost:5432/DB_NAME?schema=public';
  env = env.replace(/DATABASE_URL=.*/, `DATABASE_URL="${localUrl}"`);
  env = env.replace(/NODE_ENV=.*/, 'NODE_ENV="development"');
  env = env.replace(/BACKEND_ORIGIN=.*/, 'BACKEND_ORIGIN="http://localhost:5000"');
  env = env.replace(/ALLOWED_ORIGINS=.*/, 'ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001,http://localhost:5000"');
  
  console.log('✅ Switched to Local (PostgreSQL)');
} else if (target === 'prod') {
  // Switch to PostgreSQL
  schema = schema.replace(/provider = "sqlite"/, 'provider = "postgresql"');
  schema = schema.replace(/url\s*=\s*"file:\.\/dev\.db"/, 'url = env("DATABASE_URL")');
  
  const prodUrl = process.env.DATABASE_URL || 'postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public';
  env = env.replace(/DATABASE_URL=.*/, `DATABASE_URL="${prodUrl}"`);
  env = env.replace(/NODE_ENV=.*/, 'NODE_ENV="production"');
  env = env.replace(/BACKEND_ORIGIN=.*/, 'BACKEND_ORIGIN="https://api.klevro.tech"');
  env = env.replace(/ALLOWED_ORIGINS=.*/, 'ALLOWED_ORIGINS="https://klevro.tech,https://www.klevro.tech"');
  
  console.log('🚀 Switched to Production (PostgreSQL)');
} else {
  console.log('Usage: node switch-db.js [local|prod]');
  process.exit(1);
}

fs.writeFileSync(schemaPath, schema);
fs.writeFileSync(envPath, env);
console.log('⚠️ Remember to run: npx prisma generate');
