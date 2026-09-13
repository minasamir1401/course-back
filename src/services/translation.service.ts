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
    const mathRegex = new RegExp(`\\s*__\\s*MATH_${index}\\s*__\\s*`, 'gi');
    const htmlRegex = new RegExp(`\\s*__\\s*HTML_${index}\\s*__\\s*`, 'gi');
    restored = restored.replace(mathRegex, ` ${original} `).replace(htmlRegex, original);
  });
  return restored;
}

async function fetchGoogleTranslation(text: string, from: 'ar' | 'en', to: 'ar' | 'en', client: string): Promise<string | null> {
  const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(4000)
  });

  if (!response.ok) return null;
  const data: any = await response.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;

  const translatedParts = data[0].map((item: any) => item?.[0] || '').filter(Boolean);
  const result = translatedParts.join('');
  return result.trim() ? result : null;
}

async function fetchMyMemoryTranslation(text: string, from: 'ar' | 'en', to: 'ar' | 'en'): Promise<string | null> {
  const langpair = `${from}|${to}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4000)
  });

  if (!response.ok) return null;
  const data: any = await response.json();
  const result = data?.responseData?.translatedText;
  return (typeof result === 'string' && result.trim()) ? result : null;
}

async function translateViaFastEngine(text: string, from: 'ar' | 'en', to: 'ar' | 'en'): Promise<string | null> {
  const clients = ['dict-chrome-ex', 'it'];
  for (const client of clients) {
    try {
      const result = await fetchGoogleTranslation(text, from, to, client);
      if (result) return result;
    } catch {
      continue;
    }
  }

  try {
    const fallbackResult = await fetchMyMemoryTranslation(text, from, to);
    if (fallbackResult) return fallbackResult;
  } catch {
    // Fallback failed
  }

  return null;
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

  return text;
}

export async function translateBatchTexts(
  texts: string[],
  from: 'ar' | 'en' = 'ar',
  to: 'ar' | 'en' = 'en'
): Promise<string[]> {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const BATCH_SIZE = 16;
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
