import prisma from '../lib/prisma';
import { AiError, decryptAiKey } from '../lib/aiSecurity';
import { requestAiSpeech } from './aiRouting.service';

export function splitSpeechText(text: string, limit = 190): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean), chunks: string[] = [];
  let current = '';
  for (let word of words) {
    while (word.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      // Keep surrogate pairs intact, even for an unusually long token.
      let cut = limit;
      if (/[\uD800-\uDBFF]/u.test(word[cut - 1])) cut--;
      chunks.push(word.slice(0, cut)); word = word.slice(cut);
    }
    if (current.length + word.length + 1 > limit) { chunks.push(current); current = ''; }
    current += `${current ? ' ' : ''}${word}`;
    if (/[.!?؟؛]$/u.test(word) && current.length > limit / 2) { chunks.push(current); current = ''; }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Join complete PCM WAV data, preserving the format instead of concatenating file headers.
export function joinSpeechWav(files: Buffer[]): Buffer {
  let format: Buffer | undefined;
  const audio: Buffer[] = [];
  for (const file of files) {
    if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid speech format');
    let foundFormat: Buffer | undefined, foundAudio: Buffer | undefined;
    for (let offset = 12; offset + 8 <= file.length;) {
      const length = file.readUInt32LE(offset + 4), end = offset + 8 + length;
      if (end > file.length) throw new Error('Incomplete speech file');
      const name = file.toString('ascii', offset, offset + 4);
      if (name === 'fmt ') foundFormat = file.subarray(offset + 8, end);
      if (name === 'data') foundAudio = file.subarray(offset + 8, end);
      offset = end + (length % 2);
    }
    if (!foundFormat || foundFormat.length < 16 || foundFormat.readUInt16LE(0) !== 1 || !foundAudio?.length) throw new Error('Unsupported speech file');
    const alignment = foundFormat.readUInt16LE(12);
    if (!alignment || foundAudio.length % alignment) throw new Error('Misaligned speech samples');
    if (format && !format.equals(foundFormat)) throw new Error('Inconsistent speech formats');
    format = foundFormat; audio.push(foundAudio);
  }
  if (!format) throw new Error('Empty speech');
  const data = Buffer.concat(audio);
  if (data.length > 24 * 1024 * 1024) throw new Error('Speech too large');
  const fmt = Buffer.alloc(8 + format.length + format.length % 2);
  fmt.write('fmt '); fmt.writeUInt32LE(format.length, 4); format.copy(fmt, 8);
  const header = Buffer.alloc(12); header.write('RIFF'); header.writeUInt32LE(4 + fmt.length + 8 + data.length + data.length % 2, 4); header.write('WAVE', 8);
  const dataHeader = Buffer.alloc(8); dataHeader.write('data'); dataHeader.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, fmt, dataHeader, data, Buffer.alloc(data.length % 2)]);
}

export async function synthesizeAiSpeech(text: string, language: string, publicRequest: boolean, signal: AbortSignal,
  db: any = prisma, transport = requestAiSpeech): Promise<Buffer> {
  const arabic = language.split('-')[0] === 'ar';
  if (!arabic && language.split('-')[0] !== 'en') throw new AiError(400, 'SPEECH_LANGUAGE', 'الصوت الاحترافي متاح للعربية والإنجليزية. استخدم صوت الجهاز للغات الأخرى.');
  // The free speech quota is small; do not spend many requests on a long reply.
  if (!text.trim() || text.length > 1400) throw new AiError(413, 'SPEECH_TEXT_LENGTH', 'الرد طويل للقراءة السحابية المجانية. استخدم صوت الجهاز لقراءته كاملًا.');
  const providers = await db.aiProvider.findMany({ where: { kind: 'GROQ', enabled: true, ...(publicRequest ? { allowPublic: true } : { allowStudent: true }) }, orderBy: [{ lastAssignedAt: 'asc' }, { id: 'asc' }], take: 3 });
  if (!providers.length) throw new AiError(503, 'SPEECH_UNAVAILABLE', 'لا يوجد اتصال Groq متاح للصوت الاحترافي.');
  const chunks = splitSpeechText(text), files: Buffer[] = [];
  let bytes = 0;
  for (let index = 0; index < chunks.length; index++) {
    signal.throwIfAborted();
    let file: Buffer | undefined;
    let termsRequired = false;
    for (let attempt = 0; attempt < providers.length; attempt++) {
      const provider = providers[(index + attempt) % providers.length];
      try {
        const result = await transport(provider.baseUrl, decryptAiKey(provider.encryptedKey), {
          model: arabic ? 'canopylabs/orpheus-arabic-saudi' : 'canopylabs/orpheus-v1-english',
          voice: arabic ? 'lulwa' : 'hannah', input: chunks[index], response_format: 'wav',
        }, signal);
        if (result.status >= 200 && result.status < 300 && Buffer.isBuffer(result.data) && result.data.subarray(0, 4).toString() === 'RIFF') { file = result.data; break; }
        if (result.status === 400 && Buffer.isBuffer(result.data)) {
          try { if (JSON.parse(result.data.toString('utf8'))?.error?.code === 'model_terms_required') termsRequired = true; } catch {}
        }
      } catch { signal.throwIfAborted(); }
    }
    if (!file && termsRequired) throw new AiError(503, 'SPEECH_TERMS_REQUIRED', 'يلزم مسؤول حساب Groq قبول شروط نموذج الصوت من لوحة Groq أولًا.');
    if (!file) throw new AiError(503, 'SPEECH_UNAVAILABLE', 'خدمة الصوت الاحترافي غير متاحة أو حصتها انتهت مؤقتًا. يمكنك استخدام صوت الجهاز.');
    bytes += file.length;
    if (bytes > 24 * 1024 * 1024) throw new AiError(413, 'SPEECH_TOO_LARGE', 'الصوت طويل. استخدم صوت الجهاز لهذا الرد.');
    files.push(file);
  }
  return joinSpeechWav(files);
}
