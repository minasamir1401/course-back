/** Existing test fixtures only: a teacher assigned to the course of TEST_TEACHER_EXAM_ID. */
const { api, liveTestsEnabled, requireLiveServer, requireLiveConfig } = require('../helpers/http.cjs');

(liveTestsEnabled ? describe : describe.skip)('teacher exam access parity (requires configured live fixtures)', () => {
  beforeAll(async () => {
    requireLiveConfig(['TEST_TEACHER_AUTH_TOKEN', 'TEST_TEACHER_EXAM_ID']);
    await requireLiveServer();
  });
  test('teacher can open exam details for a course they teach', async () => {
    const token = process.env.TEST_TEACHER_AUTH_TOKEN;
    const examId = process.env.TEST_TEACHER_EXAM_ID;
    const list = await api().get('/api/exams').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.some(exam => exam.id === examId)).toBe(true);
    const detail = await api().get(`/api/exams/${encodeURIComponent(examId)}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(detail.body.id).toBe(examId);
  });
});
