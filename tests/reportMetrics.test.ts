import { attemptPassed, csvCell, ratio, selectAttempts } from '../src/utils/reportMetrics';
import { buildSubmissionSnapshot, historicalSubmission, snapshotQuestion } from '../src/utils/submissionSnapshot';

describe('reporting identity, grading and historical records', () => {
  const row = (id: string, userId: string, score: number, day: number, subExamId: string | null = null) => ({ id, userId, examId: 'exam', subExamId, percentage: score, createdAt: new Date(Date.UTC(2026, 9, day)) });
  it('chooses an attempt per student AND exam section with deterministic ties', () => {
    const rows = [row('a', 'u', 90, 1), row('b', 'u', 70, 2), row('c', 'u', 100, 3, 'section'), row('d', 'other', 40, 4), row('z', 'u', 80, 2)];
    expect(selectAttempts(rows, 'latest').map(item => item.id)).toEqual(['z', 'c', 'd']);
    expect(selectAttempts(rows, 'first').map(item => item.id)).toEqual(['a', 'c', 'd']);
    expect(selectAttempts(rows, 'best').map(item => item.id)).toEqual(['a', 'c', 'd']);
  });
  it('distinguishes no data from a real zero and escapes spreadsheet formulas', () => {
    expect(ratio(0, 0)).toBeNull(); expect(ratio(0, 5)).toBe(0);
    expect(csvCell('=HYPERLINK("url")')).toBe('"\'=HYPERLINK(""url"")"');
    expect(csvCell('Name, Other')).toBe('"Name, Other"');
  });
  it('uses a frozen child threshold, including zero, and the minimum-correct policy', () => {
    expect(attemptPassed({ percentage: 70, exam: { passingScore: 50 }, reportSnapshot: { passingScore: 80 } })).toBe(false);
    expect(attemptPassed({ percentage: 0, reportSnapshot: { passingScore: 0 } })).toBe(true);
    expect(attemptPassed({ percentage: 70, totalQuestions: 10, correctAnswers: 1, exam: { passingScore: 50 } })).toBe(false);
  });
  it('reads saved scores and frozen questions after content edits or soft deletion', () => {
    const before = { id: 'q', text: 'Original', points: 2, correctAnswer: 'A' };
    const stored = { totalScore: 2, percentage: 100, reportSnapshot: { totalPoints: 2, totalQuestions: 1, correctAnswers: 1 }, answers: [{ isCorrect: true, questionSnapshot: snapshotQuestion(before), question: { ...before, text: 'Edited', points: 20, correctAnswer: 'B', deletedAt: new Date() } }] };
    const history = historicalSubmission(stored);
    expect(history.totalScore).toBe(2); expect(history.percentage).toBe(100); expect(history.answers[0].question.text).toBe('Original'); expect(history.totalPoints).toBe(2);
    expect(stored.answers[0].question.text).toBe('Edited');
  });
  it('preserves legacy scores without pretending that a snapshot exists', () => {
    const history = historicalSubmission({ totalScore: 6, percentage: 60, answers: [{ isCorrect: false, question: { points: 20, correctAnswer: 'A' }, selectedAnswer: 'A' }] });
    expect(history.totalScore).toBe(6); expect(history.percentage).toBe(60); expect(history.answers[0].isCorrect).toBe(false); expect(history.historical).toBe(false); expect(history.totalPoints).toBeNull();
  });
  it('freezes school, grade, threshold, correct count and XP at submission time', () => {
    const result = buildSubmissionSnapshot({ title: 'Parent', passingScore: 50 }, { title: 'Child', passingScore: 80 }, { schoolId: 'a', grade: 'G', school: { name: 'School A' }, classroomId: 'c' }, [{ points: 2 }], [{ isCorrect: true }], 70, 20);
    expect(result).toMatchObject({ examTitle: 'Child', schoolId: 'a', schoolName: 'School A', grade: 'G', classroomId: 'c', passingScore: 80, earnedXP: 20, passed: false });
  });
});
