const items = (value: unknown): any[] | null => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : null; } catch { return null; }
  }
  return null;
};

export function removesSavedContent(previous: unknown, next: unknown): boolean {
  const before = items(previous);
  const after = items(next);
  if (!before || next === undefined) return false;
  if (!after) return before.length > 0;
  if (after.length < before.length) return true;
  const identity = (item: any) => item?.id ?? item?.blockId;
  const retained = new Set(after.map(identity).filter(id => id != null).map(String));
  return before.some(item => identity(item) != null && !retained.has(String(identity(item))));
}
