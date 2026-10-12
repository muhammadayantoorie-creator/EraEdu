process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));

import { teacherActivityService } from '../services/teacherActivityService';
import { authorize } from '../middleware/auth';

type Row = Record<string, any>;

function setup(tables: Record<string, Row[]>, failure?: string) {
  mockFrom.mockImplementation((table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let sortColumn = 'id';
    let ascending = true;
    const result = (start = 0, end = Number.MAX_SAFE_INTEGER) => {
      if (failure === table) return { data: null, error: { message: 'database unavailable' } };
      const data = (tables[table] || []).filter(row => filters.every(filter => filter(row)))
        .sort((a, b) => {
          const left = String(a[sortColumn] || '');
          const right = String(b[sortColumn] || '');
          return (ascending ? 1 : -1) * left.localeCompare(right);
        }).slice(start, end + 1);
      return { data, error: null };
    };
    const query: any = {
      select: () => query,
      eq: (column: string, value: any) => { filters.push(row => row[column] === value); return query; },
      in: (column: string, values: any[]) => { filters.push(row => values.includes(row[column])); return query; },
      is: (column: string, value: any) => { filters.push(row => row[column] === value); return query; },
      order: (column: string, options: { ascending: boolean }) => { sortColumn = column; ascending = options.ascending; return query; },
      range: async (start: number, end: number) => result(start, end),
      limit: async (limit: number) => result(0, limit - 1),
    };
    return query;
  });
}

beforeEach(() => mockFrom.mockReset());

describe('teacher recent activity', () => {
  it('shows real enrollments, teacher and topic submissions, and topics in time order without leaking another teacher', async () => {
    setup({
      courses: [{ id: 'course-1', title: 'Math', created_by: 'teacher-1' }, { id: 'course-2', title: 'Private', created_by: 'teacher-2' }],
      teacher_quizzes: [{ id: 'exam-1', title: 'Algebra Exam', teacher_id: 'teacher-1', course_id: 'course-1' }, { id: 'exam-2', title: 'Other Exam', teacher_id: 'teacher-2', course_id: 'course-2' }, { id: 'stale-exam', title: 'Stale Exam', teacher_id: 'teacher-1', course_id: 'course-2' }],
      topics: [{ id: 'topic-1', title: 'Fractions', course_id: 'course-1', created_at: '2026-01-01T09:00:00Z' }, { id: 'topic-2', title: 'Secret', course_id: 'course-2', created_at: '2026-01-01T12:00:00Z' }],
      enrollments: [{ id: 'enroll-1', user_id: 'student-1', course_id: 'course-1', enrolled_at: '2026-01-01T10:00:00Z' }, { id: 'enroll-1', user_id: 'student-1', course_id: 'course-1', enrolled_at: '2026-01-01T10:00:00Z' }, { id: 'enroll-2', user_id: 'student-2', course_id: 'course-2', enrolled_at: '2026-01-01T13:00:00Z' }],
      quiz_attempts: [{ id: 'attempt-1', user_id: 'student-1', quiz_id: 'exam-1', topic_id: null, status: 'completed', completed_at: '2026-01-01T11:00:00Z' }, { id: 'attempt-2', user_id: 'student-1', quiz_id: 'topic-exam-1', topic_id: 'topic-1', status: 'completed', completed_at: '2026-01-01T12:00:00Z' }, { id: 'attempt-3', user_id: 'student-2', quiz_id: 'exam-2', topic_id: null, status: 'completed', completed_at: '2026-01-01T14:00:00Z' }, { id: 'stale-attempt', user_id: 'student-2', quiz_id: 'stale-exam', topic_id: null, status: 'completed', completed_at: '2026-01-01T15:00:00Z' }],
      users: [{ id: 'student-1', name: 'Amina' }, { id: 'student-2', name: 'Bina' }],
      quizzes: [{ id: 'topic-exam-1', title: 'Fractions Check', topic_id: 'topic-1' }],
    });
    const events = await teacherActivityService.getRecent('teacher-1');
    expect(events.map(event => event.id)).toEqual(['submission:attempt-2', 'submission:attempt-1', 'enrollment:enroll-1', 'topic:topic-1']);
    expect(events[0]).toMatchObject({ text: 'Amina submitted Fractions Check', occurredAt: '2026-01-01T12:00:00Z', href: '/courses/course-1/topics/topic-1' });
    expect(events[1]).toMatchObject({ text: 'Amina submitted Algebra Exam', href: '/quiz/teacher-results/attempt-1' });
    expect(events[2]).toMatchObject({ text: 'Amina enrolled in Math', href: '/courses/course-1' });
    expect(events.some(event => event.text.includes('Bina') || event.text.includes('Private') || event.text.includes('Stale'))).toBe(false);
  });

  it('returns a genuine empty feed and surfaces source failures', async () => {
    setup({ courses: [], teacher_quizzes: [] });
    await expect(teacherActivityService.getRecent('teacher-1')).resolves.toEqual([]);
    setup({ courses: [{ id: 'course-1', title: 'Math', created_by: 'teacher-1' }], teacher_quizzes: [] }, 'enrollments');
    await expect(teacherActivityService.getRecent('teacher-1')).rejects.toThrow('Failed to load enrollments: database unavailable');
  });

  it('keeps the route limited to teacher/admin roles', () => {
    const status = jest.fn().mockReturnValue({ json: jest.fn() });
    const next = jest.fn();
    authorize('teacher', 'admin')({ user: { _id: 'student-1', role: 'student' } } as any, { status } as any, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
