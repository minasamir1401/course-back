import { QUESTION_METADATA_FIELDS, metadataForDisplay } from './bilingualMetadata';
import { createHash } from 'node:crypto';
import { resolvePassingScore } from './examPassingScore';

export function buildSubmissionSnapshot(exam: any, child: any, student: any, questions: any[], answers: any[], percentage: number, earnedXP: number) {
  const passingScore = resolvePassingScore(exam.passingScore, child?.passingScore);
  const correctAnswers = answers.filter(answer => answer.isCorrect).length;
  return {
    version: 1, capturedAt: new Date().toISOString(), timeZone: 'Africa/Cairo',
    examTitle: child?.title || exam.title, examType: exam.type, subject: exam.subjects || null,
    schoolId: student?.schoolId || null, schoolName: student?.school?.name || null,
    grade: student?.grade || null, classroomId: student?.classroomId || null,
    passingScore, totalPoints: questions.reduce((sum, question) => sum + question.points, 0),
    totalQuestions: questions.length, correctAnswers, earnedXP,
    passed: percentage >= passingScore && correctAnswers >= Math.ceil(questions.length / 2),
  };
}

export function snapshotQuestion(question: any) {
  const keys = ['id', 'text', 'textEn', 'type', 'options', 'optionsEn', 'correctAnswer', 'correctAnswerEn', 'label', 'cognitive', 'errorPattern', 'points', 'xpPoints', 'order',
    'moduleId', 'subExamId', 'explanation', 'explanationEn', 'hint', 'hintEn', 'imageUrl', 'videoUrl',
    'skill', 'standard', 'indicator', 'learningOutcome', 'domain', 'subskill', 'microSkill', 'level', 'dok', 'course', 'section', 'estimatedTime', ...QUESTION_METADATA_FIELDS.map(field => `${field}En`)];
  const content = Object.fromEntries(keys.map(key => [key, question[key] ?? null]));
  return { ...content, revision: createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16) };
}

/** A read never regrades or writes a historical submission, including legacy records. */
export function historicalSubmission(submission: any) {
  const snapshot = submission.reportSnapshot || {};
  const answers = (submission.answers || []).map((answer: any) => ({
    ...answer, question: metadataForDisplay(answer.questionSnapshot, answer.question) || answer.question,
  }));
  const correctAnswers = snapshot.correctAnswers ?? answers.filter((answer: any) => answer.isCorrect).length;
  const totalQuestions = snapshot.totalQuestions ?? answers.length;
  const currentPoints = answers.reduce((sum: number, answer: any) => sum + (Number(answer.question?.points) || 0), 0);
  // Without a frozen denominator, current question points cannot establish a historical total.
  const totalPoints = snapshot.totalPoints ?? (Number.isFinite(submission.totalScore) ? null : currentPoints);
  const totalScore = Number.isFinite(submission.totalScore) ? submission.totalScore
    : answers.filter((answer: any) => answer.isCorrect).reduce((sum: number, answer: any) => sum + (Number(answer.question?.points) || 0), 0);
  const percentage = Number.isFinite(submission.percentage) ? submission.percentage : currentPoints ? totalScore / currentPoints * 100 : null;
  return { answers, correctAnswers, totalQuestions, totalPoints, totalScore, percentage, historical: Boolean(submission.reportSnapshot) };
}
