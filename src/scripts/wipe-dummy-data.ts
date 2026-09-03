import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

async function requireConfirmation(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      '\n⚠️  WARNING: This will PERMANENTLY DELETE all dummy school data\n' +
      '   (schools: alrowad, nile, almanara — and all their users, courses, classrooms).\n' +
      '   Type exactly "WIPE_DUMMY" to proceed, or anything else to cancel:\n> ',
      (answer) => {
        rl.close();
        if (answer.trim() !== 'WIPE_DUMMY') {
          console.log('❌ Cancelled. No data was deleted.');
          process.exit(0);
        }
        resolve();
      }
    );
  });
}

async function wipeDummyData() {
  console.log("Starting wipe of all dummy data...");

  const DUMMY_DOMAINS = ['alrowad', 'nile', 'almanara'];

  try {
    const dummySchools = await prisma.school.findMany({
      where: {
        subdomain: { in: DUMMY_DOMAINS }
      }
    });

    if (dummySchools.length === 0) {
      console.log("No dummy schools found. Database is clean.");
      return;
    }

    const schoolIds = dummySchools.map(s => s.id);
    console.log(`Found dummy schools:`, dummySchools.map(s => s.name).join(", "));

    const deletedUsers = await prisma.user.deleteMany({
      where: { schoolId: { in: schoolIds } }
    });
    console.log(`Deleted users: ` + deletedUsers.count);

    await prisma.lesson.deleteMany({
      where: { course: { schoolId: { in: schoolIds } } }
    });
    
    const deletedCourses = await prisma.course.deleteMany({
      where: { schoolId: { in: schoolIds } }
    });
    console.log(`Deleted courses: ` + deletedCourses.count);

    const deletedClassrooms = await prisma.classroom.deleteMany({
      where: { schoolId: { in: schoolIds } }
    });
    console.log(`Deleted classrooms: ` + deletedClassrooms.count);

    const deletedSchools = await prisma.school.deleteMany({
      where: { id: { in: schoolIds } }
    });
    console.log(`Deleted schools: ` + deletedSchools.count);

    console.log("All dummy data wiped successfully!");

  } catch (error) {
    console.error("Error wiping dummy data:", error);
  } finally {
    await prisma.$disconnect();
  }
}

requireConfirmation().then(() => wipeDummyData());
