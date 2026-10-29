import https from 'https';
import dns from 'dns';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AiError, decryptAiKey, isPrivateAiAddress } from '../lib/aiSecurity';
import { fitSimpleAiMessages } from './aiPromptBudget.service';

export type AiChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type AiCompletion = { content: string; model: string; providerId: string; usage: any };

/** DNS is checked at socket connection time, not just when an admin saves a URL.
 * Redirects are never followed and upstream error bodies/credentials never leave the server.
 */
function requestAiEndpoint(baseUrl: string, key: string, endpoint: 'models' | 'chat/completions' | 'audio/speech', body?: object, signal?: AbortSignal): Promise<{ status: number; headers: any; data: any }> {
  return new Promise((resolve, reject) => {
    const timeoutMs = endpoint === 'chat/completions' ? 60_000 : 30_000;
    const timeoutError = () => Object.assign(new Error('Provider deadline exceeded'), { code: 'AI_PROVIDER_TIMEOUT' });
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/${endpoint}`);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(url, {
      method: body === undefined ? 'GET' : 'POST', timeout: timeoutMs, signal,
      headers: { Authorization: `Bearer ${key}`, Accept: endpoint === 'audio/speech' ? 'audio/wav' : 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
      lookup: ((host: string, _options: any, callback: any) => dns.lookup(host, { all: true }, (error, addresses) => {
        if (error) { callback(error); return; }
        if (!addresses.length || addresses.some(item => isPrivateAiAddress(item.address))) {
          callback(new Error('Unsafe provider address')); return;
        }
        // Node may request all addresses for autoSelectFamily.
        if (_options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      })) as any,
    }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) { req.destroy(new Error('Provider response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        let data: any;
        const buffer = Buffer.concat(chunks);
        if (endpoint === 'audio/speech') data = buffer;
        else { try { data = JSON.parse(buffer.toString('utf8')); } catch { data = {}; } }
        resolve({ status: response.statusCode || 502, headers: response.headers, data });
      });
    });
    const deadline = setTimeout(() => req.destroy(timeoutError()), timeoutMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('timeout', () => req.destroy(timeoutError()));
    req.on('error', reject); req.end(payload);
  });
}

export async function retryAiConnection<T>(operation: () => Promise<T>, signal?: AbortSignal, transientResult: (value: T) => boolean = () => false): Promise<T> {
  try { const result = await operation(); if (!transientResult(result)) return result; }
  catch (error: any) {
    // Retry interrupted connections once. HTTP quotas, rejected credentials,
    // unsafe DNS targets and long generations must not trigger duplicate requests.
    if (signal?.aborted || !['ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ETIMEDOUT', 'ENETUNREACH', 'ECONNREFUSED'].includes(error?.code)) throw error;
  }
  await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(Object.assign(new Error('Request cancelled'), { name: 'AbortError' })); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, 350);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { signal.removeEventListener('abort', cancel); cancel(); }
  });
  signal?.throwIfAborted();
  return operation();
}
export const requestAiJson = (baseUrl: string, key: string, body: object, signal?: AbortSignal) => retryAiConnection(
  () => requestAiEndpoint(baseUrl, key, 'chat/completions', body, signal), signal,
  result => [500, 502, 503, 504].includes(result.status) && !result.headers?.['retry-after'],
);
export const requestAiModels = (baseUrl: string, key: string) => requestAiEndpoint(baseUrl, key, 'models');
export const requestAiSpeech = (baseUrl: string, key: string, body: object, signal?: AbortSignal) => requestAiEndpoint(baseUrl, key, 'audio/speech', body, signal);

export function normalizeAiModels(data: any, kind = '') {
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  const unique = new Map<string, any>();
  for (const item of rows.slice(0, 5000)) {
    const rawId = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name.replace(/^models\//, '') : '';
    const id = kind === 'GEMINI' ? rawId.replace(/^models\//, '') : rawId;
    if (!id || id.length > 200 || item.active === false) continue;
    const pricing = item.pricing;
    unique.set(id, { id, name: typeof item.name === 'string' ? item.name.slice(0, 240) : id,
      owner: typeof item.owned_by === 'string' ? item.owned_by.slice(0, 120) : null,
      contextWindow: Number(item.context_length || item.context_window || item.inputTokenLimit) || null,
      free: pricing?.prompt != null && pricing?.completion != null ? Number(pricing.prompt) === 0 && Number(pricing.completion) === 0 : id.endsWith(':free') ? true : null,
    });
  }
  return Array.from(unique.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export async function claimAiProvider(db: any, excluded: string[], publicRequest: boolean) {
  // Prisma DateTime columns store UTC without a zone. NOW() alone casts them
  // through PostgreSQL's session zone and can stretch a 30-second cooldown for hours.
  return db.$transaction(async (tx: any) => {
    const rows = await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "AiProvider"
      WHERE "enabled" = true AND ("cooldownUntil" IS NULL OR "cooldownUntil" <= (NOW() AT TIME ZONE 'UTC'))
      ${publicRequest ? Prisma.sql`AND "allowPublic" = true` : Prisma.sql`AND "allowStudent" = true`}
      ${excluded.length ? Prisma.sql`AND "id" NOT IN (${Prisma.join(excluded)})` : Prisma.empty}
      ORDER BY "lastAssignedAt" ASC, "id" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    if (!rows[0]) return null;
    return tx.aiProvider.update({ where: { id: rows[0].id }, data: {
      lastAssignedAt: new Date(), requestCount: { increment: 1 },
    } });
  });
}

export async function completeAi(messages: AiChatMessage[], options: { publicRequest?: boolean; buildMessages?: (maxTokens: number) => AiChatMessage[] } = {}, db: any = prisma, transport = requestAiJson): Promise<AiCompletion> {
  // A bounded budget covers retries and fallback together, below the web proxy's 120s limit.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 90_000);
  try {
  const tried: string[] = [];
  const failures: number[] = []; let waitSeconds = 0;
  // Several independent calls reserve different credentials transactionally, across PM2 workers.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (controller.signal.aborted) break;
    const provider = await claimAiProvider(db, tried, !!options.publicRequest);
    if (!provider) break;
    tried.push(provider.id);
    let status = 502, retryAfter = 30;
    const budget = provider.kind === 'GROQ' && provider.model.startsWith('openai/gpt-oss-') ? 5500 : 14000;
    // Size is an input constraint, never an output allowance. Structured builders
    // preserve calculated student facts while selecting relevant detail.
    const requestMessages = options.buildMessages ? options.buildMessages(budget) : fitSimpleAiMessages(messages, budget);
    try {
      const model = provider.model;
      const key = decryptAiKey(provider.encryptedKey);
      const body = (context: AiChatMessage[]) => ({
        model, messages: context, stream: false,
        ...(provider.kind === 'GROQ' && model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'medium', include_reasoning: false } : {}),
        // No application-imposed output token allowance per student.
      });
      let result = await transport(provider.baseUrl, key, body(requestMessages), controller.signal);
      // 413 belongs to this payload, not the credential. Retry once with a
      // smaller structured excerpt instead of sending it to every saved key.
      if (result.status === 413 && options.buildMessages && !controller.signal.aborted) result = await transport(provider.baseUrl, key, body(options.buildMessages(Math.min(4000, Math.floor(budget * .72)))), controller.signal);
      status = result.status;
      const content = result.data?.choices?.[0]?.message?.content;
      if (status >= 200 && status < 300 && typeof content === 'string' && content.trim()) {
        await db.aiProvider.update({ where: { id: provider.id }, data: { lastStatus: status, cooldownUntil: null } });
        return { content: content.trim(), model, providerId: provider.id, usage: result.data.usage || null };
      }
      const header = result.headers?.['retry-after'];
      retryAfter = Math.min(86400, Math.max(10, Number(header) || (Date.parse(header) - Date.now()) / 1000 || 30));
    } catch (error: any) {
      if (error instanceof AiError && error.code === 'AI_INPUT_TOO_LARGE') throw error;
      if (error?.code === 'AI_PROVIDER_TIMEOUT' || controller.signal.aborted) { status = 504; retryAfter = 10; }
      // Provider failures never include raw prompts or credentials in logs.
    }
    failures.push(status); waitSeconds = Math.max(waitSeconds, Math.ceil(retryAfter));
    await db.aiProvider.update({ where: { id: provider.id }, data: {
      failureCount: { increment: 1 }, lastStatus: status,
      cooldownUntil: status === 413 ? null : new Date(Date.now() + (status === 401 || status === 403 ? 3600 : retryAfter) * 1000),
    } });
    if (status === 413) throw new AiError(413, 'AI_INPUT_TOO_LARGE', 'السياق أكبر من حد المزوّد الحالي. جرّب سؤالًا أكثر تحديدًا أو افتح محادثة جديدة.');
  }
  if (failures.length && failures.every(status => status === 429)) throw new AiError(429, 'AI_PROVIDER_RATE_LIMIT', 'وصل اتصال الذكاء الاصطناعي لحد الاستخدام المؤقت. انتظر قليلًا ثم أعد المحاولة.', waitSeconds);
  if (controller.signal.aborted || (failures.length && failures.every(status => status === 504))) throw new AiError(504, 'AI_PROVIDER_TIMEOUT', 'استغرق تجهيز الرد وقتًا أطول من المهلة المتاحة. أعد المحاولة بعد قليل.', waitSeconds || 10);
  if (failures.length && failures.every(status => status === 401 || status === 403)) throw new AiError(503, 'AI_PROVIDER_AUTH_FAILED', 'اتصال المساعد غير متاح حاليًا. تحتاج الإدارة إلى مراجعة إعدادات المزوّد.');
  if (!failures.length && typeof db.aiProvider.findMany === 'function') {
    const cooling = await db.aiProvider.findMany({ where: { enabled: true, ...(options.publicRequest ? { allowPublic: true } : { allowStudent: true }), cooldownUntil: { gt: new Date() } },
      take: 10, orderBy: { cooldownUntil: 'asc' }, select: { lastStatus: true, cooldownUntil: true } });
    if (cooling.length && cooling.every((row: any) => row.lastStatus === 429)) {
      const retry = Math.max(1, Math.ceil((new Date(cooling[0].cooldownUntil).getTime() - Date.now()) / 1000));
      throw new AiError(429, 'AI_PROVIDER_RATE_LIMIT', 'وصل اتصال الذكاء الاصطناعي لحد الاستخدام المؤقت. انتظر قليلًا ثم أعد المحاولة.', retry);
    }
    if (cooling.length) {
      const retry = Math.max(1, Math.ceil((new Date(cooling[0].cooldownUntil).getTime() - Date.now()) / 1000));
      if (cooling.every((row: any) => row.lastStatus === 401 || row.lastStatus === 403)) throw new AiError(503, 'AI_PROVIDER_AUTH_FAILED', 'اتصال المساعد غير متاح حاليًا. تحتاج الإدارة إلى مراجعة إعدادات المزوّد.');
      throw new AiError(503, 'AI_PROVIDER_COOLDOWN', `الاتصال بالمساعد في انتظار قصير بعد تعثّر مؤقت. أعد المحاولة بعد ${retry} ثانية.`, retry);
    }
  }
  throw new AiError(503, 'AI_UNAVAILABLE', 'اتصالات الذكاء الاصطناعي المتاحة لا تستجيب حاليًا. حاول مرة أخرى بعد قليل.');
  } finally { clearTimeout(deadline); }
}

/** An admin probe uses exactly this connection, without fallback or student data. */
export async function testAiProvider(provider: any, db: any = prisma, transport = requestAiJson) {
  const checkedAt = new Date().toISOString();
  const remaining = provider.cooldownUntil ? Math.ceil((new Date(provider.cooldownUntil).getTime() - Date.now()) / 1000) : 0;
  if (remaining > 0) return { ok: false, status: provider.lastStatus || 429, code: 'AI_PROVIDER_COOLDOWN', checkedAt,
    retryAfterSeconds: remaining, message: 'الاتصال في فترة انتظار. أعد الاختبار بعد انتهاء المدة الظاهرة.', attempted: false };
  const start = Date.now();
  let status = 502, reply = '', usage: any = null, retryAfterSeconds = 30;
  try {
    const result = await transport(provider.baseUrl, decryptAiKey(provider.encryptedKey), {
      model: provider.model, stream: false,
      messages: [{ role: 'system', content: 'This is a connection test. Reply with OK only.' }, { role: 'user', content: 'OK?' }],
      ...(provider.kind === 'GROQ' && provider.model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
    });
    status = result.status;
    const content = result.data?.choices?.[0]?.message?.content;
    if (status >= 200 && status < 300 && typeof content === 'string' && content.trim()) {
      reply = content.trim().slice(0, 300);
      usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens'].filter(key => Number.isFinite(result.data?.usage?.[key])).map(key => [key, result.data.usage[key]]));
    } else if (status >= 200 && status < 300) status = 502;
    const header = result.headers?.['retry-after'];
    retryAfterSeconds = Math.ceil(Math.min(86400, Math.max(1, Number(header) || (Date.parse(header) - Date.now()) / 1000 || 30)));
  } catch { /* Never expose transport errors, credentials, or upstream bodies. */ }
  const ok = !!reply;
  await db.aiProvider.update({ where: { id: provider.id }, data: {
    requestCount: { increment: 1 }, lastStatus: status,
    ...(ok ? {} : { failureCount: { increment: 1 } }),
    cooldownUntil: ok || status === 413 ? null : new Date(Date.now() + (status === 401 || status === 403 ? 3600 : retryAfterSeconds) * 1000),
  } });
  const code = ok ? 'AI_PROVIDER_OK' : status === 401 || status === 403 ? 'AI_PROVIDER_AUTH_FAILED' : status === 429 ? 'AI_PROVIDER_RATE_LIMIT' : status === 400 || status === 404 ? 'AI_PROVIDER_MODEL_UNAVAILABLE' : status === 413 ? 'AI_INPUT_TOO_LARGE' : status === 503 ? 'AI_PROVIDER_UNAVAILABLE' : 'AI_PROVIDER_TEST_FAILED';
  const message = ok ? 'استجاب النموذج لهذا الاتصال بنجاح.' : status === 401 || status === 403 ? 'المزوّد رفض المفتاح أو صلاحية الوصول. راجع إعدادات حساب المزوّد.' : status === 429 ? 'وصل الاتصال لحد المزوّد المؤقت. انتظر ثم أعد الاختبار.' : status === 400 || status === 404 ? 'المزوّد لم يقبل الطلب لهذا النموذج. أعد جلب النماذج وراجع صلاحية النموذج لحسابك.' : status === 413 ? 'المزوّد رفض حجم طلب الاختبار.' : status === 503 ? 'أعاد المزوّد HTTP 503: الخدمة غير متاحة مؤقتًا لهذا الطلب. سيُجرَّب اتصال آخر في الشات عند توفره.' : 'لم يصل رد صالح من النموذج. راجع رابط API أو حاول لاحقًا.';
  return { ok, status, code, message, checkedAt, latencyMs: Date.now() - start, model: provider.model, attempted: true,
    ...(ok ? { reply, usage } : status === 429 ? { retryAfterSeconds } : {}) };
}
