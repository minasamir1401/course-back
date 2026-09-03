const { api, authHeaders } = require('../helpers/http.cjs');

const protectedPaths = ['/api/classes', '/api/courses', '/api/exams', '/api/students'];

describe('backend security checks', () => {
  test('responses include baseline security headers', async () => {
    const response = await api().get('/api/health').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  test.each(protectedPaths)('%s does not allow anonymous access', async path => {
    const response = await api().get(path);
    expect([401, 403, 404]).toContain(response.status);
  });

  test('error responses do not expose stack traces or secrets', async () => {
    const response = await api().get('/api/does-not-exist');
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/node_modules|at\s+\w+\s*\(|JWT_SECRET|DATABASE_URL/i);
  });

  test('reflected XSS payload is not returned as executable HTML', async () => {
    const payload = '<script>alert(1)</script>';
    const response = await api().get('/api/does-not-exist').query({ search: payload });
    expect(response.text || '').not.toContain(payload);
  });

  test('configured auth token is rejected or accepted without leaking credentials', async () => {
    if (!process.env.TEST_AUTH_TOKEN) return;
    const response = await api().get('/api/classes').set(authHeaders());
    expect([200, 401, 403]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toMatch(/password|token|secret/i);
  });
});
