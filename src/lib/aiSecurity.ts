import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';

export class AiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterSeconds?: number) { super(message); }
}
export function aiProviderAudience(input: any, current = { allowStudent: true, allowPublic: false }) {
  const audience = { ...current };
  for (const key of ['allowStudent', 'allowPublic'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new AiError(400, 'AI_INVALID_AUDIENCE', 'اختر مكان استخدام الاتصال بقيمة صحيحة.');
      audience[key] = input[key];
    }
  }
  if (!audience.allowStudent && !audience.allowPublic) throw new AiError(400, 'AI_INVALID_AUDIENCE', 'حدد الرئيسية أو الطالب أو كليهما لهذا الاتصال.');
  return audience;
}
function encryptionKey(): Buffer {
  const value = process.env.AI_ENCRYPTION_KEY || '';
  const key = /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) throw new AiError(503, 'AI_KEY_NOT_CONFIGURED', 'يجب إعداد AI_ENCRYPTION_KEY على الخادم أولًا.');
  return key;
}
export function encryptAiKey(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
export function aiEncryptionConfigured(): boolean {
  try { encryptionKey(); return true; } catch { return false; }
}
export function decryptAiKey(value: string): string {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted credential');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
export const aiKeyFingerprint = (key: string) => crypto.createHmac('sha256', encryptionKey()).update(key).digest('hex');

export function isPrivateAiAddress(ip: string): boolean {
  if (net.isIP(ip) === 6) return !/^2[0-9a-f]{3}:/i.test(ip) && !/^3[0-9a-f]{3}:/i.test(ip);
  if (net.isIP(ip) !== 4) return true;
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}
export async function validateAiBaseUrl(input: unknown): Promise<string> {
  let url: URL;
  try { url = new URL(String(input)); } catch { throw new AiError(400, 'INVALID_AI_URL', 'رابط API غير صحيح.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) {
    throw new AiError(400, 'INVALID_AI_URL', 'استخدم رابط HTTPS عامًا بدون بيانات دخول أو معاملات.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => isPrivateAiAddress(item.address))) {
    throw new AiError(400, 'PRIVATE_AI_URL', 'لا يمكن استخدام عناوين الشبكة الداخلية كمزوّد AI.');
  }
  return url.toString().replace(/\/$/, '');
}

export const AI_PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  GROQ: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  OPENROUTER: { baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  GEMINI: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '' },
  OPENAI: { baseUrl: 'https://api.openai.com/v1', model: '' },
  CUSTOM: { baseUrl: '', model: '' },
};
