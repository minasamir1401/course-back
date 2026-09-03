require('dotenv').config();

const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { api } = require('../helpers/http.cjs');

const prisma = new PrismaClient();
const TEST_PREFIX = `teacher-exam-access-${Date.now()}`;

let teacherToken;
let teacherId;
let examId;
let courseId;
let ownerSchoolId;
let teacherSchoolId;

describe('teacher exam access parity', () => {
  beforeAll(async () => {
    const ownerSchool = await prisma.school.create({
      data: {
        name: `${TEST_PREFIX}-owner-school`,
      },
    });
    ownerSchoolId = ownerSchool.id;

    const teacherSchool = await prisma.school.create({
      data: {
        name: `${TEST_PREFIX}-teacher-school`,
      },
    });
    teacherSchoolId = teacherSchool.id;

    const teacher = await prisma.user.create({
      data: {
        name: `${TEST_PREFIX}-teacher`,
        username: `${TEST_PREFIX}-teacher`,
        password: 'unused-for-token-test',
        role: 'TEACHER',
        status: 'ACTIVE',
        schoolId: teacherSchoolId,
      },
    });
    teacherId = teacher.id;

    const course = await prisma.course.create({
      data: {
        title: `${TEST_PREFIX}-course`,
        isCentral: false,
        schoolId: ownerSchoolId,
      },
    });
    courseId = course.id;

    await prisma.teacherCourse.create({
      data: {
        teacherId,
        courseId,
      },
    });

    const exam = await prisma.exam.create({
      data: {
        title: `${TEST_PREFIX}-exam`,
        type: 'Exam',
        isCentral: false,
        schoolId: ownerSchoolId,
        courseId,
        status: 'PUBLISHED',
      },
    });
    examId = exam.id;

    teacherToken = jwt.sign(
      { id: teacherId, role: 'TEACHER', schoolId: teacherSchoolId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
    );
  });

  afterAll(async () => {
    await prisma.teacherCourse.deleteMany({ where: { teacherId } });
    await prisma.exam.deleteMany({ where: { id: examId } });
    await prisma.course.deleteMany({ where: { id: courseId } });
    await prisma.user.deleteMany({ where: { id: teacherId } });
    await prisma.school.deleteMany({
      where: {
        id: { in: [ownerSchoolId, teacherSchoolId].filter(Boolean) },
      },
    });
    await prisma.$disconnect();
  });

  test('teacher can open exam details for a course they teach', async () => {
    const listResponse = await api()
      .get('/api/exams')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);

    expect(listResponse.body.some((exam) => exam.id === examId)).toBe(true);

    const detailResponse = await api()
      .get(`/api/exams/${examId}`)
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe(examId);
  });
});
