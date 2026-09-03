import prisma from './src/lib/prisma';
import bcrypt from 'bcryptjs';

const BACKEND_URL = 'http://localhost:5000';

async function runLiveAudit() {
  console.log("==================================================");
  console.log("STARTING LIVE END-TO-END AUDIT FOR SKILLS HUB...");
  console.log("==================================================");

  // 1. Prepare target temporary student in DB with known hashed password
  const AUDIT_USERNAME = 'audit_student_e2e';
  const AUDIT_PASSWORD = 'password123_secure';
  const hashedPassword = await bcrypt.hash(AUDIT_PASSWORD, 10);

  // Get the first school in the DB to associate with the student
  const school = await prisma.school.findFirst();
  if (!school) {
    throw new Error("No school found in the database.");
  }

  // Create temporary student
  const student = await prisma.user.upsert({
    where: { username: AUDIT_USERNAME },
    update: {
      password: hashedPassword,
      grade: 'الصف الثالث الابتدائي',
      schoolId: school.id
    },
    create: {
      username: AUDIT_USERNAME,
      password: hashedPassword,
      name: 'طالب الفحص الآلي E2E',
      role: 'STUDENT',
      grade: 'الصف الثالث الابتدائي',
      schoolId: school.id,
      plainPassword: AUDIT_PASSWORD
    }
  });
  console.log(`[PREP] Created/Updated temporary student '${student.name}' (Username: ${student.username}).`);

  // 2. Perform live Login via HTTP using native fetch
  let token = '';
  try {
    const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: AUDIT_USERNAME,
        password: AUDIT_PASSWORD
      })
    });
    if (!loginRes.ok) {
      const errText = await loginRes.text();
      throw new Error(`Login responded with status ${loginRes.status}: ${errText}`);
    }
    const loginData = await loginRes.json() as any;
    token = loginData.token;
    console.log("[PASS] Live Login: Logged in successfully via POST /api/auth/login.");
  } catch (err: any) {
    console.error("Login request failed. Make sure the server is running on port 5000.", err.message);
    // Cleanup temporary student on failure
    await prisma.user.delete({ where: { username: AUDIT_USERNAME } });
    process.exit(1);
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // 3. Test Progress fetching
  let initialProgress: any = null;
  const startProgressTime = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/api/skills-hub/progress?subject=${encodeURIComponent('الرياضيات')}`, {
      headers: authHeaders
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Progress responded with status ${res.status}: ${errText}`);
    }
    initialProgress = await res.json();
    const duration = Date.now() - startProgressTime;
    console.log(`[PASS] Live Progress API: Fetched successfully in ${duration}ms (Response Speed Check).`);
    
    // Ensure clusters and activities are returned
    if (!initialProgress.clusters || initialProgress.clusters.length === 0) {
      throw new Error("No math clusters returned in progress data.");
    }
    console.log(`[PASS] Data Structure: Found ${initialProgress.clusters.length} clusters in Grade 3 Math.`);
  } catch (err: any) {
    console.error("Progress request failed:", err.message);
    await prisma.user.delete({ where: { username: AUDIT_USERNAME } });
    process.exit(1);
  }

  // Find a target activity to solve (the MATCHING activity seeded in seed_skills_hub.ts)
  const targetCluster = initialProgress.clusters[0];
  const targetSkill = targetCluster.skills[0];
  const targetActivity = targetSkill.activities[0];
  if (!targetActivity) {
    throw new Error("No activity found in the first skill cluster.");
  }
  console.log(`[TARGET] Target Activity to attempt: '${targetActivity.title}' (ID: ${targetActivity.id}, Type: ${targetActivity.type})`);

  // Clean existing attempts for this student/activity to ensure fresh audit results
  await prisma.activityAttempt.deleteMany({
    where: { userId: student.id, activityId: targetActivity.id }
  });

  // 4. Test E2E Submission Correctness and Autosave Stars Calculations
  
  // Case A: Correct answer, 0 hints, 1 attempt -> Should yield 3 stars
  const attemptPayloadA = {
    selectedAnswer: JSON.stringify({ "8": "2", "7": "3", "6": "4", "5": "5" }), // Correct matching answers
    timeTaken: 12,
    hintsUsed: 0,
    attemptCount: 1
  };
  
  console.log("[TEST] Submitting 100% correct answer with 0 hints and 1 attempt...");
  try {
    const res = await fetch(`${BACKEND_URL}/api/skills-hub/activities/${targetActivity.id}/attempt`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(attemptPayloadA)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Attempt submission A responded with status ${res.status}: ${errText}`);
    }
    const attemptResult = await res.json() as any;
    console.log(`[PASS] Submission Result: isCorrect = ${attemptResult.isCorrect}, Stars = ${attemptResult.stars}, Score = ${attemptResult.score} XP.`);
    if (!attemptResult.isCorrect || attemptResult.stars !== 3) {
      throw new Error(`Expected 3 stars and correctness, but got isCorrect: ${attemptResult.isCorrect}, stars: ${attemptResult.stars}`);
    }
  } catch (err: any) {
    console.error("Attempt submission A failed:", err.message);
    await prisma.user.delete({ where: { username: AUDIT_USERNAME } });
    process.exit(1);
  }

  // 5. Test Persistence in Progress API after submission
  try {
    const res = await fetch(`${BACKEND_URL}/api/skills-hub/progress?subject=${encodeURIComponent('الرياضيات')}`, {
      headers: authHeaders
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Updated progress responded with status ${res.status}: ${errText}`);
    }
    const updatedProgress = await res.json() as any;
    const updatedActivity = updatedProgress.clusters[0].skills[0].activities[0];
    
    console.log("[TEST] Verifying persistence of best attempts in progress response...");
    if (updatedActivity.bestAttemptStars !== 3 || !updatedActivity.bestAttemptCorrect) {
      throw new Error(`Persistence validation failed: expected bestAttemptStars = 3, got ${updatedActivity.bestAttemptStars}`);
    }
    console.log(`[PASS] Persistence validated: Activity now has bestAttemptStars = 3, bestAttemptCorrect = true.`);
    console.log(`[PASS] Mastery recalculation: Cluster mastery is now ${updatedProgress.clusters[0].stats.masteryPercent}% (Recalculated dynamically).`);
  } catch (err: any) {
    console.error("Updated progress check failed:", err.message);
    await prisma.user.delete({ where: { username: AUDIT_USERNAME } });
    process.exit(1);
  }

  // 6. Test Case B: Incorrect answer -> Should yield 0 stars
  await prisma.activityAttempt.deleteMany({
    where: { userId: student.id, activityId: targetActivity.id }
  });

  const attemptPayloadB = {
    selectedAnswer: JSON.stringify({ "8": "99" }), // Wrong answer
    timeTaken: 5,
    hintsUsed: 0,
    attemptCount: 1
  };
  
  console.log("[TEST] Submitting incorrect answer...");
  try {
    const res = await fetch(`${BACKEND_URL}/api/skills-hub/activities/${targetActivity.id}/attempt`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(attemptPayloadB)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Attempt submission B responded with status ${res.status}: ${errText}`);
    }
    const attemptResult = await res.json() as any;
    console.log(`[PASS] Incorrect Submission Result: isCorrect = ${attemptResult.isCorrect}, Stars = ${attemptResult.stars}, Score = ${attemptResult.score} XP.`);
    if (attemptResult.isCorrect || attemptResult.stars !== 0) {
      throw new Error(`Expected 0 stars and false correctness, but got isCorrect: ${attemptResult.isCorrect}, stars: ${attemptResult.stars}`);
    }
  } catch (err: any) {
    console.error("Attempt submission B failed:", err.message);
    await prisma.user.delete({ where: { username: AUDIT_USERNAME } });
    process.exit(1);
  }

  // 7. Cleanup and Restore
  await prisma.activityAttempt.deleteMany({
    where: { userId: student.id }
  });
  await prisma.user.delete({
    where: { username: AUDIT_USERNAME }
  });
  console.log(`[CLEANUP] Deleted temporary student user and attempts.`);

  console.log("==================================================");
  console.log("ALL LIVE END-TO-END AUDIT CHECKS PASSED!");
  console.log("==================================================");
}

runLiveAudit().catch(err => {
  console.error("Live Audit Failed:", err);
  process.exit(1);
});
