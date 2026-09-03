const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

prisma.course.findMany({ include: { lessons: true } })
  .then(c => fs.writeFileSync('courses_dump.json', JSON.stringify(c, null, 2)))
  .finally(() => prisma.$disconnect());
