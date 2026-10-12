process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
jest.mock('../services/emailService', () => ({ emailService: {} }));

import { analyticsService } from '../services/analyticsService';
import { quizService } from '../services/quizService';

function setup(courses: Array<{ id: string; created_by: string }>, enrollments: Array<{ course_id: string; user_id: string }>, failure?: string) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'courses') return { select: () => ({ eq: (_column: string, teacherId: string) => ({
      order: () => ({ range: async (start: number, end: number) => ({ data: courses.filter(course => course.created_by === teacherId).slice(start, end + 1), error: failure === 'courses' ? { message: 'database unavailable' } : null }) }),
    }) }) };
    if (table === 'enrollments') return { select: () => ({ in: (_column: string, ids: string[]) => ({
      order: () => ({ range: async (start: number, end: number) => ({ data: enrollments.filter(enrollment => ids.includes(enrollment.course_id)).slice(start, end + 1), error: failure === 'enrollments' ? { message: 'database unavailable' } : null }) }),
    }) }) };
    if (table === 'topics') return { select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) };
    if (table === 'teacher_quizzes') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    throw new Error(`Unexpected table ${table}`);
  });
}

beforeEach(() => mockFrom.mockReset());

describe('teacher Total Students', () => {
  it('counts each enrolled learner once across assigned courses and excludes other teachers', async () => {
    setup([
      { id: 'course-1', created_by: 'teacher-1' }, { id: 'course-2', created_by: 'teacher-1' },
      { id: 'other-course', created_by: 'teacher-2' },
    ], [
      { course_id: 'course-1', user_id: 'student-1' }, { course_id: 'course-2', user_id: 'student-1' },
      { course_id: 'course-2', user_id: 'student-2' }, { course_id: 'other-course', user_id: 'student-3' },
    ]);
    await expect(analyticsService.getTeacherStats('teacher-1')).resolves.toMatchObject({ totalCourses: 2, totalStudents: 2, activeEnrollments: 3 });
    await expect(quizService.getTeacherAnalytics('teacher-1')).resolves.toMatchObject({ totalStudents: 2, totalQuizzes: 0 });
    await expect(analyticsService.getTeacherStats('teacher-2')).resolves.toMatchObject({ totalCourses: 1, totalStudents: 1 });
  });

  it('returns a genuine zero when the teacher has no students', async () => {
    setup([{ id: 'course-1', created_by: 'teacher-1' }], []);
    await expect(analyticsService.getTeacherStats('teacher-1')).resolves.toMatchObject({ totalStudents: 0, activeEnrollments: 0 });
    await expect(quizService.getTeacherAnalytics('teacher-1')).resolves.toMatchObject({ totalStudents: 0 });
  });

  it('does not convert course or enrollment database failures into zero', async () => {
    setup([{ id: 'course-1', created_by: 'teacher-1' }], [], 'courses');
    await expect(analyticsService.getTeacherStats('teacher-1')).rejects.toThrow('Failed to load courses: database unavailable');
    setup([{ id: 'course-1', created_by: 'teacher-1' }], [], 'enrollments');
    await expect(analyticsService.getTeacherStats('teacher-1')).rejects.toThrow('Failed to load enrollments: database unavailable');
    await expect(quizService.getTeacherAnalytics('teacher-1')).rejects.toThrow('Failed to load enrollments: database unavailable');
  });

  it('reads beyond the default result limit rather than undercounting large course lists', async () => {
    setup(Array.from({ length: 501 }, (_, index) => ({ id: `course-${index}`, created_by: 'teacher-1' })),
      [{ course_id: 'course-500', user_id: 'student-1' }]);
    await expect(analyticsService.getTeacherStudentSummary('teacher-1')).resolves.toMatchObject({ totalCourses: 501, totalStudents: 1, activeEnrollments: 1 });
  });
});
