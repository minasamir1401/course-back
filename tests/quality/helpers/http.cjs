const request = require('supertest');
const http = require('http');

const apiUrl = process.env.API_URL || process.env.BACKEND_URL || 'http://localhost:5000';

function api() {
  return request(apiUrl);
}

function authHeaders() {
  const token = process.env.TEST_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let serverChecked = false;
let serverOnline = false;

async function checkServer() {
  if (serverChecked) return serverOnline;
  serverChecked = true;
  return new Promise((resolve) => {
    try {
      const url = new URL(apiUrl);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: '/api/health',
          method: 'GET',
          timeout: 1500,
        },
        (res) => {
          serverOnline = res.statusCode === 200;
          resolve(serverOnline);
        }
      );
      req.on('error', () => {
        serverOnline = false;
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        serverOnline = false;
        resolve(false);
      });
      req.end();
    } catch {
      serverOnline = false;
      resolve(false);
    }
  });
}

module.exports = { api, apiUrl, authHeaders, checkServer };
