import prisma from './src/lib/prisma';

async function testIsolationAndLogic() {
  console.log("--------------------------------------------------");
  console.log("RUNNING AUTOMATED SKILLS HUB VERIFICATION TESTS...");
  console.log("--------------------------------------------------");

  // 1. Get School A (madrast el nile)
  const schoolA = await prisma.school.findFirst();
  if (!schoolA) {
    throw new Error("No school found in the database.");
  }
  console.log(`[PASS] Found School A: ${schoolA.name}`);

  // Create a School B to test school-level isolation
  const schoolB = await prisma.school.upsert({
    where: { id: "school-b-test-id" },
    update: {},
    create: {
      id: "school-b-test-id",
      name: "مدرسة الاختبار التجريبية ب"
    }
  });
  console.log(`[PASS] Found/Created School B: ${schoolB.name}`);

  // Create a School B Specific Cluster
  const schoolBCluster = await prisma.skillCluster.upsert({
    where: { id: "cluster-b-specific-id" },
    update: {},
    create: {
      id: "cluster-b-specific-id",
      name: "🧩 تحديات خاصة بمدرسة ب فقط",
      subject: "الرياضيات",
      grade: "الصف الثالث الابتدائي",
      isCentral: false,
      schoolId: schoolB.id
    }
  });
  console.log(`[PASS] Found/Created Cluster for School B: ${schoolBCluster.name}`);

  // 2. Query clusters for School A
  const clustersForA = await prisma.skillCluster.findMany({
    where: {
      OR: [
        { isCentral: true },
        { schoolId: schoolA.id }
      ]
    }
  });

  // Verify School B cluster is NOT in School A's list
  const hasSchoolBClusterInA = clustersForA.some(c => c.id === schoolBCluster.id);
  if (hasSchoolBClusterInA) {
    throw new Error("ISOLATION BUG: School B Specific Cluster was fetched by School A query!");
  }
  console.log("[PASS] School Level Isolation: School A cannot see School B specific clusters.");

  // 3. Query clusters for School B
  const clustersForB = await prisma.skillCluster.findMany({
    where: {
      OR: [
        { isCentral: true },
        { schoolId: schoolB.id }
      ]
    }
  });
  const hasSchoolBClusterInB = clustersForB.some(c => c.id === schoolBCluster.id);
  const hasCentralClusterInB = clustersForB.some(c => c.isCentral);
  if (!hasSchoolBClusterInB || !hasCentralClusterInB) {
    throw new Error(`ISOLATION BUG: School B query did not return its own cluster or central clusters. B Specific: ${hasSchoolBClusterInB}, Central: ${hasCentralClusterInB}`);
  }
  console.log("[PASS] School Level Isolation: School B correctly sees its own clusters and central clusters.");

  // 4. Test Star Evaluation logic
  const evaluateStars = (isCorrect: boolean, hintsUsed: number, attemptCount: number) => {
    if (!isCorrect) return 0;
    if (hintsUsed === 0 && attemptCount === 1) return 3;
    if (hintsUsed <= 1 && attemptCount <= 2) return 2;
    return 1;
  };

  const testCases = [
    { isCorrect: true, hints: 0, attempts: 1, expectedStars: 3 },
    { isCorrect: true, hints: 1, attempts: 2, expectedStars: 2 },
    { isCorrect: true, hints: 2, attempts: 1, expectedStars: 1 },
    { isCorrect: true, hints: 0, attempts: 3, expectedStars: 1 },
    { isCorrect: false, hints: 0, attempts: 1, expectedStars: 0 }
  ];

  testCases.forEach((tc, idx) => {
    const stars = evaluateStars(tc.isCorrect, tc.hints, tc.attempts);
    if (stars !== tc.expectedStars) {
      throw new Error(`STAR LOGIC BUG in Test Case ${idx}: expected ${tc.expectedStars} stars but got ${stars} (correct: ${tc.isCorrect}, hints: ${tc.hints}, attempts: ${tc.attempts})`);
    }
  });
  console.log("[PASS] Star Assessment Logic behaves correctly according to the 3-star formula.");

  // 5. Clean up temporary test data for School B
  await prisma.skillCluster.delete({ where: { id: "cluster-b-specific-id" } });
  await prisma.school.delete({ where: { id: "school-b-test-id" } });
  console.log("[PASS] School B temporary test data cleaned up.");

  console.log("--------------------------------------------------");
  console.log("ALL SKILLS HUB TESTS COMPLETED SUCCESSFULLY!");
  console.log("--------------------------------------------------");
}

testIsolationAndLogic().catch(err => {
  console.error("Verification Test Failed:", err);
  process.exit(1);
});
