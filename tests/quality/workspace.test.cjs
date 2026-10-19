require('ts-node/register/transpile-only');
const express = require('express');
const request = require('supertest');
const mockDb = { user: { findUnique: jest.fn() } };
jest.mock('../../src/lib/prisma', () => ({ __esModule: true, default: mockDb }));
jest.mock('../../src/middleware/auth', () => ({
  verifyToken: (req, res, next) => { req.user = { id: 'me', role: 'STUDENT', schoolId: 'own' }; next(); },
  checkRole: () => (req, res, next) => next(),
}));
jest.mock('../../src/shared', () => ({ buildStudentCourseWhere: () => ({}), examMatchesStudent: () => true }));
const app = express(); app.use(express.json()); app.use(require('../../src/routes/workspace').default);
beforeEach(() => jest.clearAllMocks());

test('password change rejects a wrong current password before any update', async () => {
  mockDb.user.findUnique.mockResolvedValue({ id: 'me', password: '$2a$10$invalid' });
  await request(app).post('/api/auth/change-password').send({ currentPassword: 'wrong', newPassword: 'NewPassword123' }).expect(403);
});
