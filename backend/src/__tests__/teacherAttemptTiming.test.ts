process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAssertStudentEmailPolicy = jest.fn();

jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: mockAssertStudentEmailPolicy }));

import { optionOrderForAttempt, quizService } from '../services/quizService';

const quizId = 'quiz-123';
const attemptId = 'attempt-123';
const studentId = 'student-123';
const questions = [
  { text: 'Q1', options: ['A', 'B', 'C'], correctAnswer: 2, difficulty: 'Easy', answerText: 'hidden' },
  { text: 'Q2', options: ['D', 'E'], correctAnswer: 0, difficulty: 'Medium' },
];
const snapshot = {
  id: quizId,
  title: 'Immutable exam title',
  teacher_id: 'former-teacher',
  questions,
  time_limit: 60,
};

const isoDeadline = '2030-01-01T00:01:00.000Z';
const isoActivated = '2030-01-01T00:00:00.000Z';

function snapshotAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: attemptId,
    user_id: studentId,
    quiz_id: quizId,
    status: 'in-progress',
    score: 0,
    max_score: questions.length,
    teacher_quiz_snapshot: snapshot,
    teacher_question_state: {
      [`${quizId}-q0`]: {
        activatedAt: isoActivated,
        deadlineAt: isoDeadline,
        answer: {
          questionId: `${quizId}-q0`,
          selectedAnswer: 2,
          isCorrect: true,
          questionType: 'multipleChoice',
          answerVersion: 2,
        },
      },
    },
    serverNow: '2030-01-01T00:00:20.000Z',
    ...overrides,
  };
}

function setupAttemptLookup(attempt: Record<string, unknown>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'quiz_attempts') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: attempt, error: null }) }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

describe('teacher attempt timing service boundary', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockAssertStudentEmailPolicy.mockReset().mockResolvedValue(undefined);
  });

  it('uses the persisted activation deadline and strips snapshot answer keys from the active-attempt DTO', async () => {
    const attempt = snapshotAttempt();
    mockRpc.mockResolvedValue({ data: attempt, error: null });

    const result = await quizService.getActiveTeacherAttempt(attemptId, studentId);

    if (!('questionStates' in result)) throw new Error('Expected an active attempt, not a completed summary');
    expect(result.questionStates[`${quizId}-q0`]).toEqual({ activatedAt: isoActivated, deadlineAt: isoDeadline });
    expect(result.savedAnswers[`${quizId}-q0`]).toBe(
      optionOrderForAttempt(questions[0].options.length, attemptId, 0).indexOf(2),
    );
    expect(JSON.stringify(result)).not.toContain('correctAnswer');
    expect(JSON.stringify(result)).not.toContain('answerText');
    expect(JSON.stringify(result)).not.toContain('isCorrect');
    expect(JSON.stringify(result)).not.toContain('teacher_quiz_snapshot');
    expect(result).not.toHaveProperty('score');
  });

  it('returns the server-provided first-activation deadline unchanged when the question is revisited', async () => {
    const attempt = snapshotAttempt();
    mockRpc.mockResolvedValue({ data: attempt, error: null });

    const first = await quizService.activateTeacherAttemptQuestion(attemptId, studentId, `${quizId}-q0`);
    const second = await quizService.activateTeacherAttemptQuestion(attemptId, studentId, `${quizId}-q0`);

    expect(first).toMatchObject({ activatedAt: isoActivated, deadlineAt: isoDeadline });
    expect(second).toEqual(first);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenLastCalledWith('teacher_attempt_action', expect.objectContaining({
      p_action: 'activate',
      p_question_id: `${quizId}-q0`,
      p_answers: [],
    }));
  });

  it('returns an actionable migration failure instead of fabricating an active timer when the RPC is unavailable', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function public.teacher_attempt_action does not exist' },
    });

    await expect(quizService.getActiveTeacherAttempt(attemptId, studentId)).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining('027_teacher_attempt_deadlines.sql'),
    });
  });

  it.each([
    { code: 'PGRST202', message: 'Could not find the function public.teacher_attempt_action in the schema cache' },
    { code: '42703', message: 'column teacher_question_state does not exist' },
    { code: 'PGRST204', message: "Could not find the 'teacher_quiz_snapshot' column in the schema cache" },
  ])('identifies an actual missing timing object: %j', async error => {
    mockRpc.mockResolvedValue({ data: null, error });
    await expect(quizService.getActiveTeacherAttempt(attemptId, studentId)).rejects.toMatchObject({
      statusCode: 503, code: 'TEACHER_TIMING_SCHEMA_REQUIRED',
    });
  });

  it.each([
    'Legacy teacher exam attempt requires administrator review',
    'Teacher exam timing migration is required for this attempt',
  ])('requires review of a legacy attempt instead of asking for schema reinstallation: %s', async message => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
    await expect(quizService.getActiveTeacherAttempt(attemptId, studentId)).rejects.toMatchObject({
      statusCode: 409, code: 'LEGACY_TEACHER_ATTEMPT_REVIEW_REQUIRED',
      message: expect.stringContaining('cannot be resumed'),
    });
  });

  it('never fabricates a timer from a returned legacy row without a snapshot', async () => {
    mockRpc.mockResolvedValue({ data: snapshotAttempt({ teacher_quiz_snapshot: null }), error: null });
    await expect(quizService.getActiveTeacherAttempt(attemptId, studentId)).rejects.toMatchObject({
      statusCode: 409, code: 'LEGACY_TEACHER_ATTEMPT_REVIEW_REQUIRED',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('teacher_attempt_action', expect.objectContaining({ p_action: 'read' }));
  });

  it.each([
    { code: '42501', message: 'permission denied for function teacher_attempt_action' },
    { code: '08006', message: 'connection failed during teacher_attempt_action' },
    { code: '42703', message: 'column unrelated_field does not exist' },
    { code: '42883', message: 'function unrelated_function does not exist' },
    { code: 'PGRST002', message: 'Could not query the database for the schema cache' },
  ])('does not misdiagnose an unrelated error as migration 027: %j', async error => {
    mockRpc.mockResolvedValue({ data: null, error });
    await expect(quizService.getActiveTeacherAttempt(attemptId, studentId)).rejects.toMatchObject({
      message: error.message,
    });
  });

  it('does not accept a changed answer after the authoritative deadline', async () => {
    const attempt = snapshotAttempt({ teacher_question_state: { [`${quizId}-q0`]: { activatedAt: isoActivated, deadlineAt: isoDeadline } } });
    setupAttemptLookup(attempt);
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Question deadline has passed' } });

    const displayedCorrect = optionOrderForAttempt(questions[0].options.length, attemptId, 0).indexOf(2);
    await expect(quizService.saveTeacherAttemptAnswer(attemptId, studentId, `${quizId}-q0`, displayedCorrect))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mockRpc).toHaveBeenCalledWith('teacher_attempt_action', expect.objectContaining({
      p_action: 'answer',
      p_answers: [expect.objectContaining({ selectedAnswer: 2, isCorrect: true })],
    }));
  });
});

describe('review ownership follows the live teacher assignment', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  function setupReview(liveTeacherId: string) {
    const attempt = snapshotAttempt({
      status: 'completed',
      score: 1,
      teacher_grade: 50,
      teacher_feedback: '',
      answers: [],
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: attempt, error: null }) }) }) };
      }
      if (table === 'teacher_quizzes') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { id: quizId, title: 'Live exam', description: '', teacher_id: liveTeacherId, questions }, error: null }),
            }),
          }),
        };
      }
      if (table === 'cheating_violations') {
        return { select: () => ({ in: () => ({ order: async () => ({ data: [], error: null }) }) }) };
      }
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Student', email: 'student@example.test' }, error: null }) }) }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });
  }

  it('denies a former snapshot owner and allows the current live owner to review', async () => {
    setupReview('current-teacher');
    await expect(quizService.getAttemptResults(attemptId, 'former-teacher', 'teacher'))
      .rejects.toThrow('Unauthorized');

    setupReview('current-teacher');
    await expect(quizService.getAttemptResults(attemptId, 'current-teacher', 'teacher'))
      .resolves.toMatchObject({ score: 1, studentName: 'Student', quiz: { title: 'Immutable exam title' } });
  });

  it('maps current-owner quiz objects to snapshot-backed submission rows', async () => {
    const liveQuiz = { id: quizId, title: 'Live exam', teacher_id: 'current-teacher', questions };
    const attempt = snapshotAttempt({
      status: 'completed',
      score: 1,
      answers: [{
        questionId: `${quizId}-q0`,
        selectedAnswer: 2,
        isCorrect: true,
        questionType: 'multipleChoice',
        answerVersion: 2,
      }],
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'teacher_quizzes') {
        return { select: () => ({ eq: async () => ({ data: [liveQuiz], error: null }) }) };
      }
      if (table === 'quiz_attempts') {
        return {
          select: () => ({
            in: () => ({ eq: () => ({ order: async () => ({ data: [attempt], error: null }) }) }),
          }),
        };
      }
      if (table === 'users') {
        return { select: () => ({ in: async () => ({ data: [{ id: studentId, name: 'Student', email: 'student@example.test' }], error: null }) }) };
      }
      if (table === 'cheating_violations') {
        return { select: () => ({ in: () => ({ order: async () => ({ data: [], error: null }) }) }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(quizService.getTeacherSubmissions('current-teacher')).resolves.toEqual([
      expect.objectContaining({
        id: attemptId,
        quizId,
        quizTitle: 'Immutable exam title',
        studentName: 'Student',
        answers: [expect.objectContaining({ questionId: `${quizId}-q0`, selectedAnswer: 2 })],
      }),
    ]);
  });
});
