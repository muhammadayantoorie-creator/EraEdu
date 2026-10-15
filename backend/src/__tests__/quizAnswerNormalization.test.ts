process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAssertStudentEmailPolicy = jest.fn().mockResolvedValue(undefined);

jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
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
    [[{ questionId: `${quizId}-q0`, selectedAnswer: null }], 'must be an integer'],
    [[{ questionId: `${quizId}-q0`, selectedAnswer: true }], 'must be an integer'],
    [[{ questionId: `${quizId}-q0`, selectedAnswer: '0' }], 'must be an integer'],
    [[{ questionId: `${quizId}-q0`, selectedAnswer: 0 }, { questionId: `${quizId}-q0`, selectedAnswer: 1 }], 'only be answered once'],
    [[{ questionId: 'other-quiz-q0', selectedAnswer: 0 }], 'does not belong'],
  ])('rejects invalid answer payloads: %s', (answers, message) => {
    expect(() => normalizeAttemptAnswers(quizId, 'attempt-invalid', questions, answers as any)).toThrow(message);
  });
});

function setupSnapshotSubmission({ status = 'in-progress', score = 0 }: { status?: string; score?: number } = {}) {
  const notify = jest.fn().mockResolvedValue({ error: null });
  const snapshot = {
    id: quizId,
    title: 'Exam',
    teacher_id: 'teacher-1',
    questions,
  };
  const attempt = {
    id: 'attempt-1',
    user_id: 'student-1',
    quiz_id: quizId,
    status,
    score,
    max_score: questions.length,
    started_at: new Date().toISOString(),
    teacher_quiz_snapshot: snapshot,
  };
  mockFrom.mockImplementation((table: string) => {
    if (table === 'quiz_attempts') {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: attempt, error: null }) }) }) }),
      };
    }
    if (table === 'cheating_violations') {
      return { select: () => ({ in: () => ({ order: async () => ({ data: [], error: null }) }) }) };
    }
    if (table === 'notifications') return { insert: notify };
    if (table === 'teacher_quizzes') return { select: () => ({ eq: () => ({ single: async () => ({ data: { teacher_id: 'current-teacher' }, error: null }) }) }) };
    throw new Error(`Unexpected table ${table}`);
  });
  mockRpc.mockImplementation(async (fn: string, params: any) => {
    if (fn !== 'teacher_attempt_action') throw new Error(`Unexpected RPC ${fn}`);
    if (params.p_action === 'answer') {
      return { data: { ...attempt, status: 'in-progress' }, error: null };
    }
    if (params.p_action === 'submit') {
      return {
        data: {
          ...attempt,
          status: 'completed',
          score: 1,
          max_score: questions.length,
          newlyCompleted: true,
        },
        error: null,
      };
    }
    throw new Error(`Unexpected action ${params.p_action}`);
  });
  return { attempt, snapshot, notify };
}

describe('snapshot-backed submission and resubmission guard', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockAssertStudentEmailPolicy.mockClear();
  });

  it('sends canonical answers to the server-owned snapshot and returns 1/3 (33%)', async () => {
    const { notify } = setupSnapshotSubmission();

    await expect(quizService.submitAllAnswers('attempt-1', 'student-1', answersWithOnlyQ3Correct('attempt-1')))
      .resolves.toMatchObject({ score: 1, maxScore: 3, percentage: 33 });
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'teacher_attempt_action', expect.objectContaining({
      p_action: 'answer',
      p_answers: expect.arrayContaining([
        expect.objectContaining({ questionId: `${quizId}-q0`, selectedAnswer: 1, isCorrect: false }),
        expect.objectContaining({ questionId: `${quizId}-q1`, selectedAnswer: 0, isCorrect: false }),
        expect.objectContaining({ questionId: `${quizId}-q2`, selectedAnswer: 2, isCorrect: true }),
      ]),
    }));
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'teacher_attempt_action', expect.objectContaining({ p_action: 'submit' }));
    expect(notify).toHaveBeenCalledWith([expect.objectContaining({ user_id: 'current-teacher' })]);
  });

  it('returns the existing completed result for a stale duplicate submit without parsing or writing it again', async () => {
    setupSnapshotSubmission({ status: 'completed', score: 1 });
    await expect(quizService.submitAllAnswers('attempt-1', 'student-1', [
      { questionId: `${quizId}-q0`, selectedAnswer: true as any },
    ])).resolves.toMatchObject({ score: 1, maxScore: 3, percentage: 33, status: 'completed' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('requires migration 027 before accepting a legacy in-progress teacher exam', async () => {
    const attempt = { id: 'attempt-1', user_id: 'student-1', quiz_id: quizId, status: 'in-progress' };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: attempt, error: null }) }) }) }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(quizService.submitAllAnswers('attempt-1', 'student-1', []))
      .rejects.toMatchObject({ statusCode: 503 });
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

  it('never releases the answer key for an active attempt even if a grade is present', async () => {
    setupResult({ id: 'attempt-1', user_id: 'student-1', quiz_id: quizId, status: 'in-progress', score: 1, max_score: 3, answers: [], teacher_grade: 33 });

    const result = await quizService.getAttemptResults('attempt-1', 'student-1', 'student');
    expect(result).toMatchObject({ reviewPending: true, quiz: { questions: [] } });
    expect(result).not.toHaveProperty('answers');
    expect(result).not.toHaveProperty('score');
  });
});

describe('completed-attempt review boundary', () => {
  const update = jest.fn();
  const statusFilter = jest.fn();
  function setup(status: string, rows: any[] = [{ id: 'attempt-1' }]) {
    update.mockReset();
    statusFilter.mockReset().mockReturnValue({ select: async () => ({ data: rows, error: null }) });
    update.mockReturnValue({ eq: () => ({ eq: statusFilter }) });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') return {
        select: () => ({ eq: () => ({ single: async () => ({ data: { quiz_id: quizId, user_id: 'student-1', status }, error: null }) }) }),
        update,
      };
      if (table === 'teacher_quizzes') return { select: () => ({ eq: () => ({ single: async () => ({ data: { teacher_id: 'teacher-1', title: 'Exam' }, error: null }) }) }) };
      if (table === 'notifications') return { insert: async () => ({ error: null }) };
      throw new Error(`Unexpected table ${table}`);
    });
  }

  it('rejects early review and does not write a grade', async () => {
    setup('in-progress');
    await expect(quizService.gradeSubmission('attempt-1', 'teacher-1', 33, 'Reviewed')).rejects.toMatchObject({ statusCode: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it('permits completed review only with an atomic completed-status predicate', async () => {
    setup('completed');
    await expect(quizService.gradeSubmission('attempt-1', 'teacher-1', 33, 'Reviewed')).resolves.toEqual({ success: true });
    expect(statusFilter).toHaveBeenCalledWith('status', 'completed');
    setup('completed', []);
    await expect(quizService.gradeSubmission('attempt-1', 'teacher-1', 33, 'Reviewed')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects another teacher and invalid review input', async () => {
    setup('completed');
    await expect(quizService.gradeSubmission('attempt-1', 'teacher-2', 33, 'Reviewed')).rejects.toThrow('Unauthorized');
    await expect(quizService.gradeSubmission('attempt-1', 'teacher-1', NaN, '')).rejects.toMatchObject({ statusCode: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});
