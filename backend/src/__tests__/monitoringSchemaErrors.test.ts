const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
import { cheatingViolationService } from '../services/cheatingViolationService';

const input = { quizAttemptId: 'attempt', studentId: 'student', quizId: 'exam',
  violationType: 'tab_change' as const, detectionMethod: 'browser_event', eventId: 'stable-event' };
function setup(error: any, atomic = false) {
  const attemptQuery: any = { select: () => attemptQuery, eq: () => attemptQuery,
    single: async () => ({ data: { id: 'attempt', quiz_id: 'exam', user_id: 'student', status: 'in-progress',
      topic_id: atomic ? null : 'topic', teacher_quiz_snapshot: atomic ? { questions: [] } : null }, error: null }) };
  mockFrom.mockImplementation(table => {
    if (table === 'quiz_attempts') return attemptQuery;
    if (table === 'teacher_quizzes') return { select: () => ({ eq: () => ({ single: async () => ({ data: { teacher_id: 'teacher', violation_limit: 3 }, error: null }) }) }) };
    if (table === 'cheating_violations') return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error }) }) }) };
    throw new Error(`Unexpected ${table}`);
  });
  mockRpc.mockResolvedValue({ data: null, error });
}
beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });

it.each(['event_id', 'violation_count', 'violations'])('identifies the actual missing monitoring field %s', async column => {
  setup({ code: '42703', message: `column ${column} does not exist` });
  await expect(cheatingViolationService.reportViolation(input)).rejects.toMatchObject({ statusCode: 503,
    message: expect.stringContaining('019_make_cheating_events_authoritative.sql') });
});
it('recognizes a PostgREST missing-column cache error', async () => {
  setup({ code: 'PGRST204', message: "Could not find the 'event_id' column in the schema cache" });
  await expect(cheatingViolationService.reportViolation(input)).rejects.toMatchObject({ statusCode: 503,
    message: expect.stringContaining('019_make_cheating_events_authoritative.sql') });
});
it.each([
  { code: '42703', message: 'column cheating_violations.unrelated_field does not exist' },
  { code: '42501', message: 'permission denied for table cheating_violations' },
  { code: '08006', message: 'connection to cheating_violations failed' },
])('does not mislabel unrelated/permission/connectivity errors as missing migration 019: %j', async error => {
  setup(error);
  try { await cheatingViolationService.reportViolation(input); throw new Error('Expected rejection'); }
  catch (failure: any) { expect(failure.message).toBe(error.message); expect(failure.message).not.toContain('019_'); }
});
it('an atomic teacher writer missing event_id requests migration 019, not the timing migration', async () => {
  setup({ code: '42703', message: 'column event_id does not exist' }, true);
  await expect(cheatingViolationService.reportViolation(input)).rejects.toMatchObject({ statusCode: 503,
    message: expect.stringContaining('019_make_cheating_events_authoritative.sql') });
});
it('a missing ON CONFLICT deduplication index is identified as migration 019', async () => {
  setup({ code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }, true);
  await expect(cheatingViolationService.reportViolation(input)).rejects.toMatchObject({ statusCode: 503,
    message: expect.stringContaining('019_make_cheating_events_authoritative.sql') });
});
it('an atomic writer permission failure is not misdiagnosed as timing setup', async () => {
  const error = { code: '42501', message: 'permission denied for function report_teacher_violation' };
  setup(error, true);
  await expect(cheatingViolationService.reportViolation(input)).rejects.toThrow(error.message);
});
it.each([
  { code: 'PGRST202', message: 'Could not find the function public.report_teacher_violation in the schema cache' },
  { code: '42703', message: 'column teacher_quiz_snapshot does not exist' },
])('actual missing timing schema still requires migration 027: %j', async error => {
  setup(error, true);
  await expect(cheatingViolationService.reportViolation(input)).rejects.toMatchObject({ statusCode: 503,
    message: expect.stringContaining('027_teacher_attempt_deadlines.sql') });
});
