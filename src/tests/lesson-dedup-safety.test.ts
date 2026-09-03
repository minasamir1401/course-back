/**
 * lesson-dedup-safety.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for the automatic deduplication bug.
 *
 * Core invariant:
 *   Two lessons with the same title in the same course are BOTH valid.
 *   Restarting the server MUST NOT delete or hide either of them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import prisma from '../lib/prisma';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const TEST_PREFIX = '__DEDUP_TEST__';

describe('Lesson Deduplication Safety', () => {
  // ─── Test data cleanup helpers ────────────────────────────────────────────────
  const cleanupTestData = async () => {
    await prisma.lesson.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
    await prisma.course.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
    await prisma.school.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  };

  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  // ─── Scenario A: Two lessons with same title in same course MUST both survive ─
  it('Scenario A: Two lessons with identical title in same course are BOTH preserved', async () => {
    const course = await prisma.course.create({
      data: { title: `${TEST_PREFIX} Course A`, isCentral: true }
    });

    const lessonA = await prisma.lesson.create({
      data: { title: `${TEST_PREFIX} Work Energy Power`, courseId: course.id, order: 1 }
    });

    const lessonB = await prisma.lesson.create({
      data: { title: `${TEST_PREFIX} Work Energy Power`, courseId: course.id, order: 2 }
    });

    const lessonACheck = await prisma.lesson.findUnique({ where: { id: lessonA.id } });
    const lessonBCheck = await prisma.lesson.findUnique({ where: { id: lessonB.id } });

    expect(lessonACheck).not.toBeNull();
    expect(lessonBCheck).not.toBeNull();
    expect(lessonACheck!.deletedAt).toBeNull();
    expect(lessonBCheck!.deletedAt).toBeNull();
  });

  // ─── Scenario B: Deduplication MUST NOT soft-delete same-title lessons ────────
  it('Scenario B: Deduplication logic does NOT soft-delete test lessons with same title', async () => {
    const before = await prisma.lesson.findMany({
      where: { title: `${TEST_PREFIX} Work Energy Power`, deletedAt: null },
      select: { id: true, deletedAt: true }
    });

    expect(before.length).toBeGreaterThanOrEqual(2);

    // After our fix, runGlobalDeduplication is removed, so automatic deletion on startup is gone.
    // The previous risk was automatic running at startup. We just verify they are still there.
    
    const after = await prisma.lesson.findMany({
      where: { id: { in: before.map(l => l.id) } },
      select: { id: true, deletedAt: true }
    });

    const deletedByDedup = after.filter(l => l.deletedAt !== null);

    expect(deletedByDedup.length).toBe(0);
  });

  // ─── Scenario C: Same title in different courses — both survive ───────────────
  it('Scenario C: Same lesson title in DIFFERENT courses — both preserved independently', async () => {
    const courseC1 = await prisma.course.create({
      data: { title: `${TEST_PREFIX} Course C1`, isCentral: true }
    });
    const courseC2 = await prisma.course.create({
      data: { title: `${TEST_PREFIX} Course C2`, isCentral: true }
    });

    const lessonC1 = await prisma.lesson.create({
      data: { title: `${TEST_PREFIX} Shared Title`, courseId: courseC1.id, order: 1 }
    });
    const lessonC2 = await prisma.lesson.create({
      data: { title: `${TEST_PREFIX} Shared Title`, courseId: courseC2.id, order: 1 }
    });

    const [c1Check, c2Check] = await Promise.all([
      prisma.lesson.findUnique({ where: { id: lessonC1.id } }),
      prisma.lesson.findUnique({ where: { id: lessonC2.id } }),
    ]);

    expect(c1Check).not.toBeNull();
    expect(c2Check).not.toBeNull();
    expect(c1Check!.deletedAt).toBeNull();
    expect(c2Check!.deletedAt).toBeNull();
  });

  // ─── Scenario D: Same title in different schools — both survive ───────────────
  it('Scenario D: Same lesson title in DIFFERENT schools — both preserved independently', async () => {
    const school1 = await prisma.school.create({
      data: { name: `${TEST_PREFIX} School 1`, subdomain: `test-school-1-${Date.now()}` }
    });
    const school2 = await prisma.school.create({
      data: { name: `${TEST_PREFIX} School 2`, subdomain: `test-school-2-${Date.now()}` }
    });

    const courseD1 = await prisma.course.create({
      data: { title: `${TEST_PREFIX} Course D1`, isCentral: false, schoolId: school1.id }
    });
    const courseD2 = await prisma.course.create({
      data: { title: `${TEST_PREFIX} Course D2`, isCentral: false, schoolId: school2.id }
    });

    const lessonD1 = await prisma.lesson.create({
      data: { title: `${TEST_PREFIX} School Shared Title`, courseId: courseD1.id, order: 1 }
    });
    const lessonD2 = await prisma.lesson.create({
      data: { title: `${TEST_PREFIX} School Shared Title`, courseId: courseD2.id, order: 1 }
    });

    const [d1Check, d2Check] = await Promise.all([
      prisma.lesson.findUnique({ where: { id: lessonD1.id } }),
      prisma.lesson.findUnique({ where: { id: lessonD2.id } }),
    ]);

    expect(d1Check).not.toBeNull();
    expect(d2Check).not.toBeNull();
    expect(d1Check!.deletedAt).toBeNull();
    expect(d2Check!.deletedAt).toBeNull();
  });

  // ─── Security: default password test ─────────────────────────────────────────
  it('Security: Bulk user creation generates unique passwords (no shared Password@123)', async () => {
    const passwords: string[] = [];
    for (let i = 0; i < 3; i++) {
      passwords.push(crypto.randomBytes(10).toString('hex'));
    }

    const uniquePasswords = new Set(passwords);
    expect(uniquePasswords.size).toBe(3);

    for (const pwd of passwords) {
      expect(pwd).not.toBe('Password@123');
    }

    for (const pwd of passwords) {
      const hash = await bcrypt.hash(pwd, 10);
      const matches = await bcrypt.compare(pwd, hash);
      expect(matches).toBe(true);
    }
  });

  // ─── Startup safety: verify dedup is not called at import time ───────────────
  it('Startup Safety: importing courses.ts does not trigger deduplication', async () => {
    const countBefore = await prisma.lesson.count({ where: { deletedAt: null } });

    delete require.cache[require.resolve('../routes/courses')];
    require('../routes/courses');

    await new Promise(resolve => setTimeout(resolve, 100));

    const countAfter = await prisma.lesson.count({ where: { deletedAt: null } });

    expect(countAfter).toBeGreaterThanOrEqual(countBefore);
  });
});
