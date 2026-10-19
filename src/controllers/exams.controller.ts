// Public controller API. Implementations are split by workflow to keep files reviewable.
export { canManageExam, canViewExam, formatCorrectAnswer, formatExplanation } from './examControllerSupport';
export * from './examManagement';
export * from './examEditing';
export * from './examDelivery';
