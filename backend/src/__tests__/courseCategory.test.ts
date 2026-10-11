process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/emailService', () => ({ emailService: {} }));

import { canonicalCourseCategory, normalizeCourseCategory } from '../services/courseCategory';
import { courseService } from '../services/courseService';

beforeEach(() => mockFrom.mockReset());

describe('course category contract', () => {
  it.each([undefined, null, '', ' \t ', 42, '---', 'A'.repeat(101), 'Civil\u0001Engineering'])(
    'rejects invalid category %s', value => {
      expect(() => normalizeCourseCategory(value)).toThrow();
    },
  );

  it('normalizes whitespace and maps suggestion case when none is saved', async () => {
    mockFrom.mockReturnValue({ select: () => ({ ilike: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) });
    expect(normalizeCourseCategory('  Civil   Engineering  ')).toBe('Civil Engineering');
    await expect(canonicalCourseCategory(' web development ')).resolves.toBe('Web Development');
  });

  it('prefers an existing spelling over a suggestion', async () => {
    mockFrom.mockReturnValue({ select: () => ({ ilike: () => ({ order: () => ({ limit: async () => ({ data: [{ category: 'web development' }], error: null }) }) }) }) });
    await expect(canonicalCourseCategory('Web Development')).resolves.toBe('web development');
  });

  it('reuses an existing custom spelling and preserves an unchanged legacy value on edit', async () => {
    mockFrom.mockReturnValue({ select: () => ({ ilike: () => ({ order: () => ({ limit: async () => ({
      data: [{ category: 'Civil Engineering' }], error: null,
    }) }) }) }) });
    await expect(canonicalCourseCategory(' civil  engineering ')).resolves.toBe('Civil Engineering');
    await expect(canonicalCourseCategory('legacy  category', 'Legacy  Category')).resolves.toBe('Legacy  Category');
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('saves a custom category, reloads it, and preserves it during edit', async () => {
    let stored: any;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'courses') return {
        select: (columns?: string) => ({
          ilike: () => ({ order: () => ({ limit: async () => ({ data: stored ? [{ category: stored.category }] : [], error: null }) }) }),
          eq: (_column: string, value: string) => ({ single: async () => ({ data: columns === 'id' ? null : { ...stored, created_by: 'teacher-1' }, error: null }) }),
        }),
        insert: (rows: any[]) => ({ select: () => ({ single: async () => {
          stored = { id: 'course-1', ...rows[0] };
          return { data: stored, error: null };
        } }) }),
        update: (payload: any) => ({ eq: () => ({ select: () => ({ single: async () => {
          stored = { ...stored, ...payload };
          return { data: stored, error: null };
        } }) }) }),
      };
      throw new Error(`Unexpected table ${table}`);
    });
    const created = await courseService.createCourse('teacher-1', { title: 'Structures', category: ' Civil   Engineering ', maxStudents: null });
    expect(created.category).toBe('Civil Engineering');
    const loaded = await courseService.getCourseById('course-1');
    expect(loaded.category).toBe('Civil Engineering');
    const edited = await courseService.updateCourse('teacher-1', 'course-1', { title: 'Structures II', category: 'civil engineering' });
    expect(edited.category).toBe('Civil Engineering');
    expect(stored.category).toBe('Civil Engineering');
  });

  it('rejects blank create and invalid edit before writes', async () => {
    await expect(courseService.createCourse('teacher-1', { title: 'Course', category: '  ' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(mockFrom).not.toHaveBeenCalled();
    const update = jest.fn();
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: { created_by: 'teacher-1', category: 'Other' } }) }) }), update });
    await expect(courseService.updateCourse('teacher-1', 'course-1', { category: 'A'.repeat(101) }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('filters saved categories case-insensitively', async () => {
    const ilike = jest.fn().mockResolvedValue({ data: [], error: null });
    mockFrom.mockReturnValue({ select: () => ({ ilike }) });
    await expect(courseService.getAllCourses({ category: ' civil  engineering ' })).resolves.toEqual([]);
    expect(ilike).toHaveBeenCalledWith('category', 'civil engineering');
  });
});
