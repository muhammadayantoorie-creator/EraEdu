process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/emailService', () => ({ emailService: {} }));

import { courseService } from '../services/courseService';

const topic = { id: 'topic-1', course_id: 'course-1', title: 'Introduction', description: 'Study notes' };

function mockStudyRows(options: { topic?: typeof topic | null; course?: { created_by: string } | null; enrolled?: boolean; errorTable?: string } = {}) {
  const rows: Record<string, any> = {
    topics: options.topic === undefined ? topic : options.topic,
    courses: options.course === undefined ? { created_by: 'teacher-1' } : options.course,
    enrollments: options.enrolled ? { course_id: 'course-1' } : null,
  };
  mockFrom.mockImplementation((table: string) => {
    const filters: Record<string, string> = {};
    const query: any = {
      select: () => query,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return query;
      },
      maybeSingle: async () => ({
        data: table === 'topics' && (filters.id !== rows.topics?.id || filters.course_id !== rows.topics?.course_id)
          ? null
          : table === 'courses' && filters.id !== 'course-1'
            ? null
            : table === 'enrollments' && (filters.course_id !== 'course-1' || filters.user_id !== 'student-1')
              ? null
              : rows[table],
        error: table === options.errorTable ? { message: 'Database unavailable' } : null,
      }),
    };
    return query;
  });
}

beforeEach(() => mockFrom.mockReset());

describe('course-scoped study topic access', () => {
  it('returns a topic to an enrolled student', async () => {
    mockStudyRows({ enrolled: true });
    await expect(courseService.getTopicById('course-1', 'topic-1', 'student-1', 'student'))
      .resolves.toMatchObject({ _id: 'topic-1', courseId: 'course-1', description: 'Study notes' });
  });

  it('allows the owning teacher and an admin without enrollment', async () => {
    mockStudyRows();
    await expect(courseService.getTopicById('course-1', 'topic-1', 'teacher-1', 'teacher')).resolves.toBeTruthy();
    await expect(courseService.getTopicById('course-1', 'topic-1', 'admin-1', 'admin')).resolves.toBeTruthy();
  });

  it('rejects unenrolled students and other teachers', async () => {
    mockStudyRows();
    await expect(courseService.getTopicById('course-1', 'topic-1', 'student-1', 'student'))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(courseService.getTopicById('course-1', 'topic-1', 'teacher-2', 'teacher'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('does not return a deleted topic or one from another course', async () => {
    mockStudyRows({ topic: null });
    await expect(courseService.getTopicById('course-1', 'topic-1', 'admin-1', 'admin'))
      .rejects.toMatchObject({ statusCode: 404 });
    mockStudyRows();
    await expect(courseService.getTopicById('course-2', 'topic-1', 'admin-1', 'admin'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not mistake database failure for a missing topic', async () => {
    mockStudyRows({ errorTable: 'topics' });
    await expect(courseService.getTopicById('course-1', 'topic-1', 'admin-1', 'admin'))
      .rejects.toThrow('Database unavailable');
  });
});
