process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));

import { courseService } from '../services/courseService';

const courses = [
  { id: 'one', title: 'One', is_published: true },
  { id: 'two', title: 'Two', is_published: true },
  { id: 'draft', title: 'Draft', is_published: false },
];

function setup(topicRows: Array<{ id: string; course_id: string }>, options: { failTopics?: boolean; enrolled?: boolean; maxRows?: number } = {}) {
  const topicQueries: string[][] = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === 'enrollments') {
      return { select: () => ({ eq: async () => ({
        data: options.enrolled === false ? [] : courses.map(course => ({ course_id: course.id, courses: course })),
        error: null,
      }) }) };
    }
    if (table === 'topics') {
      const query: any = {
        select: () => query,
        in: (_column: string, ids: string[]) => { topicQueries.push(ids); return query; },
        order: () => query,
        range: async (from: number, to: number) => ({
          data: options.failTopics ? null : topicRows.filter(row => topicQueries[topicQueries.length - 1].includes(row.course_id)).slice(from, Math.min(to + 1, from + (options.maxRows || 1000))),
          count: topicRows.filter(row => topicQueries[topicQueries.length - 1].includes(row.course_id)).length,
          error: options.failTopics ? { message: 'topic query failed' } : null,
        }),
      };
      return query;
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return topicQueries;
}

beforeEach(() => mockFrom.mockReset());

describe('student visible topic counts', () => {
  it('counts multiple published courses in one topic query, excluding draft-course topics', async () => {
    const queried = setup([
      { id: '1', course_id: 'one' }, { id: '2', course_id: 'one' }, { id: '3', course_id: 'one' },
      { id: '4', course_id: 'draft' },
    ]);
    await expect(courseService.getEnrolledCourses('student')).resolves.toEqual([
      expect.objectContaining({ _id: 'one', topicsCount: 3 }),
      expect.objectContaining({ _id: 'two', topicsCount: 0 }),
      expect.objectContaining({ _id: 'draft', topicsCount: 0 }),
    ]);
    expect(queried).toEqual([['one', 'two']]);
  });

  it('returns a genuine zero for no enrollments without querying topics', async () => {
    setup([], { enrolled: false });
    await expect(courseService.getEnrolledCourses('student')).resolves.toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('surfaces topic-query errors instead of displaying zero', async () => {
    setup([], { failTopics: true });
    await expect(courseService.getEnrolledCourses('student')).rejects.toThrow('topic query failed');
  });

  it('reflects newly created topics on the next request', async () => {
    const rows: Array<{ id: string; course_id: string }> = [];
    setup(rows);
    expect((await courseService.getEnrolledCourses('student'))[0].topicsCount).toBe(0);
    rows.push({ id: 'new-topic', course_id: 'one' });
    expect((await courseService.getEnrolledCourses('student'))[0].topicsCount).toBe(1);
  });

  it('does not undercount when the API limits page size', async () => {
    setup(Array.from({ length: 4 }, (_, index) => ({ id: String(index), course_id: 'one' })), { maxRows: 2 });
    expect((await courseService.getEnrolledCourses('student'))[0].topicsCount).toBe(4);
  });
});

describe('student topic detail access', () => {
  function accessSetup(published: boolean, enrolled: boolean) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'topics') {
        const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: 'topic', course_id: 'one' }, error: null }) };
        return query;
      }
      if (table === 'courses') {
        const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { created_by: 'teacher', is_published: published }, error: null }) };
        return query;
      }
      if (table === 'enrollments') {
        const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: enrolled ? { course_id: 'one' } : null, error: null }) };
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    });
  }

  it('allows an enrolled student into a published topic', async () => {
    accessSetup(true, true);
    await expect(courseService.getTopicById('one', 'topic', 'student', 'student')).resolves.toMatchObject({ _id: 'topic' });
  });

  it('denies direct draft-topic access to students', async () => {
    accessSetup(false, true);
    await expect(courseService.getTopicById('one', 'topic', 'student', 'student')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('denies unenrolled students', async () => {
    accessSetup(true, false);
    await expect(courseService.getTopicById('one', 'topic', 'student', 'student')).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('student topic list visibility', () => {
  function setupList(published: boolean, enrolled: boolean) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'courses') {
        const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { created_by: 'teacher', is_published: published }, error: null }) };
        return query;
      }
      if (table === 'enrollments') {
        const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: enrolled ? { course_id: 'one' } : null, error: null }) };
        return query;
      }
      if (table === 'topics') {
        const query: any = { select: () => query, eq: () => query, order: () => query,
          range: async () => ({ data: [{ id: 'topic', course_id: 'one' }], count: 1, error: null }) };
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    });
  }

  it('returns the published course topics to its enrolled student', async () => {
    setupList(true, true);
    await expect(courseService.getTopicsByCourse('one', 'student', 'student')).resolves.toEqual([
      expect.objectContaining({ _id: 'topic' }),
    ]);
  });

  it('hides draft topics from students but not the owner', async () => {
    setupList(false, true);
    await expect(courseService.getTopicsByCourse('one', 'student', 'student')).resolves.toEqual([]);
    await expect(courseService.getTopicsByCourse('one', 'teacher', 'teacher')).resolves.toHaveLength(1);
  });

  it('does not enumerate another course to unenrolled students', async () => {
    setupList(true, false);
    await expect(courseService.getTopicsByCourse('one', 'student', 'student')).rejects.toMatchObject({ statusCode: 403 });
  });
});
