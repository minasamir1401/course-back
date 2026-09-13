"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.translateSingleText = translateSingleText;
exports.translateBatchTexts = translateBatchTexts;
const translationCache = new Map();
const MAX_CACHE_SIZE = 5000;
function getCacheKey(text, from, to) {
    return `${from}:${to}:${text.trim()}`;
}
function setCache(key, value) {
    if (translationCache.size >= MAX_CACHE_SIZE) {
        const firstKey = translationCache.keys().next().value;
        if (firstKey)
            translationCache.delete(firstKey);
    }
    translationCache.set(key, value);
}
function maskSpecialContent(text) {
    const tokens = [];
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
function restoreSpecialContent(text, tokens) {
    let restored = text;
    tokens.forEach((original, index) => {
        const mathRegex = new RegExp(`\\s*__\\s*MATH_${index}\\s*__\\s*`, 'gi');
        const htmlRegex = new RegExp(`\\s*__\\s*HTML_${index}\\s*__\\s*`, 'gi');
        restored = restored.replace(mathRegex, ` ${original} `).replace(htmlRegex, original);
    });
    return restored;
}
function fetchGoogleTranslation(text, from, to, client) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
        const response = yield fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(4000)
        });
        if (!response.ok)
            return null;
        const data = yield response.json();
        if (!Array.isArray(data) || !Array.isArray(data[0]))
            return null;
        const translatedParts = data[0].map((item) => (item === null || item === void 0 ? void 0 : item[0]) || '').filter(Boolean);
        const result = translatedParts.join('');
        return result.trim() ? result : null;
    });
}
function fetchMyMemoryTranslation(text, from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const langpair = `${from}|${to}`;
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
        const response = yield fetch(url, {
            signal: AbortSignal.timeout(4000)
        });
        if (!response.ok)
            return null;
        const data = yield response.json();
        const result = (_a = data === null || data === void 0 ? void 0 : data.responseData) === null || _a === void 0 ? void 0 : _a.translatedText;
        return (typeof result === 'string' && result.trim()) ? result : null;
    });
}
function translateViaFastEngine(text, from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        const clients = ['dict-chrome-ex', 'it'];
        for (const client of clients) {
            try {
                const result = yield fetchGoogleTranslation(text, from, to, client);
                if (result)
                    return result;
            }
            catch (_a) {
                continue;
            }
        }
        try {
            const fallbackResult = yield fetchMyMemoryTranslation(text, from, to);
            if (fallbackResult)
                return fallbackResult;
        }
        catch (_b) {
            // Fallback failed
        }
        return null;
    });
}
function translateSingleText(text_1) {
    return __awaiter(this, arguments, void 0, function* (text, from = 'ar', to = 'en') {
        if (!text || !text.trim())
            return text;
        const cacheKey = getCacheKey(text, from, to);
        if (translationCache.has(cacheKey)) {
            return translationCache.get(cacheKey);
        }
        const { maskedText, tokens } = maskSpecialContent(text);
        if (!maskedText.trim()) {
            return restoreSpecialContent(maskedText, tokens);
        }
        const fastResult = yield translateViaFastEngine(maskedText.trim(), from, to);
        if (fastResult) {
            const finalResult = restoreSpecialContent(fastResult, tokens);
            setCache(cacheKey, finalResult);
            return finalResult;
        }
        return text;
    });
}
function translateBatchTexts(texts_1) {
    return __awaiter(this, arguments, void 0, function* (texts, from = 'ar', to = 'en') {
        if (!Array.isArray(texts) || texts.length === 0)
            return [];
        const BATCH_SIZE = 16;
        const results = new Array(texts.length);
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const slice = texts.slice(i, i + BATCH_SIZE);
            const sliceResults = yield Promise.all(slice.map((t) => {
                if (!t || typeof t !== 'string' || !t.trim()) {
                    return Promise.resolve(t);
                }
                return translateSingleText(t, from, to);
            }));
            for (let j = 0; j < sliceResults.length; j++) {
                results[i + j] = sliceResults[j];
            }
        }
        return results;
    });
}
