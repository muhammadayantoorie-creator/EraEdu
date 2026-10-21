process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));

import { adminService } from '../services/adminService';
import { authorize } from '../middleware/auth';

beforeEach(() => mockFrom.mockReset());

const setup = (rows: any[], total: number | null, error: any = null, lookupFailure = '') => {
  const range = jest.fn().mockResolvedValue({ data: rows, count: total, error });
  const records: Record<string, any[]> = {
    quiz_attempts: [{ id: 'attempt-2', user_id: 'student', quiz_id: 'exam', is_flagged: true, teacher_grade: null },
      { id: 'topic-attempt', user_id: 'student', quiz_id: 'topic-exam', topic_id: 'topic', teacher_grade: 0 }],
    users: [{ id: 'student', name: 'Student' }], teacher_quizzes: [{ id: 'exam', title: 'Exam', course_id: 'course' }],
    quizzes: [{ id: 'topic-exam', title: 'Topic exam', topic_id: 'topic' }],
    topics: [{ id: 'topic', course_id: 'course' }], courses: [{ id: 'course', title: 'Course' }],
  };
  mockFrom.mockImplementation((table: string) => ({
    select: (columns: string, options?: { head?: boolean }) => options?.head
      ? Promise.resolve({ count: table === 'cheating_violations' ? total : 0, error })
      : table === 'users' && columns === 'role, is_suspended'
        ? Promise.resolve({ data: [], error: null })
        : { order: () => ({ range }), in: async (_key: string, ids: string[]) => ({
          data: (records[table] || []).filter(row => ids.includes(row.id)),
          error: table === lookupFailure ? { message: 'Lookup unavailable' } : null,
        }) },
  }));
  return range;
};

describe('admin integrity event drill-down', () => {
  it('paginates the same all-time event population as the overview count', async () => {
    const range = setup([{ id: 'event-51', quiz_attempt_id: 'attempt-2', student_id: 'student', quiz_id: 'exam', violation_type: 'tab_change', timestamp: '2026-01-01' }], 51);
    const overview = await adminService.getOverview();
    const page = await adminService.getIntegrityEvents(2, 50);
    expect(overview.violations).toBe(51);
    expect(page.pagination).toMatchObject({ page: 2, limit: 50, total: overview.violations });
    expect(range).toHaveBeenCalledWith(50, 99);
    expect(page.data[0]).toMatchObject({ id: 'event-51', attemptId: 'attempt-2', studentName: 'Student', assessment: 'Exam', course: 'Course', flagged: true, reviewed: false });
  });

  it('reports a true empty result and surfaces database/count failures', async () => {
    setup([], 0);
    await expect(adminService.getIntegrityEvents()).resolves.toMatchObject({ data: [], pagination: { total: 0 } });
    setup([], null);
    await expect(adminService.getIntegrityEvents()).rejects.toThrow('Failed to count integrity events');
    setup([], null, { message: 'database unavailable' });
    await expect(adminService.getIntegrityEvents()).rejects.toThrow('database unavailable');
  });

  it('keeps admin records inaccessible to non-admin roles', () => {
    const status = jest.fn().mockReturnValue({ json: jest.fn() });
    const next = jest.fn();
    authorize('admin')({ user: { _id: 'teacher-1', role: 'teacher' } } as any, { status } as any, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('resolves topic exams and retains a real reviewed zero without assuming a teacher-exam foreign key', async () => {
    setup([{ id: 'topic-event', quiz_attempt_id: 'topic-attempt', student_id: 'student', quiz_id: 'topic-exam' }], 1);
    const page = await adminService.getIntegrityEvents();
    expect(page.data[0]).toMatchObject({ assessment: 'Topic exam', course: 'Course', studentName: 'Student', reviewed: true });
  });

  it('surfaces failed lookup data instead of fabricating unknown names and flags', async () => {
    setup([{ id: 'event', quiz_attempt_id: 'attempt-2', student_id: 'student', quiz_id: 'exam' }], 1, null, 'users');
    await expect(adminService.getIntegrityEvents()).rejects.toThrow('Lookup unavailable');
  });
});
