process.env.AI_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
require('ts-node/register/transpile-only');
jest.mock('../../../src/lib/prisma', () => ({ __esModule: true, default: {} }));
const { encryptAiKey } = require('../../../src/lib/aiSecurity');
const { splitSpeechText, joinSpeechWav, synthesizeAiSpeech } = require('../../../src/services/aiSpeech.service');
function wav(samples = [100, -100], rate = 24000) {
  const header = Buffer.alloc(44), data = Buffer.alloc(samples.length * 2);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  return Buffer.concat([header, data]);
}
const providers = [1, 2].map(id => ({ id: `p${id}`, baseUrl: 'https://api.groq.com/openai/v1', encryptedKey: encryptAiKey(`synthetic-speech-key-${id}`) }));
test('speech chunks preserve Arabic, emoji and words within the upstream limit', () => {
  const text = 'أهلًا بالطالب، نراجع الدرس خطوة بخطوة. '.repeat(20).trim();
  const chunks = splitSpeechText(text);
  expect(chunks.length).toBeGreaterThan(1); expect(chunks.every(chunk => chunk.length <= 190)).toBe(true);
  expect(chunks.join(' ')).toBe(text);
  expect(splitSpeechText('😀'.repeat(150)).join('')).toBe('😀'.repeat(150));
});
test('WAV joining produces a single playable header and preserves all samples in order', () => {
  const joined = joinSpeechWav([wav([10, 20]), wav([30, 40])]);
  expect(joined.readUInt32LE(4)).toBe(joined.length - 8);
  expect(joined.readUInt32LE(40)).toBe(8);
  expect([0, 1, 2, 3].map(index => joined.readInt16LE(44 + index * 2))).toEqual([10, 20, 30, 40]);
  expect(() => joinSpeechWav([wav(), wav([1], 16000)])).toThrow('Inconsistent');
  expect(() => joinSpeechWav([wav().subarray(0, 43)])).toThrow();
  expect(() => joinSpeechWav([Buffer.from('upstream error')])).toThrow();
});
test('cloud speech rotates saved credentials and returns one complete file with no client credentials', async () => {
  const db = { aiProvider: { findMany: jest.fn(async () => providers) } };
  const transport = jest.fn(async () => ({ status: 200, data: wav() }));
  const output = await synthesizeAiSpeech('هذا درس قصير وسنراجعه معًا. '.repeat(12), 'ar-EG', true, new AbortController().signal, db, transport);
  expect(output.toString('ascii', 0, 4)).toBe('RIFF');
  expect(db.aiProvider.findMany.mock.calls[0][0].where).toEqual({ kind: 'GROQ', enabled: true, allowPublic: true });
  expect(transport.mock.calls[0][1]).toBe('synthetic-speech-key-1'); expect(transport.mock.calls[1][1]).toBe('synthetic-speech-key-2');
  expect(transport.mock.calls.every(call => call[2].input.length <= 190 && call[2].model === 'canopylabs/orpheus-arabic-saudi')).toBe(true);
  expect(output.includes(Buffer.from('synthetic'))).toBe(false);
});
test('speech fallback never exposes provider errors and names model terms as a required setup step', async () => {
  const db = { aiProvider: { findMany: jest.fn(async () => providers) } };
  const transport = jest.fn().mockResolvedValueOnce({ status: 429, data: Buffer.from('private upstream error') }).mockResolvedValueOnce({ status: 200, data: wav() });
  await expect(synthesizeAiSpeech('Hello student.', 'en-US', false, new AbortController().signal, db, transport)).resolves.toBeInstanceOf(Buffer);
  expect(transport.mock.calls[1][2].model).toBe('canopylabs/orpheus-v1-english');
  const terms = jest.fn(async () => ({ status: 400, data: Buffer.from(JSON.stringify({ error: { code: 'model_terms_required', message: 'private detail' } })) }));
  await expect(synthesizeAiSpeech('مرحبًا', 'ar-EG', false, new AbortController().signal, db, terms)).rejects.toMatchObject({ code: 'SPEECH_TERMS_REQUIRED', status: 503 });
});
test('long text, unsupported languages and cancellation do not start upstream synthesis', async () => {
  const db = { aiProvider: { findMany: jest.fn(async () => providers) } }, transport = jest.fn();
  const controller = new AbortController(); controller.abort();
  await expect(synthesizeAiSpeech('Hello.', 'en', false, controller.signal, db, transport)).rejects.toThrow();
  await expect(synthesizeAiSpeech('x'.repeat(1401), 'en', false, new AbortController().signal, db, transport)).rejects.toMatchObject({ code: 'SPEECH_TEXT_LENGTH' });
  await expect(synthesizeAiSpeech('Bonjour', 'fr', false, new AbortController().signal, db, transport)).rejects.toMatchObject({ code: 'SPEECH_LANGUAGE' });
  expect(transport).not.toHaveBeenCalled();
});
