process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockEnrollmentEmail = jest.fn().mockResolvedValue(undefined);
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
jest.mock('../services/emailService', () => ({ emailService: { sendCourseEnrollmentEmail: mockEnrollmentEmail } }));

import { courseService, parseCourseCapacity } from '../services/courseService';

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockEnrollmentEmail.mockClear();
});

describe('course capacity validation', () => {
  it.each([null, '', '  '])('treats %s as unlimited', value => {
    expect(parseCourseCapacity(value)).toBeNull();
  });

  it.each([0, -1, 1.5, '0', '-2', '2.5', 'abc', 2147483648, true])('rejects invalid capacity %s', value => {
    expect(() => parseCourseCapacity(value)).toThrow('positive whole number');
  });

  it('accepts 30 without rounding and preserves omitted updates', () => {
    expect(parseCourseCapacity(' 30 ')).toBe(30);
    expect(parseCourseCapacity(30)).toBe(30);
    expect(parseCourseCapacity(undefined)).toBeUndefined();
  });
});

describe('course capacity persistence', () => {
  it('sends max_students on create and returns the saved value', async () => {
    let inserted: any;
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'courses') throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
        insert: (rows: any[]) => {
          inserted = rows[0];
          return { select: () => ({ single: async () => ({ data: { id: 'course-1', ...inserted }, error: null }) }) };
        },
      };
    });

    const created = await courseService.createCourse('teacher-1', { title: 'Course', maxStudents: 30 });
    expect(inserted.max_students).toBe(30);
    expect(created.maxStudents).toBe(30);
  });

  it('rejects an invalid create before writing anything', async () => {
    await expect(courseService.createCourse('teacher-1', { title: 'Course', maxStudents: 1.5 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects missing capacity schema without retrying an insert without the field', async () => {
    let inserts = 0;
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
      insert: () => {
        inserts++;
        return { select: () => ({ single: async () => ({
          data: null,
          error: { code: 'PGRST204', message: "Could not find the 'max_students' column of 'courses' in the schema cache" },
        }) }) };
      },
    }));

    await expect(courseService.createCourse('teacher-1', { title: 'Course', maxStudents: 30 }))
      .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('006_add_course_capacity.sql') });
    expect(inserts).toBe(1);
  });

  it('maps an edited limit and blank unlimited value without flooring', async () => {
    const updated: any[] = [];
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { created_by: 'teacher-1' } }) }) }),
      update: (payload: any) => {
        updated.push(payload);
        return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'course-1', ...payload }, error: null }) }) }) };
      },
    }));

    await expect(courseService.updateCourse('teacher-1', 'course-1', { title: 'Course', maxStudents: 30 }))
      .resolves.toMatchObject({ maxStudents: 30 });
    await expect(courseService.updateCourse('teacher-1', 'course-1', { title: 'Course', maxStudents: '' }))
      .resolves.toMatchObject({ maxStudents: null });
    expect(updated.map(row => row.max_students)).toEqual([30, null]);
  });

  it('returns the persisted capacity in the teacher list after reload', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'courses') return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'course-1', title: 'Course', max_students: 30 }], error: null }) }) }) };
      if (table === 'enrollments') return { select: () => ({ eq: async () => ({ count: 2 }) }) };
      if (table === 'topics') return { select: () => ({ eq: async () => ({ data: [] }) }) };
      throw new Error(`Unexpected table ${table}`);
    });
    await expect(courseService.getTeacherCourses('teacher-1'))
      .resolves.toEqual([expect.objectContaining({ _id: 'course-1', maxStudents: 30, enrollmentCount: 2 })]);
  });

  it('shows a schema requirement instead of unlimited when a listed course lacks the column', async () => {
    mockFrom.mockImplementation(() => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'course-1', title: 'Course' }], error: null }) }) }) }));
    await expect(courseService.getTeacherCourses('teacher-1'))
      .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('006_add_course_capacity.sql') });
  });
});

describe('atomic enrollment contract', () => {
  it('uses one database RPC for normal enrollment and returns duplicates without email', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const result = await courseService.enrollCourse('student-1', 'course-1');
    expect(result.message).toBe('Already enrolled');
    expect(mockRpc).toHaveBeenCalledWith('enroll_course_with_capacity', { p_course_id: 'course-1', p_user_id: 'student-1' });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockEnrollmentEmail).not.toHaveBeenCalled();
  });

  it('uses the same RPC for join-by-code', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'courses') return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'course-1', title: 'Course' }, error: null }) }) }) };
      throw new Error(`Unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({ data: false, error: null });
    await expect(courseService.enrollByCourseCode('student-1', 'abc123'))
      .resolves.toMatchObject({ message: 'Already enrolled in this course' });
    expect(mockRpc).toHaveBeenCalledWith('enroll_course_with_capacity', { p_course_id: 'course-1', p_user_id: 'student-1' });
  });

  it('surfaces full courses and a missing RPC as actionable errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'This course is full. Please contact your teacher.', code: 'P0001' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'Function not found', code: 'PGRST202' } });
    await expect(courseService.enrollCourse('student-1', 'course-1')).rejects.toMatchObject({ statusCode: 409 });
    await expect(courseService.enrollCourse('student-1', 'course-1'))
      .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('023_enforce_course_capacity_atomically.sql') });
  });

  it('sends concurrent last-seat requests through the atomic RPC, with one winner', async () => {
    let remaining = 1;
    mockRpc.mockImplementation(async () => {
      await Promise.resolve();
      if (remaining === 0) return { data: null, error: { message: 'This course is full. Please contact your teacher.', code: 'P0001' } };
      remaining--;
      return { data: true, error: null };
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users' || table === 'courses') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
      }
      throw new Error(`Unexpected direct table access: ${table}`);
    });

    const outcomes = await Promise.allSettled([
      courseService.enrollCourse('student-1', 'course-1'),
      courseService.enrollCourse('student-2', 'course-1'),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(remaining).toBe(0);
  });
});

describe('production migration guidance', () => {
  it('surfaces approved setup instructions but still redacts arbitrary server errors', () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';
    let handleError: typeof import('../middleware/errorHandler').errorHandler;
    try {
      jest.isolateModules(() => {
        handleError = require('../middleware/errorHandler').errorHandler;
      });
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = { method: 'POST', originalUrl: '/api/courses' } as any;
    const res = { status } as any;
    handleError!(Object.assign(new Error('Atomic enrollment is unavailable. Apply migration 023_enforce_course_capacity_atomically.sql.'), { statusCode: 503 }), req, res, jest.fn());
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('023_enforce_course_capacity_atomically.sql') }));
    handleError!(Object.assign(new Error('private database details'), { statusCode: 503 }), req, res, jest.fn());
    expect(json).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Server error' }));
  });
});
