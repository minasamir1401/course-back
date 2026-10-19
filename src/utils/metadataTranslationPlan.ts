import { translateMetadataTerm, isMetadataIdentifier } from './metadataGlossary';
export type TranslateMetadata = (text: string, from: 'ar' | 'en', to: 'ar' | 'en') => Promise<string>;
const hasArabic = (value: string) => /[\u0600-\u06ff]/.test(value);
export function missingMetadataTranslations(value: any, fields: readonly string[]) {
  return fields.filter(field => {
    const base = String(value?.[field] || '').trim(), en = String(value?.[field + 'En'] || '').trim();
    if (isMetadataIdentifier(base || en)) return !base || !en;
    return base && (!hasArabic(base) || !en) || !base && !!en;
  });
}
/** Only metadata is translated; original English and reviewed translations are retained. */
export async function planMetadataTranslation(value: any, fields: readonly string[], translate: TranslateMetadata) {
  const patch: Record<string, string> = {};
  await Promise.all(missingMetadataTranslations(value, fields).map(async field => {
    const base = String(value[field] || '').trim(), en = String(value[field + 'En'] || '').trim();
    const from = hasArabic(base) ? 'ar' : 'en', source = base || en;
    if (from === 'en' && base && !en) patch[field + 'En'] = base;
    if (!base && en && isMetadataIdentifier(en)) patch[field] = en;
    const to = from === 'ar' ? 'en' : 'ar';
    const result = (translateMetadataTerm(source, to) ?? await translate(source, from, to)).trim();
    if (!result || result === source) return;
    if (from === 'en' && !hasArabic(result)) return;
    if (from === 'ar' && hasArabic(result)) return;
    patch[field + (from === 'ar' ? 'En' : '')] = result;
  }));
  return patch;
}
