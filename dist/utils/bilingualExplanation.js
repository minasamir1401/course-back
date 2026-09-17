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
exports.buildEnglishExplanation = buildEnglishExplanation;
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
function buildEnglishExplanation(rawExplanation, translate) {
    return __awaiter(this, void 0, void 0, function* () {
        const source = String(rawExplanation || '').trim();
        if (!source || source === '[]' || source === '""')
            return null;
        try {
            const parsed = JSON.parse(source);
            if (Array.isArray(parsed)) {
                const translatedSections = [];
                for (const section of parsed) {
                    if (!section || typeof section !== 'object')
                        continue;
                    const sectionSource = nonEmpty(section.content) ? section.content : section.text;
                    if (!nonEmpty(sectionSource))
                        continue;
                    const translated = yield translate(String(sectionSource), 'ar', 'en');
                    if (!nonEmpty(translated) || translated.trim() === String(sectionSource).trim())
                        return null;
                    translatedSections.push(Object.assign(Object.assign({}, section), { contentEn: translated }));
                }
                return translatedSections.length ? JSON.stringify(translatedSections) : null;
            }
        }
        catch (_a) {
            // Plain rich text is translated as one protected HTML string by the existing service.
        }
        const translated = yield translate(source, 'ar', 'en');
        if (!nonEmpty(translated) || translated.trim() === source)
            return null;
        return translated;
    });
}
