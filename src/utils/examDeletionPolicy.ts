type ExamDeletionPayload = {
  deletedModuleIds?: unknown;
  deletedSubExamIds?: unknown;
};

const uniqueStringIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];
};

// Collection snapshots can be stale in an autosave request. Deletion must be
// intentional and explicit, never inferred from a missing collection member.
export function resolveExplicitExamDeletions(payload: ExamDeletionPayload) {
  return {
    moduleIds: uniqueStringIds(payload.deletedModuleIds),
    subExamIds: uniqueStringIds(payload.deletedSubExamIds),
  };
}
