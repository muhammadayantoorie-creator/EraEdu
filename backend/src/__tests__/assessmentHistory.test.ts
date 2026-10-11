process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
jest.mock('../services/emailService', () => ({ emailService: {} }));

import { adminService } from '../services/adminService';
import { courseService } from '../services/courseService';
import { quizService } from '../services/quizService';
import { authorize } from '../middleware/auth';
import { explainProtectedDelete } from '../services/assessmentHistoryPolicy';

beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });

const attempts = [
  { id: 'historical', user_id: 'student-1', quiz_id: 'teacher-quiz', topic_id: null, status: 'completed', score: 2, max_score: 3, started_at: '2025-01-01' },
  { id: 'topic-attempt', user_id: 'student-1', quiz_id: 'topic-quiz', topic_id: 'topic-1', status: 'completed', score: 1, max_score: 2, started_at: '2025-01-02' },
  { id: 'orphan', user_id: 'student-1', quiz_id: 'missing-quiz', topic_id: null, status: 'completed', score: 0, max_score: 2, started_at: '2025-01-03' },
];

function setupOverviewAndDrilldown(rows = attempts, total: number | null = rows.length, failure: any = null) {
  mockFrom.mockImplementation((table: string) => ({
    select: (columns: string, options?: { head?: boolean }) => {
      if (options?.head) return Promise.resolve({ count: table === 'quiz_attempts' ? total : 0, error: table === 'quiz_attempts' ? failure : null });
      if (table === 'users' && columns === 'role, is_suspended') return Promise.resolve({ data: [], error: null });
      if (table === 'quiz_attempts') return { order: () => ({ range: async () => ({ data: rows, count: total, error: failure }) }) };
      const data: Record<string, any[]> = {
        teacher_quizzes: [{ id: 'teacher-quiz', title: 'Teacher exam', course_id: 'course-1' }],
        quizzes: [{ id: 'topic-quiz', title: 'Topic exam', topic_id: 'topic-1' }],
        topics: [{ id: 'topic-1', title: 'Vectors', course_id: 'course-1' }],
        users: [{ id: 'student-1', name: 'Student', email: 'student@example.test' }],
        courses: [{ id: 'course-1', title: 'Historical course', is_published: false }],
      };
      return { in: async (_field: string, ids: string[]) => ({ data: (data[table] || []).filter(row => ids.includes(row.id)), error: null }) };
    },
  }));
}

describe('admin assessment history', () => {
  it('uses the same all-time count and distinguishes teacher, topic, and orphan attempts', async () => {
    setupOverviewAndDrilldown();
    const overview = await adminService.getOverview();
    const page = await adminService.getAttempts();
    expect(overview.attempts).toBe(3);
    expect(page.pagination.total).toBe(overview.attempts);
    expect(page.data[0]).toMatchObject({ id: 'historical', assessmentType: 'Teacher exam', course: 'Historical course', coursePublished: false, referenceIssues: [] });
    expect(page.data[1]).toMatchObject({ id: 'topic-attempt', assessmentType: 'Topic exam', topic: 'Vectors', referenceIssues: [] });
    expect(page.data[2].referenceIssues).toContain('Missing teacher exam');
  });

  it('returns zero only for a genuinely empty attempt table', async () => {
    setupOverviewAndDrilldown([]);
    await expect(adminService.getAttempts()).resolves.toMatchObject({ data: [], pagination: { total: 0 } });
  });

  it('surfaces missing counts and database failures', async () => {
    setupOverviewAndDrilldown([], null);
    await expect(adminService.getAttempts()).rejects.toThrow('Failed to count attempts');
    setupOverviewAndDrilldown([], null, { message: 'database unavailable' });
    await expect(adminService.getAttempts()).rejects.toThrow('database unavailable');
  });

  it('keeps the drill-down admin-only', () => {
    const status = jest.fn().mockReturnValue({ json: jest.fn() });
    const next = jest.fn();
    authorize('admin')({ user: { _id: 'teacher-1', role: 'teacher' } } as any, { status } as any, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('assessment retention and start policy', () => {
  it.each([false, null])('blocks a new teacher exam attempt when its course availability is %s', async published => {
    const insert = jest.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'teacher_quizzes') return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'quiz-1', course_id: 'course-1', is_active: true }, error: null }) }) }) };
      if (table === 'courses') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: published === null ? null : { id: 'course-1', is_published: published }, error: null }) }) }) };
      if (table === 'quiz_attempts') return { insert };
      throw new Error(`Unexpected table ${table}`);
    });
    await expect(quizService.startQuizByCode('CODE', 'student-1')).rejects.toMatchObject({ statusCode: 403 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses course deletion until the protective migration is available', async () => {
    const remove = jest.fn();
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: { created_by: 'teacher-1' } }) }) }), delete: remove });
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing function' } });
    await expect(courseService.deleteCourse('teacher-1', 'course-1')).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('025_preserve_assessment_history.sql') });
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not allow an unrelated teacher to delete an exam or probe migration state', async () => {
    const remove = jest.fn();
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { teacher_id: 'owner-1' }, error: null }) }) }), delete: remove });
    await expect(quizService.deleteQuiz('quiz-1', 'unrelated-teacher')).rejects.toMatchObject({ statusCode: 403 });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('returns a clear conflict when protected history prevents deletion', () => {
    expect(() => explainProtectedDelete({ code: '23503' })).toThrow('Unpublish it instead');
  });

  it('lets the owning teacher unpublish without changing course identity', async () => {
    let written: any;
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ single: async () => ({ data: { created_by: 'teacher-1' }, error: null }) }) }),
      update: (payload: any) => {
        written = payload;
        return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'course-1', max_students: null, ...payload }, error: null }) }) }) };
      },
    });
    await expect(courseService.updateCourse('teacher-1', 'course-1', { isPublished: false }))
      .resolves.toMatchObject({ _id: 'course-1', is_published: false });
    expect(written.is_published).toBe(false);
    await expect(courseService.updateCourse('teacher-1', 'course-1', { isPublished: 'false' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
