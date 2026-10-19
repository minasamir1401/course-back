import { deduplicateExamQuestionInput } from '../src/utils/examQuestionInput';

describe('first exam save question identity', () => {
  const question = { id: 1720000000000, text: 'أوجد قيمة المتغير', options: ['1', '2'], correctAnswer: '1', moduleId: 'module', subExamId: 'child' };
  it('saves one row for repeated draft IDs and repeated ID-less rows', () => {
    expect(deduplicateExamQuestionInput([question, { ...question }])).toEqual([question]);
    const { id, ...withoutId } = question;
    expect(deduplicateExamQuestionInput([withoutId, { ...withoutId }])).toEqual([withoutId]);
  });
  it('keeps different answers, separate sections and separate persisted rows', () => {
    const items = [question, { ...question, id: 2, correctAnswer: '2' }, { ...question, id: 3, subExamId: 'other-child' }, { ...question, id: 'saved-one' }, { ...question, id: 'saved-two' }];
    expect(deduplicateExamQuestionInput(items)).toEqual(items);
  });
  it('keeps image-only and video questions with different media', () => {
    const items = [{ text: '', imageUrl: '/a.png' }, { text: '', imageUrl: '/b.png' }, { text: '', videoUrl: '/a.mp4' }];
    expect(deduplicateExamQuestionInput(items)).toEqual(items);
  });
});
