const request = require('supertest');

const apiUrl = process.env.API_URL || 'http://localhost:5000';

function api() {
  return request(apiUrl);
}

function authHeaders() {
  const token = process.env.TEST_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

module.exports = { api, apiUrl, authHeaders };
