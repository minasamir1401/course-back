import prisma from './src/lib/prisma';

// Helper to determine if answer is correct (simplified for testing)
const isAnswerCorrect = (question: any, selectedAnswer: any) => {
  if (!selectedAnswer && selectedAnswer !== 0) return false;
  const cleanStr = (s: any) => String(s ?? '').trim().toLowerCase().replace(/"/g, '');
  return cleanStr(selectedAnswer) === cleanStr(question.correctAnswer);
};

async function testXPSystem() {
  console.log("--------------------------------------------------");
  console.log("RUNNING AUTOMATED XP & GAMIFICATION TESTS...");
  console.log("--------------------------------------------------");

  // 1. Create a temporary test student
  const testStudentId = "test-student-xp-id";
  const student = await prisma.user.upsert({
    where: { id: testStudentId },
    update: { xp: 0 },
    create: {
      id: testStudentId,
      name: "طالب تجريبي للاختبار",
      username: "xp_test_student",
      password: "hashedpassword123",
      role: "STUDENT",
      xp: 0
    }
  });
  console.log(`[PASS] Created test student. Initial XP: ${student.xp}`);

  // Clean up any old test history
  await prisma.xPHistory.deleteMany({
    where: { userId: testStudentId }
  });

  const testLessonId = "test-lesson-xp-id";
  const blockType = "questions";
  const sourceType = "LESSON_QUIZ";

  // Create 12 mock question blocks (to test streaks of 5 and 10)
  const mockQuestions = Array.from({ length: 12 }, (_, i) => ({
    id: `q-${i}`,
    text: `Question ${i}`,
    type: "MCQ",
    correctAnswer: "A",
    xpPoints: 10
  }));

  // Helper function simulating submit-answer logic
  const simulateSubmitAnswer = async (questionId: string, answer: string) => {
    const block = mockQuestions.find(q => q.id === questionId);
    if (!block) throw new Error("Mock question not found");

    const isCorrect = isAnswerCorrect(block, answer);

    // Track attempt number
    const attemptsCount = await prisma.xPHistory.count({
      where: {
        userId: testStudentId,
        sourceId: testLessonId,
        questionId,
        isBonus: false
      }
    });
    const attemptNum = attemptsCount + 1;
    const isFirstAttempt = attemptNum === 1;

    const earnedXP = (isFirstAttempt && isCorrect) ? (block.xpPoints || 10) : 0;

    // Log attempt in XPHistory
    await prisma.xPHistory.create({
      data: {
        userId: testStudentId,
        xp: earnedXP,
        sourceType,
        sourceId: testLessonId,
        questionId,
        isCorrect,
        attemptNum
      }
    });

    // Compute streak of correct first attempts inside this blockType
    const firstAttempts = await prisma.xPHistory.findMany({
      where: {
        userId: testStudentId,
        sourceId: testLessonId,
        sourceType,
        attemptNum: 1,
        isBonus: false
      }
    });
    const attemptsMap = new Map(firstAttempts.map(a => [a.questionId, a]));

    let currentStreak = 0;
    for (let i = 0; i < mockQuestions.length; i++) {
      const b = mockQuestions[i];
      const qId = b.id;
      const attempt = attemptsMap.get(qId);
      if (!attempt) break;
      if (attempt.isCorrect) {
        currentStreak++;
      } else {
        currentStreak = 0;
      }
    }

    // Award streak bonus
    let bonusXP = 0;
    if (isFirstAttempt && isCorrect && (currentStreak === 5 || currentStreak === 10)) {
      const bonusType = `streak_${currentStreak}`;
      const alreadyHasBonus = await prisma.xPHistory.count({
        where: {
          userId: testStudentId,
          sourceId: testLessonId,
          sourceType,
          questionId: bonusType,
          isBonus: true
        }
      }) > 0;

      if (!alreadyHasBonus) {
        bonusXP = currentStreak === 5 ? 10 : 30;
        await prisma.xPHistory.create({
          data: {
            userId: testStudentId,
            xp: bonusXP,
            sourceType,
            sourceId: testLessonId,
            questionId: bonusType,
            isCorrect: true,
            attemptNum: 1,
            isBonus: true
          }
        });
      }
    }

    const totalXPToAward = earnedXP + bonusXP;
    if (totalXPToAward > 0) {
      await prisma.user.update({
        where: { id: testStudentId },
        data: { xp: { increment: totalXPToAward } }
      });
    }

    return { isCorrect, earnedXP, bonusXP, currentStreak };
  };

  // Test Case 1: Answer first question correctly
  console.log("\n--- TEST CASE 1: Correct First Attempt ---");
  const res1 = await simulateSubmitAnswer("q-0", "A");
  console.log(`Result: correct=${res1.isCorrect}, earnedXP=${res1.earnedXP}, streak=${res1.currentStreak}`);
  if (!res1.isCorrect || res1.earnedXP !== 10 || res1.currentStreak !== 1) {
    throw new Error("TEST CASE 1 FAILED");
  }
  console.log("[PASS] Correct first attempt earned 10 XP.");

  // Test Case 2: Answer first question again (second attempt)
  console.log("\n--- TEST CASE 2: Correct Second Attempt ---");
  const res2 = await simulateSubmitAnswer("q-0", "A");
  console.log(`Result: correct=${res2.isCorrect}, earnedXP=${res2.earnedXP}, streak=${res2.currentStreak}`);
  if (res2.earnedXP !== 0) {
    throw new Error("TEST CASE 2 FAILED: Second attempt awarded XP!");
  }
  console.log("[PASS] Second attempt correctly locked out from earning XP.");

  // Test Case 3: Build streak up to 5 correct first attempts
  console.log("\n--- TEST CASE 3: Building 5-Streak ---");
  await simulateSubmitAnswer("q-1", "A"); // streak = 2
  await simulateSubmitAnswer("q-2", "A"); // streak = 3
  await simulateSubmitAnswer("q-3", "A"); // streak = 4
  const res5 = await simulateSubmitAnswer("q-4", "A"); // streak = 5, should award 10 XP bonus
  console.log(`Result: correct=${res5.isCorrect}, earnedXP=${res5.earnedXP}, bonusXP=${res5.bonusXP}, streak=${res5.currentStreak}`);
  if (res5.currentStreak !== 5 || res5.bonusXP !== 10) {
    throw new Error(`TEST CASE 3 FAILED: expected 5-streak with 10 bonus XP. Got streak=${res5.currentStreak}, bonus=${res5.bonusXP}`);
  }
  console.log("[PASS] 5-streak milestone successfully awarded 10 XP bonus.");

  // Test Case 4: Build streak up to 10 correct first attempts
  console.log("\n--- TEST CASE 4: Building 10-Streak ---");
  await simulateSubmitAnswer("q-5", "A"); // streak = 6
  await simulateSubmitAnswer("q-6", "A"); // streak = 7
  await simulateSubmitAnswer("q-7", "A"); // streak = 8
  await simulateSubmitAnswer("q-8", "A"); // streak = 9
  const res10 = await simulateSubmitAnswer("q-9", "A"); // streak = 10, should award 30 XP bonus
  console.log(`Result: correct=${res10.isCorrect}, earnedXP=${res10.earnedXP}, bonusXP=${res10.bonusXP}, streak=${res10.currentStreak}`);
  if (res10.currentStreak !== 10 || res10.bonusXP !== 30) {
    throw new Error(`TEST CASE 4 FAILED: expected 10-streak with 30 bonus XP. Got streak=${res10.currentStreak}, bonus=${res10.bonusXP}`);
  }
  console.log("[PASS] 10-streak milestone successfully awarded 30 XP bonus.");

  // Test Case 5: Verify user's final total XP in Database
  console.log("\n--- TEST CASE 5: Total XP Verification ---");
  const finalUser = await prisma.user.findUnique({
    where: { id: testStudentId }
  });
  // Total earned from correct questions: q-0, q-1, q-2, q-3, q-4, q-5, q-6, q-7, q-8, q-9 = 10 * 10 XP = 100 XP
  // Total bonuses: 5-streak (10 XP) + 10-streak (30 XP) = 40 XP
  // Grand total expected: 140 XP
  console.log(`User Total XP in database: ${finalUser?.xp}`);
  if (finalUser?.xp !== 140) {
    throw new Error(`TEST CASE 5 FAILED: expected 140 XP in database but got ${finalUser?.xp}`);
  }
  console.log("[PASS] Grand total of 140 XP matches expectations perfectly.");

  // 6. Clean up test user and history
  await prisma.xPHistory.deleteMany({
    where: { userId: testStudentId }
  });
  await prisma.user.delete({
    where: { id: testStudentId }
  });
  console.log("\n[PASS] Cleaned up test data successfully.");

  console.log("--------------------------------------------------");
  console.log("ALL XP AND GAMIFICATION TESTS PASSED SUCCESSFULLY!");
  console.log("--------------------------------------------------");
}

testXPSystem().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
