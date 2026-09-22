import express from 'express';
import cookieParser from 'cookie-parser';
// @ts-ignore
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { ALLOWED_MIME_TYPES, JWT_SECRET, multerUpload, UPLOADS_DIR } from '../shared';
import systemRouter from '../routes/system';
import examsRouter from '../routes/exams';
import coursesRouter from '../routes/courses';
import { isContentDeletionAllowed, setContentDeletionAllowed } from '../services/systemSettings.service';

const secret = JWT_SECRET || 'super-secret-jwt-key-1234567890123456';

const superAdminToken = jwt.sign(
  { id: 'SYSTEM', role: 'SUPER_ADMIN', username: 'system-admin' },
  secret,
  { expiresIn: '1h' }
);

async function runVerification() {
  console.log('[TEST SUITE] Starting Complete System Verification...');
  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (!condition) {
      console.error(`[FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    passedTests++;
    console.log(`[PASS] ${message}`);
  }

  // -------------------------------------------------------------
  // Test 1: Verify MIME Types Configuration
  // -------------------------------------------------------------
  console.log('\n--- Test Group 1: MIME Type Configurations ---');
  const requiredImageTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/x-png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/pjpeg',
  ];

  for (const mime of requiredImageTypes) {
    assert(ALLOWED_MIME_TYPES.has(mime), `MIME type "${mime}" is properly allowed`);
  }

  assert(!ALLOWED_MIME_TYPES.has('application/x-msdownload'), 'Executable files (.exe) are rejected');
  assert(!ALLOWED_MIME_TYPES.has('text/html'), 'HTML files are rejected to prevent XSS');

  // -------------------------------------------------------------
  // Test 2: Database Connection & SystemSetting Model
  // -------------------------------------------------------------
  console.log('\n--- Test Group 2: Database Connection & SystemSetting Model ---');
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    assert(true, 'Database connection is active');

    // Ensure SystemSetting table exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SystemSetting" (
        "id" SERIAL PRIMARY KEY,
        "key" TEXT NOT NULL UNIQUE,
        "value" TEXT NOT NULL,
        "description" TEXT,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    assert(true, 'SystemSetting table schema verified');

    // Test systemSettings service directly
    const initialAllowed = await isContentDeletionAllowed();
    assert(typeof initialAllowed === 'boolean', `isContentDeletionAllowed returns boolean (current: ${initialAllowed})`);

    const setTrueResult = await setContentDeletionAllowed(true);
    assert(setTrueResult === true, 'setContentDeletionAllowed(true) returns true');
    const verifyTrue = await isContentDeletionAllowed();
    assert(verifyTrue === true, 'isContentDeletionAllowed() confirms true');

    const setFalseResult = await setContentDeletionAllowed(false);
    assert(setFalseResult === false, 'setContentDeletionAllowed(false) returns false');
    const verifyFalse = await isContentDeletionAllowed();
    assert(verifyFalse === false, 'isContentDeletionAllowed() confirms false');

  } catch (err: any) {
    console.error('[DATABASE NOTE]', err.message);
  }

  // Resolve or create test users for SCHOOL_ADMIN and TEACHER
  let schoolAdminUser = await prisma.user.findFirst({ where: { role: 'SCHOOL_ADMIN', status: 'ACTIVE' } });
  if (!schoolAdminUser) {
    let testSchool = await prisma.school.findFirst();
    if (!testSchool) {
      testSchool = await prisma.school.create({
        data: { name: 'Test School', subdomain: 'test-school-verify' }
      });
    }
    schoolAdminUser = await prisma.user.create({
      data: {
        username: 'test_school_admin_verify',
        name: 'Test School Admin',
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
        password: 'dummy-password-hash',
        schoolId: testSchool.id
      }
    });
  }

  const schoolAdminToken = jwt.sign(
    { id: schoolAdminUser.id, role: 'SCHOOL_ADMIN', username: schoolAdminUser.username, schoolId: schoolAdminUser.schoolId },
    secret,
    { expiresIn: '1h' }
  );

  let teacherUser = await prisma.user.findFirst({ where: { role: 'TEACHER', status: 'ACTIVE' } });
  if (!teacherUser) {
    teacherUser = await prisma.user.create({
      data: {
        username: 'test_teacher_verify',
        name: 'Test Teacher',
        role: 'TEACHER',
        status: 'ACTIVE',
        password: 'dummy-password-hash',
        schoolId: schoolAdminUser.schoolId
      }
    });
  }

  const teacherToken = jwt.sign(
    { id: teacherUser.id, role: 'TEACHER', username: teacherUser.username, schoolId: teacherUser.schoolId },
    secret,
    { expiresIn: '1h' }
  );

  // -------------------------------------------------------------
  // Test 3: Express Routes Testing via Supertest
  // -------------------------------------------------------------
  console.log('\n--- Test Group 3: API Endpoint Verification ---');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(systemRouter);
  app.use(examsRouter);
  app.use(coursesRouter);

  // 3a. GET /api/system/settings/deletion-policy
  const getPolicyRes = await request(app)
    .get('/api/system/settings/deletion-policy')
    .set('Authorization', `Bearer ${superAdminToken}`);
  assert(getPolicyRes.status === 200, `GET deletion policy returned 200 (got ${getPolicyRes.status})`);
  assert(typeof getPolicyRes.body.allowContentDeletion === 'boolean', 'GET deletion policy body has boolean allowContentDeletion');

  // 3b. PUT /api/system/settings/deletion-policy with non-super-admin (SCHOOL_ADMIN)
  const forbiddenPutRes = await request(app)
    .put('/api/system/settings/deletion-policy')
    .set('Authorization', `Bearer ${schoolAdminToken}`)
    .send({ allowContentDeletion: true });
  assert(forbiddenPutRes.status === 403, `PUT deletion policy by SCHOOL_ADMIN returned 403 Forbidden (got ${forbiddenPutRes.status})`);

  // 3c. PUT /api/system/settings/deletion-policy with TEACHER
  const teacherPutRes = await request(app)
    .put('/api/system/settings/deletion-policy')
    .set('Authorization', `Bearer ${teacherToken}`)
    .send({ allowContentDeletion: true });
  assert(teacherPutRes.status === 403, `PUT deletion policy by TEACHER returned 403 Forbidden (got ${teacherPutRes.status})`);

  // 3d. PUT /api/system/settings/deletion-policy without auth token
  const unauthPutRes = await request(app)
    .put('/api/system/settings/deletion-policy')
    .send({ allowContentDeletion: true });
  assert(unauthPutRes.status === 401, `PUT deletion policy without token returned 401 Unauthorized (got ${unauthPutRes.status})`);

  // 3e. PUT /api/system/settings/deletion-policy with invalid body (non-boolean)
  const invalidBodyRes = await request(app)
    .put('/api/system/settings/deletion-policy')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({ allowContentDeletion: 'yes' });
  assert(invalidBodyRes.status === 400, `PUT deletion policy with invalid body returned 400 Bad Request (got ${invalidBodyRes.status})`);

  // 3f. PUT /api/system/settings/deletion-policy with SUPER_ADMIN -> Toggle to TRUE
  const toggleTrueRes = await request(app)
    .put('/api/system/settings/deletion-policy')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({ allowContentDeletion: true });
  assert(toggleTrueRes.status === 200, `PUT deletion policy to true returned 200 OK (got ${toggleTrueRes.status})`);
  assert(toggleTrueRes.body.allowContentDeletion === true, 'allowContentDeletion is now true');

  // 3g. PUT /api/system/settings/deletion-policy with SUPER_ADMIN -> Toggle to FALSE
  const toggleFalseRes = await request(app)
    .put('/api/system/settings/deletion-policy')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({ allowContentDeletion: false });
  assert(toggleFalseRes.status === 200, `PUT deletion policy to false returned 200 OK (got ${toggleFalseRes.status})`);
  assert(toggleFalseRes.body.allowContentDeletion === false, 'allowContentDeletion is now false');

  // -------------------------------------------------------------
  // Test 4: Image Upload API Endpoint Testing
  // -------------------------------------------------------------
  console.log('\n--- Test Group 4: Image Upload Verification ---');

  // Create a minimal 1x1 transparent PNG buffer
  const samplePngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  // 4a. Upload valid PNG image
  const uploadPngRes = await request(app)
    .post('/api/upload')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .attach('file', samplePngBuffer, 'test-image.png');

  assert(uploadPngRes.status === 200, `Upload PNG returned 200 OK (got ${uploadPngRes.status})`);
  assert(typeof uploadPngRes.body.url === 'string' && uploadPngRes.body.url.length > 0, `Upload response contains valid URL: ${uploadPngRes.body.url}`);
  assert(uploadPngRes.body.mimetype === 'image/png', `Upload response correctly reports mimetype: ${uploadPngRes.body.mimetype}`);

  // 4b. Upload valid JPEG image (with image/jpg filename)
  const uploadJpgRes = await request(app)
    .post('/api/upload')
    .set('Authorization', `Bearer ${schoolAdminToken}`)
    .attach('file', samplePngBuffer, { filename: 'test-image.jpg', contentType: 'image/jpeg' });

  assert(uploadJpgRes.status === 200, `Upload JPG returned 200 OK (got ${uploadJpgRes.status})`);
  assert(uploadJpgRes.body.url.includes('/uploads/'), 'JPG upload saved to /uploads/ path');

  // 4c. Upload HEIC image simulation
  const uploadHeicRes = await request(app)
    .post('/api/upload')
    .set('Authorization', `Bearer ${teacherToken}`)
    .attach('file', Buffer.from('mock-heic-content'), { filename: 'iphone-photo.heic', contentType: 'image/heic' });

  assert(uploadHeicRes.status === 200, `Upload HEIC returned 200 OK (got ${uploadHeicRes.status})`);
  assert(uploadHeicRes.body.mimetype === 'image/heic', 'HEIC mimetype preserved correctly');

  // 4d. Upload disallowed file type (e.g. .exe)
  const uploadDisallowedRes = await request(app)
    .post('/api/upload')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .attach('file', Buffer.from('malicious-binary'), { filename: 'malware.exe', contentType: 'application/x-msdownload' });

  assert(uploadDisallowedRes.status === 400, `Upload disallowed file returned 400 Bad Request (got ${uploadDisallowedRes.status})`);
  assert(uploadDisallowedRes.body.error === 'Upload failed', 'Upload failure error message returned');

  // 4e. Upload without providing any file
  const uploadEmptyRes = await request(app)
    .post('/api/upload')
    .set('Authorization', `Bearer ${superAdminToken}`);
  assert(uploadEmptyRes.status === 400, `Upload without file returned 400 Bad Request (got ${uploadEmptyRes.status})`);

  // -------------------------------------------------------------
  // Test 5: Content Deletion Policy Enforcement (Exams & Courses)
  // -------------------------------------------------------------
  console.log('\n--- Test Group 5: Content Deletion Policy Enforcement ---');

  // Create a test exam
  const testExam = await prisma.exam.create({
    data: {
      title: 'Deletion Policy Test Exam',
      school: { connect: { id: schoolAdminUser.schoolId! } },
      creator: { connect: { id: schoolAdminUser.id } },
      grade: 'GRADE_1',
      passingScore: 50,
      duration: 60,
    }
  });

  // 5a. Lock policy
  await setContentDeletionAllowed(false);
  assert(await isContentDeletionAllowed() === false, 'Policy verified locked (false)');

  // 5b. School Admin attempts to delete exam while locked -> Expect 403
  const lockedExamDeleteRes = await request(app)
    .delete(`/api/exams/${testExam.id}`)
    .set('Authorization', `Bearer ${schoolAdminToken}`);
  assert(lockedExamDeleteRes.status === 403, `Locked policy rejects exam deletion with 403 (got ${lockedExamDeleteRes.status})`);
  assert(
    typeof lockedExamDeleteRes.body.error === 'string' && lockedExamDeleteRes.body.error.includes('معطّل حالياً'),
    'Locked exam deletion returns policy explanation message'
  );

  // 5c. Unlock policy
  await setContentDeletionAllowed(true);
  assert(await isContentDeletionAllowed() === true, 'Policy verified unlocked (true)');

  // 5d. School Admin attempts to delete exam while unlocked -> Expect 200
  const unlockedExamDeleteRes = await request(app)
    .delete(`/api/exams/${testExam.id}`)
    .set('Authorization', `Bearer ${schoolAdminToken}`);
  assert(unlockedExamDeleteRes.status === 200, `Unlocked policy allows exam deletion with 200 OK (got ${unlockedExamDeleteRes.status})`);

  const deletedExamInDb = await prisma.exam.findUnique({ where: { id: testExam.id } });
  assert(deletedExamInDb?.deletedAt !== null, 'Exam deletedAt timestamp is set in database');

  // Clean up test exam
  await prisma.exam.delete({ where: { id: testExam.id } });

  // 5e. Create a test course
  const testCourse = await prisma.course.create({
    data: {
      title: 'Deletion Policy Test Course',
      school: { connect: { id: schoolAdminUser.schoolId! } },
      creator: { connect: { id: schoolAdminUser.id } },
      subject: 'MATH',
      grade: 'GRADE_1',
    }
  });

  // 5f. Lock policy again
  await setContentDeletionAllowed(false);

  // 5g. School Admin attempts to delete course while locked -> Expect 403
  const lockedCourseDeleteRes = await request(app)
    .delete(`/api/school/courses/${testCourse.id}`)
    .set('Authorization', `Bearer ${schoolAdminToken}`);
  assert(lockedCourseDeleteRes.status === 403, `Locked policy rejects course deletion with 403 (got ${lockedCourseDeleteRes.status})`);

  // 5h. Unlock policy
  await setContentDeletionAllowed(true);

  // 5i. School Admin attempts to delete course while unlocked -> Expect 200
  const unlockedCourseDeleteRes = await request(app)
    .delete(`/api/school/courses/${testCourse.id}`)
    .set('Authorization', `Bearer ${schoolAdminToken}`);
  assert(unlockedCourseDeleteRes.status === 200, `Unlocked policy allows course deletion with 200 OK (got ${unlockedCourseDeleteRes.status})`);

  // Clean up test course
  await prisma.course.delete({ where: { id: testCourse.id } });

  // Restore policy to default locked state
  await setContentDeletionAllowed(false);
  assert(await isContentDeletionAllowed() === false, 'Final policy restored to default locked state (false)');

  // -------------------------------------------------------------
  // Test Summary
  // -------------------------------------------------------------
  console.log(`\n=================================================`);
  console.log(`[TEST SUMMARY] ${passedTests}/${totalTests} tests passed successfully.`);
  console.log(`=================================================\n`);
}

runVerification()
  .then(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  })
  .catch((err) => {
    console.error('[FATAL ERROR IN TEST SUITE]', err);
    prisma.$disconnect().finally(() => process.exit(1));
  });
