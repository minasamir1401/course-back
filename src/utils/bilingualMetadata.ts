export const QUESTION_METADATA_FIELDS = ['course', 'section', 'domain', 'standard', 'learningOutcome', 'indicator', 'skill', 'subskill', 'microSkill', 'errorPattern'] as const;
export const LESSON_METADATA_FIELDS = ['domain', 'standards', 'indicators', 'learningOutcomes'] as const;

/** Undefined means omitted, null/empty means intentionally cleared. */
export function metadataTranslations(source: any, sanitize: (text: string) => string = String, fields: readonly string[] = QUESTION_METADATA_FIELDS) {
  return Object.fromEntries(fields.filter(field => source?.[`${field}En`] !== undefined).map(field => {
    const value = source[`${field}En`];
    return [`${field}En`, value ? sanitize(String(value)) : null];
  }));
}

/** Enrich only an identical historical label; never substitute a changed skill or score. */
export function metadataForDisplay(snapshot: any, current: any) {
  if (!snapshot || !current || snapshot === current) return snapshot;
  const result = { ...snapshot };
  for (const field of QUESTION_METADATA_FIELDS) {
    const value = snapshot[field];
    if (!value || (value !== current[field] && value !== current[`${field}En`])) continue;
    result[field] = current[field] || value;
    result[`${field}En`] = snapshot[`${field}En`] || current[`${field}En`] || null;
  }
  return result;
}

export function moduleMetadata(source: any, sanitize: (text: string) => string = String) {
  return Object.fromEntries(LESSON_METADATA_FIELDS.flatMap(field => [field, `${field}En`]).filter(field => source?.[field] !== undefined).map(field => [field, source[field] ? sanitize(String(source[field])) : null]));
}
