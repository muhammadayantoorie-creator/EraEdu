process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));

import { adminService } from '../services/adminService';
import { authorize } from '../middleware/auth';

beforeEach(() => mockFrom.mockReset());

const setup = (rows: any[], total: number | null, error: any = null) => {
  const range = jest.fn().mockResolvedValue({ data: rows, count: total, error });
  mockFrom.mockImplementation((table: string) => ({
    select: (_columns: string, options?: { head?: boolean }) => options?.head
      ? Promise.resolve({ count: table === 'cheating_violations' ? total : 0, error })
      : table === 'users'
        ? Promise.resolve({ data: [], error: null })
        : { order: () => ({ range }) },
  }));
  return range;
};

describe('admin integrity event drill-down', () => {
  it('paginates the same all-time event population as the overview count', async () => {
    const range = setup([{ id: 'event-51', quiz_attempt_id: 'attempt-2', violation_type: 'tab_change', timestamp: '2026-01-01', quiz_attempts: { is_flagged: true, teacher_grade: null }, users: { name: 'Student' }, teacher_quizzes: { title: 'Exam', courses: { title: 'Course' } } }], 51);
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
});
