process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
require('ts-node/register/transpile-only');
const { completeAi, testAiProvider, normalizeAiModels, retryAiConnection } = require('../../../src/services/aiRouting.service');
const { encryptAiKey } = require('../../../src/lib/aiSecurity');
const { aiMessageTokens } = require('../../../src/services/aiPromptBudget.service');

function database() {
  const providers = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, kind: 'GROQ', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', encryptedKey: encryptAiKey('synthetic-only') }));
  let index = 0;
  const update = jest.fn(async ({ where }) => providers.find(p => p.id === where.id));
  const tx = { $queryRaw: jest.fn(async () => index < providers.length ? [{ id: providers[index++].id }] : []), aiProvider: { update } };
  return { $transaction: fn => fn(tx), aiProvider: { update }, tx };
}
const reply = { status: 200, headers: {}, data: { choices: [{ message: { content: 'Recovered' } }] } };
const messages = [{ role: 'user', content: 'اشرح خطوتي الجاية' }];

test.each(['ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ETIMEDOUT'])('an interrupted %s connection is retried once before reporting failure', async code => {
  const operation = jest.fn().mockRejectedValueOnce(Object.assign(new Error('private transport details'), { code })).mockResolvedValueOnce(reply);
  await expect(retryAiConnection(operation)).resolves.toBe(reply);
  expect(operation).toHaveBeenCalledTimes(2);
});
test('retries are bounded and do not retry unsafe targets, quotas, credentials or generation timeouts', async () => {
  const interrupted = jest.fn(async () => { throw Object.assign(new Error('interrupted'), { code: 'ECONNRESET' }); });
  await expect(retryAiConnection(interrupted)).rejects.toMatchObject({ code: 'ECONNRESET' });
  expect(interrupted).toHaveBeenCalledTimes(2);
  for (const code of ['AI_PROVIDER_TIMEOUT', 'UNSAFE_TARGET', '401', '429']) {
    const operation = jest.fn(async () => { throw Object.assign(new Error('private'), { code }); });
    await expect(retryAiConnection(operation)).rejects.toMatchObject({ code });
    expect(operation).toHaveBeenCalledTimes(1);
  }
  const quota = jest.fn(async () => ({ status: 429 }));
  await expect(retryAiConnection(quota)).resolves.toEqual({ status: 429 }); expect(quota).toHaveBeenCalledTimes(1);
});
test('cancellation during retry delay prevents a second upstream request', async () => {
  const controller = new AbortController();
  const operation = jest.fn(async () => { setTimeout(() => controller.abort(), 15); throw Object.assign(new Error('private'), { code: 'ECONNRESET' }); });
  await expect(retryAiConnection(operation, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(operation).toHaveBeenCalledTimes(1);
});
test('a temporary upstream response can recover once, but a second failure remains genuine', async () => {
  const operation = jest.fn().mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce(reply);
  const transient = value => value.status === 503;
  await expect(retryAiConnection(operation, undefined, transient)).resolves.toBe(reply);
  expect(operation).toHaveBeenCalledTimes(2);
  const failed = jest.fn(async () => ({ status: 503 }));
  await expect(retryAiConnection(failed, undefined, transient)).resolves.toEqual({ status: 503 });
  expect(failed).toHaveBeenCalledTimes(2);
});
test('generation timeout is reported accurately and the overall deadline is shared across fallbacks', async () => {
  const db = database(), transport = jest.fn(async () => { throw Object.assign(new Error('private-timeout'), { code: 'AI_PROVIDER_TIMEOUT' }); });
  await expect(completeAi(messages, {}, db, transport)).rejects.toMatchObject({ status: 504, code: 'AI_PROVIDER_TIMEOUT' });
  expect(transport.mock.calls.every(call => call[3] instanceof AbortSignal)).toBe(true);
  expect(new Set(transport.mock.calls.map(call => call[3])).size).toBe(1);
  expect(db.aiProvider.update.mock.calls.at(-1)[0].data.lastStatus).toBe(504);
});
test('an existing short cooldown returns retry timing without calling the upstream', async () => {
  const transport = jest.fn(), update = jest.fn(), expires = new Date(Date.now() + 15000);
  const db = { $transaction: fn => fn({ $queryRaw: async () => [] }), aiProvider: { update, findMany: async () => [{ lastStatus: 502, cooldownUntil: expires }] } };
  await expect(completeAi(messages, {}, db, transport)).rejects.toMatchObject({ status: 503, code: 'AI_PROVIDER_COOLDOWN', retryAfterSeconds: expect.any(Number) });
  expect(transport).not.toHaveBeenCalled();
});

test('provider-specific input builder is used and no output token allowance is added', async () => {
  const db = database(), buildMessages = jest.fn(() => messages), transport = jest.fn(async () => reply);
  await completeAi(messages, { buildMessages }, db, transport);
  expect(buildMessages).toHaveBeenCalledWith(5500);
  expect(transport.mock.calls[0][2]).not.toHaveProperty('max_tokens');
  expect(transport.mock.calls[0][2]).not.toHaveProperty('max_completion_tokens');
  expect(aiMessageTokens(transport.mock.calls[0][2].messages)).toBeLessThanOrEqual(5500);
});

test('413 retries a smaller input once with the same credential, preserving provider health', async () => {
  const db = database(), buildMessages = jest.fn(() => messages), transport = jest.fn().mockResolvedValueOnce({ status: 413, headers: {}, data: {} }).mockResolvedValueOnce(reply);
  const result = await completeAi(messages, { buildMessages }, db, transport);
  expect(result.content).toBe('Recovered'); expect(db.tx.$queryRaw).toHaveBeenCalledTimes(1);
  expect(buildMessages.mock.calls.map(call => call[0])).toEqual([5500, 3960]);
  expect(transport.mock.calls[0][1]).toBe(transport.mock.calls[1][1]);
  expect(db.aiProvider.update.mock.calls.at(-1)[0].data).toMatchObject({ lastStatus: 200, cooldownUntil: null });
});

test('persistent 413 reports input size without cooling every key or misreporting quota exhaustion', async () => {
  const db = database(), transport = jest.fn(async () => ({ status: 413, headers: {}, data: {} }));
  await expect(completeAi(messages, { buildMessages: () => messages }, db, transport)).rejects.toMatchObject({ status: 413, code: 'AI_INPUT_TOO_LARGE' });
  expect(transport).toHaveBeenCalledTimes(2); expect(db.tx.$queryRaw).toHaveBeenCalledTimes(1);
  expect(db.aiProvider.update.mock.calls.at(-1)[0].data).toMatchObject({ lastStatus: 413, cooldownUntil: null });
});

test('429 retains provider retry timing and authentication errors do not log out the student', async () => {
  await expect(completeAi(messages, {}, database(), async () => ({ status: 429, headers: { 'retry-after': '17' }, data: {} }))).rejects.toMatchObject({ status: 429, code: 'AI_PROVIDER_RATE_LIMIT', retryAfterSeconds: 17 });
  await expect(completeAi(messages, {}, database(), async () => ({ status: 401, headers: {}, data: { error: 'never-return-credential-details' } }))).rejects.toMatchObject({ status: 503, code: 'AI_PROVIDER_AUTH_FAILED' });
});

const probeProvider = () => ({ id: 'selected-only', kind: 'GROQ', model: 'openai/gpt-oss-120b', baseUrl: 'https://api.groq.com/openai/v1', encryptedKey: encryptAiKey('synthetic-probe-key'), enabled: false });
test('admin probe tests exactly the saved model and credential, without enabling routing or sending student context', async () => {
  const update = jest.fn(async () => ({})), transport = jest.fn(async () => ({ ...reply, data: { choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 24, completion_tokens: 1, arbitrary: 'secret-details' } } }));
  const result = await testAiProvider(probeProvider(), { aiProvider: { update } }, transport);
  expect(result).toMatchObject({ ok: true, status: 200, reply: 'OK', model: 'openai/gpt-oss-120b', attempted: true, usage: { prompt_tokens: 24, completion_tokens: 1 } });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][1]).toBe('synthetic-probe-key');
  expect(transport.mock.calls[0][2].messages).toHaveLength(2);
  expect(update.mock.calls[0][0].data).not.toHaveProperty('enabled');
  expect(JSON.stringify(result)).not.toMatch(/synthetic-probe-key|secret-details|encryptedKey/);
});
test('admin probe respects an active cooldown without consuming another request', async () => {
  const update = jest.fn(), transport = jest.fn();
  const result = await testAiProvider({ ...probeProvider(), lastStatus: 429, cooldownUntil: new Date(Date.now() + 60000) }, { aiProvider: { update } }, transport);
  expect(result).toMatchObject({ ok: false, code: 'AI_PROVIDER_COOLDOWN', attempted: false });
  expect(transport).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
});
test.each([401, 429, 404, 502, 503])('probe returns a real safe failure for status %s, without fallback or raw upstream errors', async status => {
  const update = jest.fn(async () => ({})), transport = jest.fn(async () => ({ status, headers: { 'retry-after': '45' }, data: { error: 'private-upstream-secret' } }));
  const result = await testAiProvider(probeProvider(), { aiProvider: { update } }, transport);
  expect(result).toMatchObject({ ok: false, status, attempted: true });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][0].data).toMatchObject({ lastStatus: status, failureCount: { increment: 1 } });
  expect(JSON.stringify(result)).not.toContain('private-upstream-secret');
  if (status === 429) expect(result.retryAfterSeconds).toBe(45);
});

test('Gemini catalog IDs become Chat Completions model IDs without changing other provider namespaces', () => {
  const catalog = { data: [{ id: 'models/gemini-model' }] };
  expect(normalizeAiModels(catalog, 'GEMINI')[0].id).toBe('gemini-model');
  expect(normalizeAiModels(catalog, 'OPENROUTER')[0].id).toBe('models/gemini-model');
});
