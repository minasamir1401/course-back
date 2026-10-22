require('ts-node/register/transpile-only');
const express = require('express');
const request = require('supertest');
const mockDb = { user: { findUnique: jest.fn() }, exam: { findMany: jest.fn() }, lesson: { findMany: jest.fn() } };
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

test('calendar uses the selected Egypt day, real course artwork and actionable lesson and exam links', async()=>{
 mockDb.user.findUnique.mockResolvedValue({id:'me',role:'STUDENT',schoolId:'own',grade:'Grade 3'});
 mockDb.exam.findMany.mockResolvedValue([{id:'exam',title:'Exam',subjects:'Arabic',course:{title:'Arabic course',subject:'Arabic',coverImage:'/uploads/arabic.webp'},startDate:new Date('2026-10-20T10:00:00Z'),endDate:new Date('2026-10-21T10:00:00Z'),modules:[{subExams:[{id:'child',title:'Practice',publishDate:new Date('2026-10-20T11:00:00Z'),cutOffDate:new Date('2026-10-21T11:00:00Z')}]}]}]);
 mockDb.lesson.findMany.mockResolvedValue([{id:'lesson',title:'Lesson',courseId:'course',course:{title:'Math course',subject:'Math',coverImage:null},publishDate:new Date('2026-10-20T20:30:00Z'),cutOffDate:new Date('2026-10-19T10:00:00Z')}]);
 const response=await request(app).get('/api/workspace/calendar?from=2026-10-20&to=2026-10-20').expect(200);expect(response.body.timeZone).toBe('Africa/Cairo');expect(response.body.events).toHaveLength(3);expect(response.body.events.every(event=>event.day==='2026-10-20')).toBe(true);
 expect(response.body.events[0]).toMatchObject({id:'exam-start',subject:'Arabic',courseTitle:'Arabic course',coverImage:'/uploads/arabic.webp',href:'/exams/exam/details'});expect(response.body.events[1].href).toBe('/exams/exam?subExamId=child');expect(response.body.events[2]).toMatchObject({subject:'Math',href:'/lessons/lesson?courseId=course'});
});
