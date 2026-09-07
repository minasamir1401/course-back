const request = require('supertest');
const http = require('http');
const https = require('https');

const apiUrl = process.env.API_URL || process.env.BACKEND_URL || 'http://localhost:5000';
// Offline runs must report skipped live coverage. CI can explicitly require it.
const liveTestsEnabled = process.env.REQUIRE_LIVE_TESTS === '1';
function api() { return request(apiUrl); }
function authHeaders() {
  const token = process.env.TEST_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function probeServer(baseUrl = apiUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL('/api/health', baseUrl);
      const transport = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
      if (!transport) return resolve(false);
      const req = transport.request(url, { method: 'GET', timeout: 1500 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch { resolve(false); }
  });
}
async function requireLiveServer(baseUrl = apiUrl) {
  if (!(await probeServer(baseUrl))) throw new Error('Required live backend is unavailable or its health check failed');
}
function requireLiveConfig(names) {
  const missing = names.filter(name => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Required live test fixtures are missing: ${missing.join(', ')}`);
}
module.exports = { api, apiUrl, authHeaders, liveTestsEnabled, probeServer, checkServer: probeServer, requireLiveServer, requireLiveConfig };
