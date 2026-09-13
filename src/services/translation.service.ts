let arEnPipeline: any = null;
let enArPipeline: any = null;
let arEnPromise: Promise<any> | null = null;
let enArPromise: Promise<any> | null = null;

const translationCache = new Map<string, string>();
const MAX_CACHE_SIZE = 5000;

function getCacheKey(text: string, from: string, to: string): string {
  return `${from}:${to}:${text.trim()}`;
}

function setCache(key: string, value: string): void {
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const firstKey = translationCache.keys().next().value;
    if (firstKey) translationCache.delete(firstKey);
  }
  translationCache.set(key, value);
}

async function getOfflinePipeline(from: 'ar' | 'en', to: 'ar' | 'en') {
  const { pipeline } = await import('@xenova/transformers');
  
  if (from === 'ar' && to === 'en') {
    if (!arEnPipeline) {
      if (!arEnPromise) {
        arEnPromise = pipeline('translation', 'Xenova/opus-mt-ar-en', { quantized: true });
      }
      arEnPipeline = await arEnPromise;
    }
    return arEnPipeline;
  } else {
    if (!enArPipeline) {
      if (!enArPromise) {
        enArPromise = pipeline('translation', 'Xenova/opus-mt-en-ar', { quantized: true });
      }
      enArPipeline = await enArPromise;
    }
    return enArPipeline;
  }
}

function maskSpecialContent(text: string): { maskedText: string; tokens: string[] } {
  const tokens: string[] = [];
  
  let masked = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, (match) => {
    const placeholder = ` __MATH_${tokens.length}__ `;
    tokens.push(match);
    return placeholder;
  });

  masked = masked.replace(/<[^>]+>/g, (match) => {
    const placeholder = ` __HTML_${tokens.length}__ `;
    tokens.push(match);
    return placeholder;
  });

  return { maskedText: masked, tokens };
}

function restoreSpecialContent(text: string, tokens: string[]): string {
  let restored = text;
  tokens.forEach((original, index) => {
    const mathRegex = new RegExp(`\\s*__MATH_${index}__\\s*`, 'gi');
    const htmlRegex = new RegExp(`\\s*__HTML_${index}__\\s*`, 'gi');
    restored = restored.replace(mathRegex, original).replace(htmlRegex, original);
  });
  return restored;
}

async function translateViaFastEngine(text: string, from: 'ar' | 'en', to: 'ar' | 'en'): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(4000)
    });

    if (!response.ok) return null;
    const data: any = await response.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;

    const translatedParts = data[0].map((item: any) => item?.[0] || '').filter(Boolean);
    return translatedParts.join('') || null;
  } catch {
    return null;
  }
}

export async function translateSingleText(
  text: string,
  from: 'ar' | 'en' = 'ar',
  to: 'ar' | 'en' = 'en'
): Promise<string> {
  if (!text || !text.trim()) return text;

  const cacheKey = getCacheKey(text, from, to);
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  const { maskedText, tokens } = maskSpecialContent(text);
  if (!maskedText.trim()) {
    return restoreSpecialContent(maskedText, tokens);
  }

  const fastResult = await translateViaFastEngine(maskedText.trim(), from, to);
  if (fastResult) {
    const finalResult = restoreSpecialContent(fastResult, tokens);
    setCache(cacheKey, finalResult);
    return finalResult;
  }

  try {
    const translator = await getOfflinePipeline(from, to);
    const result = await translator(maskedText.trim());
    const translated = result?.[0]?.translation_text || '';
    const finalResult = restoreSpecialContent(translated, tokens);
    if (finalResult) {
      setCache(cacheKey, finalResult);
      return finalResult;
    }
  } catch (err) {
    console.error('Offline pipeline translation failed:', err);
  }

  return text;
}

export async function translateBatchTexts(
  texts: string[],
  from: 'ar' | 'en' = 'ar',
  to: 'ar' | 'en' = 'en'
): Promise<string[]> {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const BATCH_SIZE = 8;
  const results: string[] = new Array(texts.length);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    const sliceResults = await Promise.all(
      slice.map((t) => {
        if (!t || typeof t !== 'string' || !t.trim()) {
          return Promise.resolve(t);
        }
        return translateSingleText(t, from, to);
      })
    );
    for (let j = 0; j < sliceResults.length; j++) {
      results[i + j] = sliceResults[j];
    }
  }

  return results;
}
