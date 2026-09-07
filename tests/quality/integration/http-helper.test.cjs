const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { probeServer, requireLiveServer } = require('../helpers/http.cjs');

function response(statusCode) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.resume = jest.fn();
  return res;
}
afterEach(() => jest.restoreAllMocks());

test('health probe uses HTTPS transport for HTTPS targets and drains responses', async () => {
  const res = response(200);
  const request = new EventEmitter();
  request.end = jest.fn(() => callback(res));
  let callback;
  jest.spyOn(https, 'request').mockImplementation((_url, _options, cb) => { callback = cb; return request; });
  expect(await probeServer('https://example.invalid')).toBe(true);
  expect(https.request).toHaveBeenCalled();
  expect(res.resume).toHaveBeenCalled();
});

test('required live backend being unavailable fails instead of reporting success', async () => {
  const request = new EventEmitter();
  request.end = () => request.emit('error', new Error('offline'));
  jest.spyOn(http, 'request').mockReturnValue(request);
  await expect(requireLiveServer('http://example.invalid')).rejects.toThrow(/unavailable/);
});

test('nonhealthy backend is explicitly unavailable', async () => {
  const request = new EventEmitter();
  let callback;
  request.end = () => callback(response(503));
  jest.spyOn(http, 'request').mockImplementation((_url, _options, cb) => { callback = cb; return request; });
  expect(await probeServer('http://example.invalid')).toBe(false);
});
