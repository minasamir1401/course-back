import { changedQuestionFields, changedQuestionOrders, calculateSubmissionStats } from '../src/utils/examPerformance';
describe('exam performance without changing saved content', () => {
  it('skips unchanged fields and preserves omitted metadata', () => {
    expect(changedQuestionFields({ text: 'Same', points: 2, skill: 'Keep' }, { text: 'Same', points: 2, skill: undefined })).toEqual({});
    expect(changedQuestionFields({ text: 'Old', explanation: 'Keep' }, { text: 'New', explanation: undefined })).toEqual({ text: 'New' });
    expect(changedQuestionFields({ skill: 'Old' }, { skill: null })).toEqual({ skill: null });
  });
  it('only writes changed positions', () => {
    expect(changedQuestionOrders([{ id: 'a', order: 0 }, { id: 'b', order: 1 }], ['a', 'b'])).toEqual([]);
    expect(changedQuestionOrders([{ id: 'a', order: 0 }, { id: 'b', order: 1 }], ['b', 'a'])).toEqual([{ id: 'b', order: 0 }, { id: 'a', order: 1 }]);
  });
  it('preserves first-attempt score and streak with shuffled answers', () => {
    const questions = Array.from({ length: 10 }, (_, order) => ({ id: String(order), order, points: 2, xpPoints: 3 }));
    const answers = questions.map(q => ({ questionId: q.id, isCorrect: true })).reverse();
    expect(calculateSubmissionStats(questions, answers, true)).toEqual({ earnedXP: 70, dynamicTotalScore: 20, totalPoints: 20, correctAnswers: 10, totalQuestions: 10 });
    expect(calculateSubmissionStats(questions, answers, false).earnedXP).toBe(0);
  });
});
