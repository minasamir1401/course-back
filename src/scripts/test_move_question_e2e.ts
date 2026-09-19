import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../shared";

const prisma = new PrismaClient();
const BACKEND_URL = "http://localhost:5000/api";
const FRONTEND_PROXY_URL = "http://localhost:3000/api";

async function main() {
  console.log("=== STARTING FULL END-TO-END QUESTION MOVE VERIFICATION ===");

  // 1. Fetch super admin or any admin
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, schoolId: true }
  });

  const adminUser = users.find(u => u.role === "SUPER_ADMIN") || users.find(u => u.role === "SCHOOL_ADMIN") || users[0];
  if (!adminUser) {
    throw new Error("No user found in database");
  }
  console.log("Using Admin User:", adminUser.email, "Role:", adminUser.role);

  // 2. Fetch or pick two distinct exams
  const exams = await prisma.exam.findMany({
    take: 2,
    orderBy: { createdAt: "desc" },
    include: {
      questions: { take: 1, orderBy: { order: "asc" } },
      modules: { take: 1 }
    }
  });

  if (exams.length < 2) {
    throw new Error("Need at least 2 exams to test moving questions");
  }

  const sourceExam = exams[0];
  const targetExam = exams[1];
  console.log(`Source Exam: [${sourceExam.id}] "${sourceExam.title}"`);
  console.log(`Target Exam: [${targetExam.id}] "${targetExam.title}"`);

  // Ensure source exam has at least one question
  let questionToMove = sourceExam.questions[0];
  if (!questionToMove) {
    console.log("Creating temporary test question in Source Exam...");
    questionToMove = await prisma.question.create({
      data: {
        examId: sourceExam.id,
        type: "MULTIPLE_CHOICE",
        text: "E2E Automated Test Question for Moving",
        order: 0,
        options: JSON.stringify(["Option A", "Option B"]),
        correctAnswer: "Option A",
        hint: "Test solving hint"
      }
    });
  }

  console.log(`Question to Move: [${questionToMove.id}] "${questionToMove.text.substring(0, 40)}"`);

  // 3. Create Valid Auth Session via Token and Cookie
  console.log("\n--- Setting up Authentication ---");
  const token = jwt.sign(
    {
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      schoolId: adminUser.schoolId
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const authHeaders = {
    "Content-Type": "application/json",
    Cookie: `auth_token=${token}`,
    Authorization: `Bearer ${token}`
  };

  // 4. Test 401 Unauthorized (request without credentials)
  console.log("\n--- Testing 401 Unauthorized Guard ---");
  const unauthRes = await fetch(
    `${BACKEND_URL}/exams/${sourceExam.id}/questions/${questionToMove.id}/move`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetExamId: targetExam.id })
    }
  );
  console.log(`Unauthenticated move returned HTTP ${unauthRes.status} (Expected: 401)`);
  if (unauthRes.status !== 401) {
    throw new Error(`Expected 401 but got ${unauthRes.status}`);
  }

  // 5. Test 404 Question Not Found
  console.log("\n--- Testing 404 Question Not Found ---");
  const fakeQuestionId = "00000000-0000-0000-0000-000000000000";
  const notFoundQuestionRes = await fetch(
    `${BACKEND_URL}/exams/${sourceExam.id}/questions/${fakeQuestionId}/move`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ targetExamId: targetExam.id })
    }
  );
  console.log(`Fake question move returned HTTP ${notFoundQuestionRes.status} (Expected: 404)`);
  if (notFoundQuestionRes.status !== 404) {
    throw new Error(`Expected 404 but got ${notFoundQuestionRes.status}`);
  }

  // 6. Test 404 Target Exam Not Found
  console.log("\n--- Testing 404 Target Exam Not Found ---");
  const fakeExamId = "00000000-0000-0000-0000-000000000000";
  const notFoundExamRes = await fetch(
    `${BACKEND_URL}/exams/${sourceExam.id}/questions/${questionToMove.id}/move`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ targetExamId: fakeExamId })
    }
  );
  console.log(`Fake target exam move returned HTTP ${notFoundExamRes.status} (Expected: 404)`);
  if (notFoundExamRes.status !== 404) {
    throw new Error(`Expected 404 but got ${notFoundExamRes.status}`);
  }

  // 7. Perform Successful Question Move (Direct to Backend)
  console.log("\n--- Performing Question Move: Source Exam -> Target Exam (Backend:5000) ---");
  const moveRes1 = await fetch(
    `${BACKEND_URL}/exams/${sourceExam.id}/questions/${questionToMove.id}/move`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        targetExamId: targetExam.id,
        targetModuleId: targetExam.modules[0]?.id || null,
        targetSubExamId: null
      })
    }
  );
  const moveData1 = await moveRes1.json();
  console.log(`Move Response Status: ${moveRes1.status}`, moveData1);
  if (!moveRes1.ok || !moveData1.success) {
    throw new Error(`Failed to move question to target: ${JSON.stringify(moveData1)}`);
  }

  // Verify in Database
  const dbCheck1 = await prisma.question.findUnique({
    where: { id: questionToMove.id }
  });
  if (dbCheck1?.examId !== targetExam.id) {
    throw new Error(`Database check failed: Question examId is ${dbCheck1?.examId}, expected ${targetExam.id}`);
  }
  console.log(`Database Verified: Question now belongs to Target Exam [${dbCheck1.examId}] with order ${dbCheck1.order}`);

  // 8. Perform Successful Question Move via Frontend Proxy (Next.js :3000)
  console.log("\n--- Performing Question Move Back: Target Exam -> Source Exam (Frontend Proxy:3000) ---");
  const moveRes2 = await fetch(
    `${FRONTEND_PROXY_URL}/exams/${targetExam.id}/questions/${questionToMove.id}/move`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        targetExamId: sourceExam.id,
        targetModuleId: null,
        targetSubExamId: null
      })
    }
  );
  const moveData2 = await moveRes2.json();
  console.log(`Reverse Move Response Status: ${moveRes2.status}`, moveData2);
  if (!moveRes2.ok || !moveData2.success) {
    throw new Error(`Failed to move question back via proxy: ${JSON.stringify(moveData2)}`);
  }

  // Verify in Database
  const dbCheck2 = await prisma.question.findUnique({
    where: { id: questionToMove.id }
  });
  if (dbCheck2?.examId !== sourceExam.id) {
    throw new Error(`Database check failed: Question examId is ${dbCheck2?.examId}, expected ${sourceExam.id}`);
  }
  console.log(`Database Verified: Question restored to Source Exam [${dbCheck2.examId}] with order ${dbCheck2.order}`);

  console.log("\n=== ALL E2E QUESTION MOVE TESTS PASSED SUCCESSFULLY! ===");
}

main()
  .catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
