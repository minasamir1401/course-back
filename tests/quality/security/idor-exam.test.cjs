/**
 * Read-only live isolation checks. Supply two existing SCHOOL_ADMIN tokens and
 * two existing non-central, unshared exams from DIFFERENT schools in a test backend.
 * No dotenv loading, JWT signing, database access, or fixture creation occurs here.
 * REQUIRE_LIVE_TESTS=1 makes missing fixtures/dependencies FAIL; otherwise Jest skips.
 * Mutation policy is covered offline in exam-access-policy.test.cjs; production data
 * must never be used as a disposable update/delete/publish target.
 */
const { api, liveTestsEnabled, requireLiveServer, requireLiveConfig } = require('../helpers/http.cjs');
const fixtureNames = ['TEST_IDOR_ADMIN_A_TOKEN', 'TEST_IDOR_ADMIN_B_TOKEN', 'TEST_IDOR_EXAM_A_ID', 'TEST_IDOR_EXAM_B_ID'];

(liveTestsEnabled ? describe : describe.skip)('IDOR live read isolation (requires configured school fixtures)', () => {
  let fixtures;
  const get = (path, token) => api().get(path).set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    requireLiveConfig(fixtureNames);
    await requireLiveServer();
    fixtures = [
      { token: process.env.TEST_IDOR_ADMIN_A_TOKEN, id: process.env.TEST_IDOR_EXAM_A_ID },
      { token: process.env.TEST_IDOR_ADMIN_B_TOKEN, id: process.env.TEST_IDOR_EXAM_B_ID },
    ];
    expect(fixtures[0].id).not.toBe(fixtures[1].id);
    expect(fixtures[0].token).not.toBe(fixtures[1].token);
    // Positive controls are mandatory: nonexistent IDs or rejected tokens cannot pass.
    const own = await Promise.all(fixtures.map(f => get(`/api/exams/${encodeURIComponent(f.id)}`, f.token).expect(200)));
    own.forEach((res, i) => {
      expect(res.body.id).toBe(fixtures[i].id);
      expect(res.body.schoolId).toEqual(expect.any(String));
      expect(res.body.isCentral).toBe(false);
    });
    expect(own[0].body.schoolId).not.toBe(own[1].body.schoolId);
  });

  test.each([0, 1])('school %i administrator can read their own exam and its questions', async index => {
    const own = fixtures[index];
    const res = await get(`/api/exams/${encodeURIComponent(own.id)}`, own.token).expect(200);
    expect(res.body.id).toBe(own.id);
    await get(`/api/exams/${encodeURIComponent(own.id)}/questions`, own.token).expect(200);
  });
  test.each([0, 1])('school %i administrator cannot read the other school exam or its questions', async index => {
    const own = fixtures[index];
    const other = fixtures[1 - index];
    for (const suffix of ['', '/questions']) {
      const res = await get(`/api/exams/${encodeURIComponent(other.id)}${suffix}`, own.token);
      expect([403, 404]).toContain(res.status);
    }
  });
  test('anonymous access to an existing fixture exam is rejected', async () => {
    const res = await api().get(`/api/exams/${encodeURIComponent(fixtures[0].id)}`);
    expect([401, 403]).toContain(res.status);
  });
  test.skip('live UPDATE/DELETE/PUBLISH isolation requires a disposable fixture harness; offline policy tests cover mutation authorization', () => {});
});
