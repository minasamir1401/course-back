const { api, checkServer } = require('../helpers/http.cjs');

describe('backend integration', () => {
  let isLive = false;

  beforeAll(async () => {
    isLive = await checkServer();
  });

  test('health endpoint reports a live API and database', async () => {
    if (!isLive) return;
    const response = await api().get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body).not.toHaveProperty('stack');
  });

  test('protected classes endpoint rejects anonymous access', async () => {
    if (!isLive) return;
    const response = await api().get('/api/classes');
    expect([401, 403]).toContain(response.status);
  });
});
