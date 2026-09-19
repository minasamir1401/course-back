const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Applying Question.hint and Question.hintEn migration...');
  await prisma.$executeRawUnsafe('ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "hint" TEXT;');
  await prisma.$executeRawUnsafe('ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "hintEn" TEXT;');
  console.log('Columns added successfully.');

  const cols = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Question' AND column_name IN ('hint', 'hintEn');"
  );
  console.log('Verified columns in Question table:', cols);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
