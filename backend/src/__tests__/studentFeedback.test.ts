process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));

import { feedbackService, FEEDBACK_SCHEMA_REQUIRED, FeedbackInput } from '../services/feedbackService';
import { authorize } from '../middleware/auth';

const valid: FeedbackInput = {
  attemptId: 'attempt-1', rating: 4, category: 'content', liked: 'Clear questions',
  improvements: 'More examples would help', wouldRecommend: true,
};

function setup(options: { attempt?: any; attemptError?: any; writeError?: any; readError?: any } = {}) {
  let saved: any = null;
  let inserts = 0;
  const attempt = options.attempt === undefined
    ? { id: 'attempt-1', user_id: 'student-1', quiz_id: 'exam-1', topic_id: null, status: 'completed' }
    : options.attempt;
  mockFrom.mockImplementation((table: string) => {
    if (table === 'quiz_attempts') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: attempt, error: options.attemptError || null }) }) }) };
    if (table === 'student_feedback') return {
      insert: (row: any) => ({ select: () => ({ single: async () => {
        inserts += 1;
        if (options.writeError) return { data: null, error: options.writeError };
        if (saved) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        saved = { id: 'feedback-1', created_at: '2026-01-01T00:00:00Z', ...row };
        return { data: { id: saved.id, created_at: saved.created_at }, error: null };
      } }) }),
      select: () => ({ order: () => ({ limit: async () => ({
        data: saved ? [{ ...saved, users: { name: 'Student One' }, teacher_quizzes: { title: 'Exam One' } }] : [],
        error: options.readError || null,
      }) }) }),
    };
    throw new Error(`Unexpected table ${table}`);
  });
  return { getSaved: () => saved, getInserts: () => inserts };
}

beforeEach(() => mockFrom.mockReset());

describe('student exam feedback', () => {
  it('saves a completed attempt with the route field names and lets admins read it', async () => {
    const state = setup();
    await expect(feedbackService.submit('student-1', valid)).resolves.toMatchObject({ id: 'feedback-1' });
    expect(state.getSaved()).toMatchObject({ attempt_id: 'attempt-1', student_id: 'student-1', quiz_id: 'exam-1', rating: 4,
      category: 'content', improvements: valid.improvements, would_recommend: true });
    await expect(feedbackService.getForAdmins()).resolves.toEqual([expect.objectContaining({ id: 'feedback-1', teacher_quizzes: { title: 'Exam One' } })]);
  });

  it('rejects invalid values before storage', async () => {
    const state = setup();
    await expect(feedbackService.submit('student-1', { ...valid, rating: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(feedbackService.submit('student-1', { ...valid, rating: 2.5 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(feedbackService.submit('student-1', { ...valid, category: 'other' as any })).rejects.toMatchObject({ statusCode: 400 });
    await expect(feedbackService.submit('student-1', { ...valid, improvements: '    ' })).rejects.toMatchObject({ statusCode: 400 });
    expect(state.getInserts()).toBe(0);
  });

  it('rejects missing, foreign, incomplete and topic attempts before insertion', async () => {
    setup({ attempt: null });
    await expect(feedbackService.submit('student-1', valid)).rejects.toMatchObject({ statusCode: 404 });
    setup();
    await expect(feedbackService.submit('student-2', valid)).rejects.toMatchObject({ statusCode: 403 });
    setup({ attempt: { id: 'attempt-1', user_id: 'student-1', quiz_id: 'exam-1', topic_id: null, status: 'in-progress' } });
    await expect(feedbackService.submit('student-1', valid)).rejects.toMatchObject({ statusCode: 400 });
    setup({ attempt: { id: 'attempt-1', user_id: 'student-1', quiz_id: 'topic-exam', topic_id: 'topic-1', status: 'completed' } });
    await expect(feedbackService.submit('student-1', valid)).rejects.toThrow('teacher exams only');
  });

  it('allows one insert under repeated requests and reports a duplicate clearly', async () => {
    const state = setup();
    const results = await Promise.allSettled([feedbackService.submit('student-1', valid), feedbackService.submit('student-1', valid)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')[0]).toMatchObject({ reason: { statusCode: 409, message: 'Feedback has already been submitted for this attempt' } });
    expect(state.getSaved().id).toBe('feedback-1');
  });

  it('distinguishes lookup, missing-schema and temporary write/read failures', async () => {
    setup({ attemptError: { message: 'connection lost' } });
    await expect(feedbackService.submit('student-1', valid)).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('verify') });
    setup({ writeError: { code: 'PGRST205', message: 'student_feedback missing' }, readError: { code: '42P01', message: 'missing' } });
    await expect(feedbackService.submit('student-1', valid)).rejects.toMatchObject({ statusCode: 503, message: FEEDBACK_SCHEMA_REQUIRED });
    await expect(feedbackService.getForAdmins()).rejects.toMatchObject({ statusCode: 503, message: FEEDBACK_SCHEMA_REQUIRED });
    setup({ writeError: { message: 'connection lost' }, readError: { message: 'connection lost' } });
    await expect(feedbackService.submit('student-1', valid)).rejects.toMatchObject({ statusCode: 503, message: 'Feedback could not be saved right now. Please retry.' });
    await expect(feedbackService.getForAdmins()).rejects.toMatchObject({ statusCode: 503, message: 'Student feedback could not be loaded right now. Please retry.' });
    setup();
    await expect(feedbackService.submit('student-1', valid)).resolves.toMatchObject({ id: 'feedback-1' });
  });

  it('keeps the write student-only and the admin inbox admin-only', () => {
    const status = jest.fn().mockReturnValue({ json: jest.fn() });
    const next = jest.fn();
    authorize('student')({ user: { _id: 'teacher-1', role: 'teacher' } } as any, { status } as any, next);
    expect(status).toHaveBeenCalledWith(403);
    authorize('admin')({ user: { _id: 'student-1', role: 'student' } } as any, { status } as any, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
