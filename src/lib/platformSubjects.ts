// The same subjects offered by the course and exam authoring screens.
export const PLATFORM_SUBJECTS = [
  'اللغة العربية', 'اللغة الإنجليزية', 'اللغة الفرنسية', 'اللغة الألمانية', 'اللغة الإيطالية',
  'الرياضيات', 'العلوم', 'العلوم المتكاملة', 'الفيزياء', 'الكيمياء', 'الأحياء', 'الجيولوجيا', 'الميكانيكا',
  'الدراسات الاجتماعية', 'التاريخ', 'الجغرافيا', 'الفلسفة', 'علم النفس', 'الاقتصاد', 'الإحصاء',
  'التربية الدينية', 'التربية الوطنية', 'الحاسب الآلي', 'التربية الفنية', 'التربية الرياضية', 'SAT Math', 'SAT English',
];
export function subjectValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(subjectValues);
  if (typeof value !== 'string' || !value.trim()) return [];
  const text = value.trim();
  if (text.startsWith('[') || text.startsWith('"')) {
    try { const decoded = JSON.parse(text); if (decoded !== text) return subjectValues(decoded); } catch {}
  }
  return text.split(/[,،;|]/).map(item => item.trim()).filter(Boolean);
}
