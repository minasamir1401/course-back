const { api, liveTestsEnabled, requireLiveServer } = require('../helpers/http.cjs');

(liveTestsEnabled ? describe : describe.skip)('backend integration (requires REQUIRE_LIVE_TESTS=1)', () => {
  beforeAll(() => requireLiveServer());

  test('health endpoint reports a live API and database', async () => {
    const response = await api().get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body).not.toHaveProperty('stack');
  });

  test('protected classes endpoint rejects anonymous access', async () => {
    const response = await api().get('/api/classes');
    expect([401, 403]).toContain(response.status);
  });
});
