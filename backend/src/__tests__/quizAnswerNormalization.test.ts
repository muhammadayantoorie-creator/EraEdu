process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockAssertStudentEmailPolicy = jest.fn().mockResolvedValue(undefined);

jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: mockAssertStudentEmailPolicy }));

import { normalizeAttemptAnswers, optionOrderForAttempt, quizService } from '../services/quizService';

const questions = [
  { text: 'Q1', options: ['A', 'B', 'C'], correctAnswer: 0, difficulty: 'Easy' },
  { text: 'Q2', options: ['A', 'B', 'C'], correctAnswer: 1, difficulty: 'Easy' },
  { text: 'Q3', options: ['A', 'B', 'C'], correctAnswer: 2, difficulty: 'Easy' },
];
const quizId = 'quiz-123';

function displayedIndexFor(attemptId: string, questionIndex: number, canonicalIndex: number) {
  return optionOrderForAttempt(questions[questionIndex].options.length, attemptId, questionIndex).indexOf(canonicalIndex);
}

function answersWithOnlyQ3Correct(attemptId: string) {
  return [
    { questionId: `${quizId}-q0`, selectedAnswer: displayedIndexFor(attemptId, 0, 1) },
    { questionId: `${quizId}-q1`, selectedAnswer: displayedIndexFor(attemptId, 1, 0) },
    { questionId: `${quizId}-q2`, selectedAnswer: displayedIndexFor(attemptId, 2, 2) },
  ];
}

describe('normalized teacher-quiz answers', () => {
  it.each(['attempt-alpha', 'attempt-bravo', 'attempt-charlie'])(
    'scores only Q3 and stores canonical answer indices for %s',
    (attemptId) => {
      const result = normalizeAttemptAnswers(quizId, attemptId, questions, answersWithOnlyQ3Correct(attemptId));

      expect(result.score).toBe(1);
      expect(Math.round((result.score / questions.length) * 100)).toBe(33);
      expect(result.answers.map((answer) => answer.selectedAnswer)).toEqual([1, 0, 2]);
      expect(result.answers.map((answer) => answer.isCorrect)).toEqual([false, false, true]);
      expect(result.answers.every((answer) => answer.answerVersion === 2)).toBe(true);
    },
  );

  it('keeps an unanswered MCQ unscored with no selected canonical option', () => {
    const result = normalizeAttemptAnswers(quizId, 'attempt-unanswered', questions, [
      { questionId: `${quizId}-q0`, selectedAnswer: -1 },
    ]);

    expect(result.score).toBe(0);
    expect(result.answers[0]).toMatchObject({ selectedAnswer: null, isCorrect: false });
  });

  it.each([
    [[{ questionId: `${quizId}-q0`, selectedAnswer: 3 }], 'out of range'],
    [[{ questionId: `${quizId}-q0`, selectedAnswer: 0 }, { questionId: `${quizId}-q0`, selectedAnswer: 1 }], 'only be answered once'],
    [[{ questionId: 'other-quiz-q0', selectedAnswer: 0 }], 'does not belong'],
  ])('rejects invalid answer payloads: %s', (answers, message) => {
    expect(() => normalizeAttemptAnswers(quizId, 'attempt-invalid', questions, answers as any)).toThrow(message);
  });
});

function setupSubmission({ status, updateRows = [{ id: 'attempt-1' }], onUpdate }: {
  status: string;
  updateRows?: { id: string }[];
  onUpdate?: (payload: any) => void;
}) {
  const attempt = { id: 'attempt-1', user_id: 'student-1', quiz_id: quizId, status, started_at: new Date().toISOString() };
  const quiz = { id: quizId, title: 'Quiz', teacher_id: 'teacher-1', questions, time_limit: 0 };
  mockFrom.mockImplementation((table: string) => {
    if (table === 'quiz_attempts') {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: attempt, error: null }) }) }) }),
        update: (payload: any) => {
          onUpdate?.(payload);
          return { eq: () => ({ eq: () => ({ select: async () => ({ data: updateRows, error: null }) }) }) };
        },
      };
    }
    if (table === 'teacher_quizzes') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: quiz, error: null }) }) }) };
    }
    if (table === 'notifications') return { insert: async () => ({ error: null }) };
    throw new Error(`Unexpected table ${table}`);
  });
}

describe('submitAllAnswers persistence and resubmission guard', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockAssertStudentEmailPolicy.mockClear();
  });

  it('persists normalized answers and returns 1/3 (33%)', async () => {
    let savedPayload: any;
    setupSubmission({ status: 'in-progress', onUpdate: (payload) => { savedPayload = payload; } });

    await expect(quizService.submitAllAnswers('attempt-1', 'student-1', answersWithOnlyQ3Correct('attempt-1')))
      .resolves.toMatchObject({ score: 1, maxScore: 3, percentage: 33 });
    expect(savedPayload.answers.map((answer: any) => answer.selectedAnswer)).toEqual([1, 0, 2]);
    expect(savedPayload.answers.map((answer: any) => answer.isCorrect)).toEqual([false, false, true]);
  });

  it('rejects a completed attempt and a raced atomic update as resubmissions', async () => {
    setupSubmission({ status: 'completed' });
    await expect(quizService.submitAllAnswers('attempt-1', 'student-1', [])).rejects.toThrow('Exam already submitted');

    setupSubmission({ status: 'in-progress', updateRows: [] });
    await expect(quizService.submitAllAnswers('attempt-1', 'student-1', [])).rejects.toThrow('Exam already submitted');
  });
});

function setupResult(attempt: any) {
  const quiz = { id: quizId, title: 'Quiz', description: '', teacher_id: 'teacher-1', questions };
  mockFrom.mockImplementation((table: string) => {
    if (table === 'quiz_attempts') return { select: () => ({ eq: () => ({ single: async () => ({ data: attempt, error: null }) }) }) };
    if (table === 'teacher_quizzes') return { select: () => ({ eq: () => ({ single: async () => ({ data: quiz, error: null }) }) }) };
    throw new Error(`Unexpected table ${table}`);
  });
}

describe('student results DTO', () => {
  beforeEach(() => mockFrom.mockReset());

  it('returns the same authoritative 1/3, 33% verdict and canonical answers after review', async () => {
    const normalized = normalizeAttemptAnswers(quizId, 'attempt-1', questions, answersWithOnlyQ3Correct('attempt-1'));
    setupResult({ id: 'attempt-1', user_id: 'student-1', quiz_id: quizId, status: 'completed', score: 1, max_score: 3, answers: normalized.answers, teacher_grade: 33, teacher_feedback: '' });

    await expect(quizService.getAttemptResults('attempt-1', 'student-1', 'student'))
      .resolves.toMatchObject({ score: 1, maxScore: 3, percentage: 33, answers: expect.arrayContaining([expect.objectContaining({ questionId: `${quizId}-q2`, selectedAnswer: 2, isCorrect: true })]) });
  });

  it('keeps pre-review student results pending and rejects another student', async () => {
    setupResult({ id: 'attempt-1', user_id: 'student-1', quiz_id: quizId, status: 'completed', score: 1, max_score: 3, answers: [], teacher_grade: null });
    await expect(quizService.getAttemptResults('attempt-1', 'student-1', 'student'))
      .resolves.toMatchObject({ reviewPending: true, quiz: { questions: [] } });
    await expect(quizService.getAttemptResults('attempt-1', 'student-2', 'student')).rejects.toThrow('Unauthorized');
  });
});
