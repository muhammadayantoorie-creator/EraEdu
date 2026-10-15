const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));

import { cheatingViolationService } from '../services/cheatingViolationService';

const attempt = {
  id: 'attempt-1', user_id: 'student-1', quiz_id: 'exam-1', status: 'in-progress',
  topic_id: null, teacher_quiz_snapshot: { id: 'exam-1', questions: [] },
};
const input = {
  quizAttemptId: attempt.id, studentId: attempt.user_id, quizId: 'untrusted-exam-id',
  teacherId: 'untrusted-teacher-id', violationType: 'TAB_SWITCH' as const,
  detectionMethod: 'browser_event', eventId: 'event-1',
};

function lookup(row: any = attempt, error: any = null) {
  const query: any = { select: jest.fn(), eq: jest.fn(), single: jest.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.single.mockResolvedValue({ data: row, error });
  mockFrom.mockReturnValue(query);
  return query;
}

beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });

describe('teacher integrity event persistence', () => {
  it('passes authenticated identity, a normalized type and stable event ID to the atomic writer', async () => {
    const query = lookup();
    const persisted = { violationId: 'row-1', violationCount: 1, autoSubmitted: false, remainingViolations: 2 };
    mockRpc.mockResolvedValue({ data: persisted, error: null });
    await expect(cheatingViolationService.reportViolation(input)).resolves.toEqual(persisted);
    expect(query.eq).toHaveBeenCalledWith('user_id', 'student-1');
    expect(mockRpc).toHaveBeenCalledWith('report_teacher_violation', {
      p_student_id: 'student-1', p_attempt_id: 'attempt-1',
      p_event: { violationType: 'tab_change', eventId: 'event-1', detectionMethod: 'browser_event', severity: 'low', details: {} },
    });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('untrusted');
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('retries the same event identity without synthesizing a higher count', async () => {
    lookup();
    const response = { violationId: 'row-1', violationCount: 1, autoSubmitted: false };
    mockRpc.mockResolvedValue({ data: response, error: null });
    const first = await cheatingViolationService.reportViolation(input);
    const retry = await cheatingViolationService.reportViolation(input);
    expect(first).toEqual(retry);
    expect(mockRpc.mock.calls[0]).toEqual(mockRpc.mock.calls[1]);
  });

  it('propagates temporary write failure and permits retry with the original event ID', async () => {
    lookup();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'temporary network failure' } })
      .mockResolvedValueOnce({ data: { violationId: 'row-1', violationCount: 1 }, error: null });
    await expect(cheatingViolationService.reportViolation(input)).rejects.toThrow('temporary network failure');
    await expect(cheatingViolationService.reportViolation(input)).resolves.toMatchObject({ violationCount: 1 });
    expect(mockRpc.mock.calls[0]).toEqual(mockRpc.mock.calls[1]);
  });

  it('allows the atomic writer to preserve a report racing a completed submit', async () => {
    lookup({ ...attempt, status: 'completed' });
    mockRpc.mockResolvedValue({ data: { violationId: 'row-2', violationCount: 2, alreadySubmitted: true, autoSubmitted: false }, error: null });
    await expect(cheatingViolationService.reportViolation({ ...input, eventId: 'event-2' }))
      .resolves.toMatchObject({ violationCount: 2, alreadySubmitted: true });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('returns the threshold outcome without a second application-side attempt update', async () => {
    lookup();
    mockRpc.mockResolvedValue({ data: { violationCount: 3, violationLimit: 3, autoSubmitted: true }, error: null });
    await expect(cheatingViolationService.reportViolation(input)).resolves.toMatchObject({ autoSubmitted: true });
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('never calls the writer for another student\'s missing/foreign attempt', async () => {
    const query = lookup(null);
    await expect(cheatingViolationService.reportViolation({ ...input, studentId: 'student-2' })).rejects.toThrow('Exam attempt not found');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'student-2');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(['42883', '42703', 'PGRST202'])('missing timing schema is actionable (%s)', async code => {
    lookup();
    mockRpc.mockResolvedValue({ data: null, error: { code, message: 'report_teacher_violation is not in schema cache' } });
    await expect(cheatingViolationService.reportViolation(input)).rejects.toMatchObject({
      statusCode: 503, message: expect.stringContaining('027_teacher_attempt_deadlines.sql'),
    });
  });

  it('requires a stable retry ID and valid event metadata before any database write', async () => {
    for (const invalid of [{ eventId: undefined }, { eventId: '' }, { violationType: null }, { detectionMethod: {} }]) {
      await expect(cheatingViolationService.reportViolation({ ...input, ...invalid } as any)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('integrity detail visibility', () => {
  it.each(['student-1', 'student-2'])('does not expose review-only detail to student %s', async requester => {
    lookup();
    await expect(cheatingViolationService.getViolationsForAttempt('attempt-1', requester, 'student'))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mockFrom.mock.calls.map(([table]) => table)).toEqual(['quiz_attempts']);
  });

  it('denies a teacher who does not currently manage the exam', async () => {
    const query = lookup();
    query.single.mockResolvedValueOnce({ data: attempt, error: null })
      .mockResolvedValueOnce({ data: { teacher_id: 'teacher-1' }, error: null });
    await expect(cheatingViolationService.getViolationsForAttempt('attempt-1', 'teacher-2', 'teacher'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns structured detail and an honest empty list for authorized admin review', async () => {
    const query = lookup();
    query.order = jest.fn().mockResolvedValue({ data: [], error: null });
    await expect(cheatingViolationService.getViolationsForAttempt('attempt-1', 'admin-1', 'admin')).resolves.toEqual([]);
    query.order.mockResolvedValue({ data: [{ violation_type: 'focus_loss', timestamp: '2026-10-13T10:00:00Z', details: { alertMessage: 'Focus changed' }, severity: 'low', detection_method: 'browser_event' }], error: null });
    await expect(cheatingViolationService.getViolationsForAttempt('attempt-1', 'admin-1', 'admin')).resolves.toEqual([
      expect.objectContaining({ type: 'focus_loss', severity: 'low', detectionMethod: 'browser_event', details: { alertMessage: 'Focus changed' } }),
    ]);
  });
});
