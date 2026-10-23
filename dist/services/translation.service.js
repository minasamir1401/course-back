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
exports.maskSpecialContent = maskSpecialContent;
exports.restoreSpecialContent = restoreSpecialContent;
exports.translateSingleText = translateSingleText;
exports.translateBatchTexts = translateBatchTexts;
const translationMath_1 = require("../utils/translationMath");
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
    const rendered = (0, translationMath_1.protectRenderedMath)(text);
    let masked = rendered.html.replace(/\x00RENDERED(\d+)\x00/g, (_, index) => {
        const token = ` __MATH_${tokens.length}__ `;
        tokens.push(rendered.blocks[Number(index)]);
        return token;
    });
    masked = masked.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\$)\$[^$\n]+\$(?!\$)/g, match => {
        const token = ` __MATH_${tokens.length}__ `;
        tokens.push(match);
        return token;
    });
    masked = masked.replace(/<[^>]+>/g, (match) => {
        const placeholder = ` __HTML_${tokens.length}__ `;
        tokens.push(match);
        return placeholder;
    });
    masked = masked.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+/gi, (match) => {
        const placeholder = ` __MEDIA_${tokens.length}__ `;
        tokens.push(match);
        return placeholder;
    });
    return { maskedText: masked, tokens };
}
function restoreSpecialContent(text, tokens) {
    return text.replace(/\s*__\s*(MATH|HTML|MEDIA)_(\d+)\s*__\s*/gi, (match, kind, index) => {
        const original = tokens[Number(index)];
        if (original === undefined)
            return match;
        return kind.toUpperCase() === 'MATH' ? ` ${original} ` : original;
    });
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
function splitTextIntoChunks(text, maxChunkLength = 2500) {
    if (text.length <= maxChunkLength)
        return [text];
    const chunks = [];
    const paragraphs = text.split(/(\n+)/);
    let currentChunk = '';
    for (const part of paragraphs) {
        if ((currentChunk + part).length <= maxChunkLength) {
            currentChunk += part;
        }
        else {
            if (currentChunk.trim()) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            if (part.length <= maxChunkLength) {
                currentChunk = part;
            }
            else {
                const sentences = part.split(/([.!?؟]+(?:\s+|$))/);
                for (const s of sentences) {
                    if ((currentChunk + s).length <= maxChunkLength) {
                        currentChunk += s;
                    }
                    else {
                        if (currentChunk.trim()) {
                            chunks.push(currentChunk);
                            currentChunk = '';
                        }
                        if (s.length <= maxChunkLength) {
                            currentChunk = s;
                        }
                        else {
                            for (let i = 0; i < s.length; i += maxChunkLength) {
                                chunks.push(s.slice(i, i + maxChunkLength));
                            }
                        }
                    }
                }
            }
        }
    }
    if (currentChunk.trim()) {
        chunks.push(currentChunk);
    }
    return chunks.length > 0 ? chunks : [text];
}
function translateViaFastEngine(text, from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        if (text.length > 2500) {
            const chunks = splitTextIntoChunks(text, 2500);
            if (chunks.length > 1) {
                const translatedChunks = yield Promise.all(chunks.map(chunk => translateViaFastEngine(chunk, from, to)));
                if (translatedChunks.every(Boolean)) {
                    return translatedChunks.join('');
                }
            }
        }
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
/** Translate visible runs, keeping formatting/media outside the provider request. */
function translateRichHtml(text, from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        const rendered = (0, translationMath_1.protectRenderedMath)(text);
        const parts = rendered.html.split(/(\x00RENDERED\d+\x00|<!--[\s\S]*?-->|<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>|<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\r\n]+\$)/gi);
        const decode = (value) => value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#(\d+)|#x([\da-f]+));/gi, (entity, decimal, hex) => {
            if (decimal || hex) {
                const code = parseInt(decimal || hex, hex ? 16 : 10);
                return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
            }
            return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' }[entity.toLowerCase()] || entity;
        });
        const indices = parts.map((part, index) => part.trim() && !/^(?:<|\x00RENDERED|\$|\\[([])/.test(part) ? index : -1).filter(index => index >= 0);
        for (let start = 0; start < indices.length; start += 16) {
            yield Promise.all(indices.slice(start, start + 16).map((index) => __awaiter(this, void 0, void 0, function* () {
                const part = parts[index];
                const source = decode(part.trim());
                const translated = yield translateSingleText(source, from, to);
                if (translated === source)
                    return;
                const escaped = translated.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                parts[index] = part.replace(/\S[\s\S]*\S|\S/, () => escaped);
            })));
        }
        return parts.join('').replace(/\x00RENDERED(\d+)\x00/g, (_, index) => rendered.blocks[Number(index)]);
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
        if (/<\/?[a-z][\s\S]*?>/i.test(text)) {
            const translated = yield translateRichHtml(text, from, to);
            if (translated !== text)
                setCache(cacheKey, translated);
            return translated;
        }
        const { maskedText, tokens } = maskSpecialContent(text);
        if (!maskedText.trim()) {
            return restoreSpecialContent(maskedText, tokens);
        }
        const fastResult = yield translateViaFastEngine(maskedText.trim(), from, to);
        // A provider dropping or duplicating a placeholder must never corrupt saved math/HTML.
        const expectedTokens = maskedText.match(/__(?:MATH|HTML|MEDIA)_\d+__/g) || [];
        const intact = fastResult && expectedTokens.every(token => {
            const pattern = token.replace(/^__/, '__\\s*').replace(/__$/, '\\s*__');
            return (fastResult.match(new RegExp(pattern, 'gi')) || []).length === 1;
        });
        if (fastResult && intact) {
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
