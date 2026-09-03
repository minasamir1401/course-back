const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      role: {
        in: ['SCHOOL_ADMIN', 'SUPER_ADMIN']
      }
    }
  });
  
  console.log('Testing passwords against "superadmin123" and "123456"...');
  for (const u of users) {
    const isSuperAdmin123 = await bcrypt.compare('superadmin123', u.password);
    const is123456 = await bcrypt.compare('123456', u.password);
    const isPassword = await bcrypt.compare('password', u.password);
    
    let pw = 'UNKNOWN';
    if (isSuperAdmin123) pw = 'superadmin123';
    else if (is123456) pw = '123456';
    else if (isPassword) pw = 'password';
    
    console.log(`Username: ${u.username} | Role: ${u.role} | Password: ${pw}`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
