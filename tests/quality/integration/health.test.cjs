const { api } = require('../helpers/http.cjs');

describe('backend integration', () => {
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
