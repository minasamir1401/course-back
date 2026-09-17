process.env.JWT_SECRET = 'translate-security-test-key-2026';
require('ts-node/register/transpile-only');

const mockSubmissions = new Map();

jest.mock('../../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    examSubmission: {
      findUnique: jest.fn(async ({ where }) => mockSubmissions.get(where.id) || null),
      count: jest.fn(async () => 0),
      update: jest.fn(async () => ({})),
    },
    subExam: {
      findUnique: jest.fn(async () => null),
    },
    user: {
      findUnique: jest.fn(async () => ({ status: 'ACTIVE' })),
    },
  },
}));

jest.mock('../../../src/lib/redis', () => ({
  cacheGetJSON: jest.fn(async () => null),
  cacheSetJSON: jest.fn(async () => {}),
  cacheDelete: jest.fn(async () => {}),
}));

jest.mock('../../../src/services/translation.service', () => ({
  translateSingleText: jest.fn(async (text) => `Translated: ${text}`),
  translateBatchTexts: jest.fn(async (texts) => texts.map((t) => `Translated: ${t}`)),
}));

const { getExamHandler14 } = require('../../../src/controllers/exams.controller');
const systemRouter = require('../../../src/routes/system').default;
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const createToken = (payload) => jwt.sign(payload, process.env.JWT_SECRET);

describe('Bilingual explanation return and /api/translate authorization & validation', () => {
  const studentUser = { id: 'student-1', role: 'STUDENT', schoolId: 'school-1' };
  const teacherUser = { id: 'teacher-1', role: 'TEACHER', schoolId: 'school-1' };

  beforeEach(() => {
    mockSubmissions.clear();
  });

  test('getExamHandler14 returns explanationEn and question metadata to students under SHOW_ANSWERS policy', async () => {
    const submissionId = 'sub-100';
    mockSubmissions.set(submissionId, {
      id: submissionId,
      userId: 'student-1',
      examId: 'exam-1',
      totalScore: 10,
      createdAt: new Date(),
      user: { name: 'Student 1', role: 'STUDENT', schoolId: 'school-1' },
      exam: {
        id: 'exam-1',
        title: 'Bilingual Science Exam',
        resultVisibility: 'SHOW_ANSWERS',
      },
      answers: [
        {
          id: 'ans-1',
          selectedAnswer: 'Gravity',
          isCorrect: true,
          question: {
            id: 'q-1',
            text: 'ما هي القوة التي تجذب الأشياء نحو الأرض؟',
            textEn: 'What force pulls objects toward the Earth?',
            type: 'MCQ',
            label: 'MCQ',
            imageUrl: 'https://example.com/gravity.png',
            domain: 'Physics',
            standard: 'Forces and Motion',
            indicator: 'Gravitational Force',
            learningOutcome: 'Understand gravity',
            skill: 'Science Investigation',
            subskill: 'Classical Mechanics',
            microSkill: 'Universal Gravitation',
            dok: 'DOK 2',
            level: 'Medium',
            cognitive: 'Application',
            errorPattern: null,
            options: JSON.stringify(['Gravity', 'Magnetism', 'Friction']),
            optionsEn: JSON.stringify(['Gravity', 'Magnetism', 'Friction']),
            correctAnswer: 'Gravity',
            correctAnswerEn: 'Gravity',
            points: 5,
            explanation: 'الجاذبية هي قوة الشد بين الأجسام ذات الكتلة.',
            explanationEn: 'Gravity is the attractive force between objects with mass.',
            deletedAt: null,
          },
        },
      ],
    });

    const req = {
      params: { id: submissionId },
      user: studentUser,
    };

    let statusCode = 200;
    let responseBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await getExamHandler14(req, res);

    expect(statusCode).toBe(200);
    expect(responseBody).toBeDefined();
    expect(responseBody.answers).toHaveLength(1);

    const q = responseBody.answers[0].question;
    expect(q.textEn).toBe('What force pulls objects toward the Earth?');
    expect(q.explanation).toBe('الجاذبية هي قوة الشد بين الأجسام ذات الكتلة.');
    expect(q.explanationEn).toBe('Gravity is the attractive force between objects with mass.');
    expect(q.imageUrl).toBe('https://example.com/gravity.png');
    expect(q.domain).toBe('Physics');
  });

  describe('/api/translate route authorization & payload validation', () => {
    const app = express();
    app.use(express.json());
    app.use(systemRouter);

    test('denies translation request for STUDENT role with 403', async () => {
      const studentToken = createToken(studentUser);
      const res = await request(app)
        .post('/api/translate')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ text: 'مرحبا', from: 'ar', to: 'en' });

      expect(res.status).toBe(403);
    });

    test('allows translation request for TEACHER role with 200', async () => {
      const teacherToken = createToken(teacherUser);
      const res = await request(app)
        .post('/api/translate')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ text: 'مرحبا', from: 'ar', to: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.translatedText).toBe('Translated: مرحبا');
    });

    test('rejects batch translation exceeding 50 items with 400', async () => {
      const teacherToken = createToken(teacherUser);
      const oversizedBatch = Array.from({ length: 51 }, (_, i) => `Text ${i}`);
      const res = await request(app)
        .post('/api/translate')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ texts: oversizedBatch, from: 'ar', to: 'en' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Batch translation limited to 50 items');
    });

    test('rejects single text exceeding 5000 characters with 400', async () => {
      const teacherToken = createToken(teacherUser);
      const hugeText = 'A'.repeat(5001);
      const res = await request(app)
        .post('/api/translate')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ text: hugeText, from: 'ar', to: 'en' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Text exceeds maximum length');
    });

  });
});
