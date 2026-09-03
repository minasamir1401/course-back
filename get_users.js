const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      role: {
        in: ['SCHOOL_ADMIN', 'SUPER_ADMIN']
      }
    }
  });
  console.log('Users found:');
  users.forEach(u => console.log(`Username: ${u.username} | Role: ${u.role} | Name: ${u.name}`));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
