process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/emailService', () => ({ emailService: {} }));

import { adminService } from '../services/adminService';
import { courseAssignmentService } from '../services/courseAssignmentService';

const seededCourses = [
  { id: 'published', title: 'Published', is_published: true, organization_id: null, max_students: null, created_by: null },
  { id: 'draft', title: 'Draft', is_published: false, organization_id: null, max_students: null, created_by: null },
  // A deployment may have added an archive field; neither endpoint excludes it.
  { id: 'archived', title: 'Archived', is_published: false, archived_at: '2025-01-01', organization_id: null, max_students: null, created_by: null },
];

function setup(courses = seededCourses, courseCount: number | null = courses.length, courseError: any = null) {
  mockFrom.mockImplementation((table: string) => ({
    select: (columns: string, options?: { count?: string; head?: boolean }) => {
      if (table === 'courses') {
        if (options?.head) return Promise.resolve({ count: courseCount, error: courseError });
        return { order: () => ({ range: async () => ({ data: courses, count: courseCount, error: courseError }) }) };
      }
      if (table === 'users') {
        if (options?.head) return Promise.resolve({ count: 0, error: null });
        if (columns === 'role, is_suspended') return Promise.resolve({ data: [], error: null });
      }
      if (['teacher_quizzes', 'quiz_attempts', 'cheating_violations'].includes(table)) {
        return Promise.resolve({ count: 0, error: null });
      }
      if (table === 'enrollments') return { eq: async () => ({ count: 0, error: null }) };
      if (table === 'topics') return { eq: async () => ({ data: [], error: null }) };
      throw new Error(`Unexpected query: ${table}.${columns}`);
    },
  }));
}

beforeEach(() => mockFrom.mockReset());

describe('admin total-courses metric', () => {
  it('counts exactly the published, draft, and historical rows in governance', async () => {
    setup();
    const overview = await adminService.getOverview();
    const listing = await courseAssignmentService.listCourses();
    expect(overview.courses).toBe(3);
    expect(listing.pagination.total).toBe(overview.courses);
    expect(listing.data.map(course => course._id)).toEqual(['published', 'draft', 'archived']);
    expect(mockFrom.mock.calls.filter(([table]) => table === 'courses')).toHaveLength(2);
  });

  it('returns genuine zero for an empty course table', async () => {
    setup([]);
    await expect(adminService.getOverview()).resolves.toMatchObject({ courses: 0 });
    await expect(courseAssignmentService.listCourses()).resolves.toMatchObject({ data: [], pagination: { total: 0 } });
  });

  it('does not present failed or missing database counts as zero', async () => {
    setup([], null);
    await expect(adminService.getOverview()).rejects.toThrow('Failed to count courses');
    await expect(courseAssignmentService.listCourses()).rejects.toThrow('Failed to count courses');
    setup([], null, { message: 'database unavailable' });
    await expect(adminService.getOverview()).rejects.toThrow('Failed to count courses');
    await expect(courseAssignmentService.listCourses()).rejects.toThrow('database unavailable');
  });
});
