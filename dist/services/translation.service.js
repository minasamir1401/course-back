"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
let arEnPipeline = null;
let enArPipeline = null;
let arEnPromise = null;
let enArPromise = null;
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
function getOfflinePipeline(from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        const { pipeline } = yield Promise.resolve().then(() => __importStar(require('@xenova/transformers')));
        if (from === 'ar' && to === 'en') {
            if (!arEnPipeline) {
                if (!arEnPromise) {
                    arEnPromise = pipeline('translation', 'Xenova/opus-mt-ar-en', { quantized: true });
                }
                arEnPipeline = yield arEnPromise;
            }
            return arEnPipeline;
        }
        else {
            if (!enArPipeline) {
                if (!enArPromise) {
                    enArPromise = pipeline('translation', 'Xenova/opus-mt-en-ar', { quantized: true });
                }
                enArPipeline = yield enArPromise;
            }
            return enArPipeline;
        }
    });
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
        const mathRegex = new RegExp(`\\s*__MATH_${index}__\\s*`, 'gi');
        const htmlRegex = new RegExp(`\\s*__HTML_${index}__\\s*`, 'gi');
        restored = restored.replace(mathRegex, original).replace(htmlRegex, original);
    });
    return restored;
}
function translateViaFastEngine(text, from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
            const response = yield fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                signal: AbortSignal.timeout(4000)
            });
            if (!response.ok)
                return null;
            const data = yield response.json();
            if (!Array.isArray(data) || !Array.isArray(data[0]))
                return null;
            const translatedParts = data[0].map((item) => (item === null || item === void 0 ? void 0 : item[0]) || '').filter(Boolean);
            return translatedParts.join('') || null;
        }
        catch (_a) {
            return null;
        }
    });
}
function translateSingleText(text_1) {
    return __awaiter(this, arguments, void 0, function* (text, from = 'ar', to = 'en') {
        var _a;
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
        try {
            const translator = yield getOfflinePipeline(from, to);
            const result = yield translator(maskedText.trim());
            const translated = ((_a = result === null || result === void 0 ? void 0 : result[0]) === null || _a === void 0 ? void 0 : _a.translation_text) || '';
            const finalResult = restoreSpecialContent(translated, tokens);
            if (finalResult) {
                setCache(cacheKey, finalResult);
                return finalResult;
            }
        }
        catch (err) {
            console.error('Offline pipeline translation failed:', err);
        }
        return text;
    });
}
function translateBatchTexts(texts_1) {
    return __awaiter(this, arguments, void 0, function* (texts, from = 'ar', to = 'en') {
        if (!Array.isArray(texts) || texts.length === 0)
            return [];
        const BATCH_SIZE = 8;
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
