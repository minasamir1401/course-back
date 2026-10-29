require('ts-node/register/transpile-only');
const https = require('https');
const { EventEmitter } = require('events');
const { requestAiJson } = require('../../../src/services/aiRouting.service');

function upstream(delay) {
  return jest.spyOn(https, 'request').mockImplementation((_url, options, callback) => {
    const req = new EventEmitter();
    let responseTimer;
    const cancel = () => req.destroy(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    req.end = () => { responseTimer = setTimeout(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.headers = {};
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ choices: [{ message: { content: 'Generated questions' } }] })));
      response.emit('end'); req.emit('close');
    }, delay); };
    req.destroy = error => { clearTimeout(responseTimer); req.emit('error', error); req.emit('close'); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    req.on('close', () => options.signal?.removeEventListener('abort', cancel));
    return req;
  });
}
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('a valid generation taking 40 seconds survives the former 30-second cutoff', async () => {
  jest.useFakeTimers(); const request = upstream(40000);
  const pending = expect(requestAiJson('https://provider.example/v1', 'synthetic-only', { messages: [] })).resolves.toMatchObject({ status: 200, data: { choices: [{ message: { content: 'Generated questions' } }] } });
  await jest.advanceTimersByTimeAsync(40000); await pending;
  expect(request).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('an overlong generation stops at 60 seconds, is classified correctly, and is not duplicated', async () => {
  jest.useFakeTimers(); const request = upstream(75000);
  const pending = expect(requestAiJson('https://provider.example/v1', 'synthetic-only', { messages: [] })).rejects.toMatchObject({ code: 'AI_PROVIDER_TIMEOUT' });
  await jest.advanceTimersByTimeAsync(60000); await pending;
  expect(request).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('an aborted parent request stops the pending generation and clears its deadline', async () => {
  jest.useFakeTimers(); const request = upstream(40000), controller = new AbortController();
  const pending = expect(requestAiJson('https://provider.example/v1', 'synthetic-only', { messages: [] }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await pending;
  expect(request).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
