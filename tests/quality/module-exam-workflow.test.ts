import assert from 'node:assert/strict';
import {
  countModuleContent,
  getAvailability,
  filterQuestionsForSubExam,
  mergeStudentProfile,
  resolveExamAccessPassword,
} from '../../src/utils/examWorkflow';

describe('Module & Exam Workflow', () => {
  it('correctly counts module content with sub-exams', () => {
    const moduleWithThreeExams = {
      questions: [],
      _count: { questions: 0 },
      subExams: [
        { id: 'exam-1', _count: { questions: 3 } },
        { id: 'exam-2', _count: { questions: 3 } },
        { id: 'exam-3', _count: { questions: 3 } },
      ],
    };

    assert.deepEqual(countModuleContent(moduleWithThreeExams), {
      examsCount: 3,
      questionsCount: 9,
    });

    assert.deepEqual(countModuleContent({
      _count: { questions: 12 },
      subExams: [
        { _count: { questions: 6 } },
        { _count: { questions: 6 } },
      ],
    }), {
      examsCount: 2,
      questionsCount: 12,
    });
  });

  it('determines exam availability based on publishDate and cutOffDate', () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    assert.equal(getAvailability({ publishDate: '2026-08-21T13:00:00.000Z' }, now), 'UPCOMING');
    assert.equal(getAvailability({ cutOffDate: '2026-08-21T11:00:00.000Z' }, now), 'EXPIRED');
    assert.equal(getAvailability({}, now), 'AVAILABLE');
  });

  it('filters questions for sub-exams correctly', () => {
    const questions = [
      { id: 'q1', subExamId: 'exam-1' },
      { id: 'q2', subExamId: 'exam-1' },
      { id: 'q3', subExamId: 'exam-2' },
    ];
    assert.deepEqual(filterQuestionsForSubExam(questions, 'exam-1').map((q) => q.id), ['q1', 'q2']);
  });

  it('merges student profiles properly', () => {
    assert.deepEqual(mergeStudentProfile(
      { role: 'STUDENT', grade: 'old-grade', schoolId: 'old-school' },
      { grade: 'current-grade', schoolId: 'current-school' },
    ), {
      role: 'STUDENT',
      grade: 'current-grade',
      schoolId: 'current-school',
    });
  });

  it('resolves exam access password with child override', () => {
    assert.equal(
      resolveExamAccessPassword(
        { password: 'parent-password' },
        { id: 'sub-exam-1', password: 'child-password' },
      ),
      'child-password',
    );

    assert.equal(
      resolveExamAccessPassword(
        { password: 'parent-password' },
        null,
      ),
      'parent-password',
    );
  });
});
