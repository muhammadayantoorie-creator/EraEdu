process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
jest.mock('../services/emailService', () => ({ emailService: {} }));

import { courseAssignmentService } from '../services/courseAssignmentService';
import { courseService } from '../services/courseService';
import { authorize } from '../middleware/auth';
import { cheatingViolationService } from '../services/cheatingViolationService';
import { readFileSync } from 'fs';
import { join } from 'path';

beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });
afterEach(() => jest.restoreAllMocks());

describe('admin course assignment', () => {
  it('requires an admin at the route boundary', () => {
    const status = jest.fn().mockReturnValue({ json: jest.fn() });
    const next = jest.fn();
    authorize('admin')({ user: { _id: 'teacher-1', role: 'teacher' } } as any, { status } as any, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('denies an unrelated teacher course edits before any write', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { created_by: 'assigned-teacher' }, error: null }) }) }),
    }));
    await expect(courseService.updateCourse('unrelated-teacher', 'course-1', { title: 'Changed' }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('creates a course for the selected teacher and institution without changing the admin role', async () => {
    jest.spyOn(courseService, 'generateUniqueCourseCode').mockResolvedValue('ABC123');
    mockRpc.mockResolvedValue({ data: { id: 'course-1', title: 'Course', created_by: 'teacher-1', organization_id: 'org-1', max_students: 30 }, error: null });
    const created = await courseAssignmentService.createAssignedCourse('admin-1', {
      title: 'Course', organizationId: 'org-1', teacherId: 'teacher-1', maxStudents: 30,
    });
    expect(mockRpc).toHaveBeenCalledWith('admin_create_assigned_course', expect.objectContaining({
      p_actor_id: 'admin-1', p_teacher_id: 'teacher-1', p_organization_id: 'org-1',
      p_max_students: 30, p_course_code: 'ABC123',
    }));
    expect(created).toMatchObject({ _id: 'course-1', createdBy: 'teacher-1', maxStudents: 30 });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('reassigns with a single database call and handles idempotent retry', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    await expect(courseAssignmentService.reassignCourse('admin-1', 'course-1', { teacherId: 'teacher-2', organizationId: 'org-1' }))
      .resolves.toEqual({ changed: true });
    await expect(courseAssignmentService.reassignCourse('admin-1', 'course-1', { teacherId: 'teacher-2', organizationId: 'org-1' }))
      .resolves.toEqual({ changed: false });
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'admin_reassign_course', {
      p_actor_id: 'admin-1', p_course_id: 'course-1', p_teacher_id: 'teacher-2', p_organization_id: 'org-1',
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each([
    ['An active registered teacher is required', 400],
    ['Teacher must belong to the selected institution', 403],
    ['Current teacher is not in the selected institution', 403],
    ['Course cannot be moved to another institution', 403],
    ['Only active platform admins can assign courses', 403],
  ])('surfaces %s as an authorization or eligibility error', async (message, statusCode) => {
    mockRpc.mockResolvedValue({ data: null, error: { message } });
    await expect(courseAssignmentService.reassignCourse('admin-1', 'course-1', { teacherId: 'teacher-2', organizationId: 'org-1' }))
      .rejects.toMatchObject({ statusCode });
  });

  it('requires the additive assignment migration rather than partially writing', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
    await expect(courseAssignmentService.reassignCourse('admin-1', 'course-1', { teacherId: 'teacher-2', organizationId: 'org-1' }))
      .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('024_assign_courses_to_teachers.sql') });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('offers only active registered teachers with their actual institution memberships', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'organizations') return { select: () => ({ order: async () => ({ data: [{ id: 'org-1', name: 'Institution' }], error: null }) }) };
      if (table === 'organization_members') return { select: async () => ({ data: [
        { organization_id: 'org-1', user_id: 'teacher-1' },
        { organization_id: 'org-1', user_id: 'teacher-2' },
        { organization_id: 'org-1', user_id: 'student-1' },
      ], error: null }) };
      if (table === 'users') return { select: () => ({ in: async () => ({ data: [
        { id: 'teacher-1', name: 'Eligible', email: 'eligible@example.test', role: 'teacher', is_suspended: false },
        { id: 'teacher-2', name: 'Suspended', role: 'teacher', is_suspended: true },
        { id: 'student-1', name: 'Student', role: 'student', is_suspended: false },
      ], error: null }) }) };
      throw new Error(`Unexpected table ${table}`);
    });
    const options = await courseAssignmentService.getOptions();
    expect(options.teachers).toEqual([expect.objectContaining({ id: 'teacher-1', organizationIds: ['org-1'] })]);
  });
});

describe('reassigned exam review access', () => {
  it('does not use historical event.teacher_id to grant a former manager summary access', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'teacher_quizzes') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      throw new Error(`Unexpected table ${table}`);
    });
    await expect(cheatingViolationService.getViolationSummary('former-teacher'))
      .resolves.toMatchObject({ totalViolations: 0, suspiciousAttempts: 0, attempts: [] });
    expect(mockFrom).not.toHaveBeenCalledWith('cheating_violations');
  });
});

it('keeps reassignment in one database function without deleting course content or attempts', () => {
  const migration = readFileSync(join(__dirname, '../../migrations/024_assign_courses_to_teachers.sql'), 'utf8');
  expect(migration).toContain('FROM public.courses WHERE id = p_course_id FOR UPDATE');
  expect(migration).toContain('UPDATE public.teacher_quizzes SET teacher_id = p_teacher_id::text');
  expect(migration).toContain('INSERT INTO public.course_assignment_audit');
  expect(migration).toContain('original_teacher_id');
  expect(migration).not.toMatch(/DELETE FROM public\.(topics|questions|enrollments|quiz_attempts)/i);
});
