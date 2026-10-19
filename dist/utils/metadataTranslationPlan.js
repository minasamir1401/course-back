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
exports.missingMetadataTranslations = missingMetadataTranslations;
exports.planMetadataTranslation = planMetadataTranslation;
const metadataGlossary_1 = require("./metadataGlossary");
const hasArabic = (value) => /[\u0600-\u06ff]/.test(value);
function missingMetadataTranslations(value, fields) {
    return fields.filter(field => {
        const base = String((value === null || value === void 0 ? void 0 : value[field]) || '').trim(), en = String((value === null || value === void 0 ? void 0 : value[field + 'En']) || '').trim();
        if ((0, metadataGlossary_1.isMetadataIdentifier)(base || en))
            return !base || !en;
        return base && (!hasArabic(base) || !en) || !base && !!en;
    });
}
/** Only metadata is translated; original English and reviewed translations are retained. */
function planMetadataTranslation(value, fields, translate) {
    return __awaiter(this, void 0, void 0, function* () {
        const patch = {};
        yield Promise.all(missingMetadataTranslations(value, fields).map((field) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const base = String(value[field] || '').trim(), en = String(value[field + 'En'] || '').trim();
            const from = hasArabic(base) ? 'ar' : 'en', source = base || en;
            if (from === 'en' && base && !en)
                patch[field + 'En'] = base;
            if (!base && en && (0, metadataGlossary_1.isMetadataIdentifier)(en))
                patch[field] = en;
            const to = from === 'ar' ? 'en' : 'ar';
            const result = ((_a = (0, metadataGlossary_1.translateMetadataTerm)(source, to)) !== null && _a !== void 0 ? _a : yield translate(source, from, to)).trim();
            if (!result || result === source)
                return;
            if (from === 'en' && !hasArabic(result))
                return;
            if (from === 'ar' && hasArabic(result))
                return;
            patch[field + (from === 'ar' ? 'En' : '')] = result;
        })));
        return patch;
    });
}
