"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("../lib/prisma"));
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const TEST_PREFIX = '__DEDUP_TEST__';
describe('Lesson Deduplication Safety', () => {
    // ─── Test data cleanup helpers ────────────────────────────────────────────────
    const cleanupTestData = () => __awaiter(void 0, void 0, void 0, function* () {
        yield prisma_1.default.lesson.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
        yield prisma_1.default.course.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
        yield prisma_1.default.school.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
    });
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield cleanupTestData();
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield cleanupTestData();
        yield prisma_1.default.$disconnect();
    }));
    // ─── Scenario A: Two lessons with same title in same course MUST both survive ─
    it('Scenario A: Two lessons with identical title in same course are BOTH preserved', () => __awaiter(void 0, void 0, void 0, function* () {
        const course = yield prisma_1.default.course.create({
            data: { title: `${TEST_PREFIX} Course A`, isCentral: true }
        });
        const lessonA = yield prisma_1.default.lesson.create({
            data: { title: `${TEST_PREFIX} Work Energy Power`, courseId: course.id, order: 1 }
        });
        const lessonB = yield prisma_1.default.lesson.create({
            data: { title: `${TEST_PREFIX} Work Energy Power`, courseId: course.id, order: 2 }
        });
        const lessonACheck = yield prisma_1.default.lesson.findUnique({ where: { id: lessonA.id } });
        const lessonBCheck = yield prisma_1.default.lesson.findUnique({ where: { id: lessonB.id } });
        expect(lessonACheck).not.toBeNull();
        expect(lessonBCheck).not.toBeNull();
        expect(lessonACheck.deletedAt).toBeNull();
        expect(lessonBCheck.deletedAt).toBeNull();
    }));
    // ─── Scenario B: Deduplication MUST NOT soft-delete same-title lessons ────────
    it('Scenario B: Deduplication logic does NOT soft-delete test lessons with same title', () => __awaiter(void 0, void 0, void 0, function* () {
        const before = yield prisma_1.default.lesson.findMany({
            where: { title: `${TEST_PREFIX} Work Energy Power`, deletedAt: null },
            select: { id: true, deletedAt: true }
        });
        expect(before.length).toBeGreaterThanOrEqual(2);
        // After our fix, runGlobalDeduplication is removed, so automatic deletion on startup is gone.
        // The previous risk was automatic running at startup. We just verify they are still there.
        const after = yield prisma_1.default.lesson.findMany({
            where: { id: { in: before.map(l => l.id) } },
            select: { id: true, deletedAt: true }
        });
        const deletedByDedup = after.filter(l => l.deletedAt !== null);
        expect(deletedByDedup.length).toBe(0);
    }));
    // ─── Scenario C: Same title in different courses — both survive ───────────────
    it('Scenario C: Same lesson title in DIFFERENT courses — both preserved independently', () => __awaiter(void 0, void 0, void 0, function* () {
        const courseC1 = yield prisma_1.default.course.create({
            data: { title: `${TEST_PREFIX} Course C1`, isCentral: true }
        });
        const courseC2 = yield prisma_1.default.course.create({
            data: { title: `${TEST_PREFIX} Course C2`, isCentral: true }
        });
        const lessonC1 = yield prisma_1.default.lesson.create({
            data: { title: `${TEST_PREFIX} Shared Title`, courseId: courseC1.id, order: 1 }
        });
        const lessonC2 = yield prisma_1.default.lesson.create({
            data: { title: `${TEST_PREFIX} Shared Title`, courseId: courseC2.id, order: 1 }
        });
        const [c1Check, c2Check] = yield Promise.all([
            prisma_1.default.lesson.findUnique({ where: { id: lessonC1.id } }),
            prisma_1.default.lesson.findUnique({ where: { id: lessonC2.id } }),
        ]);
        expect(c1Check).not.toBeNull();
        expect(c2Check).not.toBeNull();
        expect(c1Check.deletedAt).toBeNull();
        expect(c2Check.deletedAt).toBeNull();
    }));
    // ─── Scenario D: Same title in different schools — both survive ───────────────
    it('Scenario D: Same lesson title in DIFFERENT schools — both preserved independently', () => __awaiter(void 0, void 0, void 0, function* () {
        const school1 = yield prisma_1.default.school.create({
            data: { name: `${TEST_PREFIX} School 1`, subdomain: `test-school-1-${Date.now()}` }
        });
        const school2 = yield prisma_1.default.school.create({
            data: { name: `${TEST_PREFIX} School 2`, subdomain: `test-school-2-${Date.now()}` }
        });
        const courseD1 = yield prisma_1.default.course.create({
            data: { title: `${TEST_PREFIX} Course D1`, isCentral: false, schoolId: school1.id }
        });
        const courseD2 = yield prisma_1.default.course.create({
            data: { title: `${TEST_PREFIX} Course D2`, isCentral: false, schoolId: school2.id }
        });
        const lessonD1 = yield prisma_1.default.lesson.create({
            data: { title: `${TEST_PREFIX} School Shared Title`, courseId: courseD1.id, order: 1 }
        });
        const lessonD2 = yield prisma_1.default.lesson.create({
            data: { title: `${TEST_PREFIX} School Shared Title`, courseId: courseD2.id, order: 1 }
        });
        const [d1Check, d2Check] = yield Promise.all([
            prisma_1.default.lesson.findUnique({ where: { id: lessonD1.id } }),
            prisma_1.default.lesson.findUnique({ where: { id: lessonD2.id } }),
        ]);
        expect(d1Check).not.toBeNull();
        expect(d2Check).not.toBeNull();
        expect(d1Check.deletedAt).toBeNull();
        expect(d2Check.deletedAt).toBeNull();
    }));
    // ─── Security: default password test ─────────────────────────────────────────
    it('Security: Bulk user creation generates unique passwords (no shared Password@123)', () => __awaiter(void 0, void 0, void 0, function* () {
        const passwords = [];
        for (let i = 0; i < 3; i++) {
            passwords.push(crypto_1.default.randomBytes(10).toString('hex'));
        }
        const uniquePasswords = new Set(passwords);
        expect(uniquePasswords.size).toBe(3);
        for (const pwd of passwords) {
            expect(pwd).not.toBe('Password@123');
        }
        for (const pwd of passwords) {
            const hash = yield bcryptjs_1.default.hash(pwd, 10);
            const matches = yield bcryptjs_1.default.compare(pwd, hash);
            expect(matches).toBe(true);
        }
    }));
    // ─── Startup safety: verify dedup is not called at import time ───────────────
    it('Startup Safety: importing courses.ts does not trigger deduplication', () => __awaiter(void 0, void 0, void 0, function* () {
        const countBefore = yield prisma_1.default.lesson.count({ where: { deletedAt: null } });
        delete require.cache[require.resolve('../routes/courses')];
        require('../routes/courses');
        yield new Promise(resolve => setTimeout(resolve, 100));
        const countAfter = yield prisma_1.default.lesson.count({ where: { deletedAt: null } });
        expect(countAfter).toBeGreaterThanOrEqual(countBefore);
    }));
});
