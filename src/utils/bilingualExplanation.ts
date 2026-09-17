type Translator = (text: string, from: 'ar' | 'en', to: 'ar' | 'en') => Promise<string>;

const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

export async function buildEnglishExplanation(
  rawExplanation: string,
  translate: Translator,
): Promise<string | null> {
  const source = String(rawExplanation || '').trim();
  if (!source || source === '[]' || source === '""') return null;

  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) {
      const translatedSections = [];
      for (const section of parsed) {
        if (!section || typeof section !== 'object') continue;
        const sectionSource = nonEmpty(section.content) ? section.content : section.text;
        if (!nonEmpty(sectionSource)) continue;
        const translated = await translate(String(sectionSource), 'ar', 'en');
        if (!nonEmpty(translated) || translated.trim() === String(sectionSource).trim()) return null;
        translatedSections.push({ ...section, contentEn: translated });
      }
      return translatedSections.length ? JSON.stringify(translatedSections) : null;
    }
  } catch {
    // Plain rich text is translated as one protected HTML string by the existing service.
  }

  const translated = await translate(source, 'ar', 'en');
  if (!nonEmpty(translated) || translated.trim() === source) return null;
  return translated;
}
