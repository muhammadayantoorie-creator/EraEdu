process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockEmail = jest.fn().mockResolvedValue(null);
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
jest.mock('../services/emailService', () => ({ emailService: { sendCourseEnrollmentEmail: mockEmail } }));

import { courseService } from '../services/courseService';
import { authorize } from '../middleware/auth';
import type { Request, Response, NextFunction } from 'express';

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockEmail.mockClear();
});

function setupDetail(enrolled: boolean, published = true) {
  const course = { id: 'course-1', title: 'Course', max_students: 5, created_by: 'teacher-1', is_published: published };
  mockFrom.mockImplementation((table: string) => {
    if (table === 'courses') {
      const query: any = { select: () => query, eq: () => query, single: async () => ({ data: course, error: null }) };
      return query;
    }
    if (table === 'enrollments') {
      const query: any = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: enrolled ? { id: 'enrollment-1' } : null, error: null }) };
      return query;
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

describe('course detail enrollment state', () => {
  it('reports the current student as enrolled after either enrollment path or reload', async () => {
    setupDetail(true);
    await expect(courseService.getCourseById('course-1', 'student-1', 'student'))
      .resolves.toMatchObject({ isEnrolled: true, canViewTopics: true });
  });

  it('lets an unenrolled student view a course but not its protected topics', async () => {
    setupDetail(false);
    await expect(courseService.getCourseById('course-1', 'student-1', 'student'))
      .resolves.toMatchObject({ isEnrolled: false, canViewTopics: false });
  });

  it('keeps draft topics hidden even when enrolled', async () => {
    setupDetail(true, false);
    await expect(courseService.getCourseById('course-1', 'student-1', 'student'))
      .resolves.toMatchObject({ isEnrolled: true, canViewTopics: false });
  });

  it('does not turn a failed enrollment lookup into a false state', async () => {
    setupDetail(false);
    mockFrom.mockImplementationOnce((table: string) => {
      expect(table).toBe('courses');
      const query: any = { select: () => query, eq: () => query, single: async () => ({
        data: { id: 'course-1', max_students: 5, created_by: 'teacher-1', is_published: true }, error: null,
      }) };
      return query;
    }).mockImplementationOnce((table: string) => {
      expect(table).toBe('enrollments');
      const query: any = { select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: null, error: { message: 'Enrollment lookup failed' } }) };
      return query;
    });
    await expect(courseService.getCourseById('course-1', 'student-1', 'student'))
      .rejects.toThrow('Enrollment lookup failed');
  });
});

describe('idempotent enrollment responses', () => {
  it('normal duplicate calls report enrolled without a second email', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const results = await Promise.all([
      courseService.enrollCourse('student-1', 'course-1'),
      courseService.enrollCourse('student-1', 'course-1'),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ isEnrolled: true, alreadyEnrolled: true }),
      expect.objectContaining({ isEnrolled: true, alreadyEnrolled: true }),
    ]);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('code-based duplicate calls use the same database function and return enrolled', async () => {
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe('courses');
      const query: any = { select: () => query, eq: () => query,
        single: async () => ({ data: { id: 'course-1', title: 'Course' }, error: null }) };
      return query;
    });
    mockRpc.mockResolvedValue({ data: false, error: null });
    const result = await courseService.enrollByCourseCode('student-1', 'ABC123');
    expect(result).toMatchObject({ isEnrolled: true, alreadyEnrolled: true });
    expect(mockRpc).toHaveBeenCalledWith('enroll_course_with_capacity', { p_course_id: 'course-1', p_user_id: 'student-1' });
  });
});

describe('enrollment route role boundary', () => {
  it.each(['teacher', 'admin'])('denies %s enrollment', role => {
    const req = { user: { _id: 'user-1', role } } as Request;
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
    const next = jest.fn() as NextFunction;
    authorize('student')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
