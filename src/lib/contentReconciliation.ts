import { getQuestionCoreSignature, robustNormalizeText } from '../shared';

export interface PersistedOrderedItem {
  id: string;
  order?: number | null;
  createdAt?: Date | string | null;
}

export interface ReconciliationCandidate extends PersistedOrderedItem {
  fingerprint: string;
}

const parseJsonish = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}')))) {
    return trimmed.replace(/\r\n/g, '\n');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/\r\n/g, '\n');
  }
};

const canonicalize = (value: unknown): unknown => {
  const parsed = parseJsonish(value);
  if (parsed instanceof Date) return parsed.toISOString();
  if (Array.isArray(parsed)) return parsed.map(canonicalize);
  if (parsed && typeof parsed === 'object') {
    return Object.keys(parsed as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const nested = (parsed as Record<string, unknown>)[key];
        if (nested !== undefined) result[key] = canonicalize(nested);
        return result;
      }, {});
  }
  return parsed ?? null;
};

export const canonicalContent = (value: unknown): string => JSON.stringify(canonicalize(value));

export const buildQuestionFingerprint = (question: any): string => canonicalContent({
  text: question?.text ?? '',
  type: question?.type ?? 'MCQ',
  options: question?.options ?? [],
  correctAnswer: question?.correctAnswer ?? question?.correctAnswers ?? '',
});

export const buildLessonFingerprint = (lesson: any): string => canonicalContent({
  title: lesson?.title ?? '',
  domain: lesson?.domain ?? null,
  videoUrl: lesson?.videoUrl ?? null,
  content: lesson?.content ?? null,
  summary: lesson?.summary ?? null,
  notes: lesson?.notes ?? null,
  attachments: lesson?.attachments ?? [],
  slides: lesson?.slides ?? [],
  questions: lesson?.questions ?? [],
  assignments: lesson?.assignments ?? [],
  standards: lesson?.standards ?? null,
  indicators: lesson?.indicators ?? null,
  learningOutcomes: lesson?.learningOutcomes ?? null,
  isVisible: lesson?.isVisible ?? true,
  publishDate: lesson?.publishDate ?? null,
  cutOffDate: lesson?.cutOffDate ?? null,
});

const createdAtValue = (value: Date | string | null | undefined): number => {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const comparePersistedOrder = <T extends PersistedOrderedItem>(left: T, right: T): number => {
  const orderDifference = (left.order ?? 0) - (right.order ?? 0);
  if (orderDifference !== 0) return orderDifference;

  const createdDifference = createdAtValue(left.createdAt) - createdAtValue(right.createdAt);
  if (createdDifference !== 0) return createdDifference;

  return left.id.localeCompare(right.id);
};

export const sortPersistedOrder = <T extends PersistedOrderedItem>(items: T[]): T[] =>
  [...items].sort(comparePersistedOrder);

/**
 * Reconciles an ID-less editor item with a row already persisted by an earlier
 * autosave. IDs explicitly present elsewhere in the incoming payload are
 * reserved first, so inserting a genuinely new item cannot overwrite them.
 *
 * allowOrderFallback is intentionally strict: we only allow an order-based
 * match when the two questions share the same text content. A position match
 * on different content was a root cause of duplicate question creation during
 * rapid successive autosaves.
 */
const extractText = (fingerprint: string): string => {
  try {
    const parsed = JSON.parse(fingerprint);
    return typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  } catch {
    return '';
  }
};

export const pickReconciliationCandidate = (
  existing: ReconciliationCandidate[],
  incomingOrder: number,
  incomingFingerprint: string,
  reservedIds: ReadonlySet<string>,
  usedIds: ReadonlySet<string>,
  allowOrderFallback = false,
): ReconciliationCandidate | undefined => {
  const available = existing.filter((item) => !reservedIds.has(item.id) && !usedIds.has(item.id));

  // 1. Exact fingerprint match (always safe)
  const exactMatch = available.find((item) => item.fingerprint === incomingFingerprint);
  if (exactMatch) return exactMatch;

  // 1.5 Match by core signature (handles HTML tag differences, question number prefixes)
  const incomingText = extractText(incomingFingerprint);
  const incomingSig = getQuestionCoreSignature(incomingText);
  if (incomingSig && incomingSig.length >= 5) {
    const sigMatch = available.find((item) => {
      const itemSig = getQuestionCoreSignature(extractText(item.fingerprint));
      return itemSig === incomingSig || robustNormalizeText(extractText(item.fingerprint)) === robustNormalizeText(incomingText);
    });
    if (sigMatch) return sigMatch;
  }

  // 2. Order-based fallback — only when the question text core signature matches.
  //    This guards against matching a completely different question that happens
  //    to sit at the same position after an interleaved autosave.
  if (allowOrderFallback && incomingSig && incomingSig.length >= 5) {
    return available.find(
      (item) =>
        (item.order ?? 0) === incomingOrder &&
        getQuestionCoreSignature(extractText(item.fingerprint)) === incomingSig,
    );
  }

  return undefined;
};
