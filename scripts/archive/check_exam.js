const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.exam.findUnique({ where: { id: 'cbfb7468-8deb-4e15-91ef-84b7d09ee965' }, select: { id: true, schoolId: true, isCentral: true } }).then(x => console.log(x)).finally(() => prisma.$disconnect());
