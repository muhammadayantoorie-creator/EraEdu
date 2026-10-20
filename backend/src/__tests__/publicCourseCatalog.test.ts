process.env.NODE_ENV = 'test';
process.env.VERCEL = '1'; // Exercise the deployed error response without real credentials.
process.env.JWT_SECRET = 'isolated-public-catalog-test-secret-long-enough';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-key';
const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/emailService', () => ({ emailService: {} }));
import express from 'express';
import request from 'supertest';
import { courseService } from '../services/courseService';
import { getCourses } from '../controllers/courseController';
import { errorHandler } from '../middleware/errorHandler';

const published = { id: 'published', title: 'Published course', is_published: true, category: 'Other',
  max_students: 5, course_code: 'PRIVATE-JOIN-CODE', created_by: 'private-teacher',
  organization_id: 'private-institution', future_private_column: 'must-not-be-public' };
const draft = { ...published, id: 'draft', title: 'Unpublished course', is_published: false };
function setup({ rows = [published, draft], count = 2 as number | null, courseError = false, enrollmentError = false } = {}) {
  const reads: Array<{ table: string; column: string; value: unknown }> = [];
  mockFrom.mockImplementation(table => {
    let data = rows;
    const query: any = { select: () => query,
      eq: (column: string, value: unknown) => {
        reads.push({ table, column, value });
        if (table === 'courses') data = data.filter(row => (row as any)[column] === value);
        return query;
      },
      ilike: () => query,
      then: (resolve: any, reject: any) => Promise.resolve(table === 'courses'
        ? { data: courseError ? null : data, error: courseError ? { message: 'private course DB error' } : null }
        : { count, error: enrollmentError ? { message: 'private enrollment DB error' } : null }).then(resolve, reject),
    };
    return query;
  });
  return reads;
}
const app = express();
app.get('/api/courses', getCourses);
app.use(errorHandler);
beforeEach(() => { mockFrom.mockReset(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

it('the unauthenticated HTTP catalog excludes drafts and does not look up their enrollment counts', async () => {
  const reads = setup();
  const response = await request(app).get('/api/courses');
  expect(response.status).toBe(200);
  expect(response.body.data.map((row: any) => row.id)).toEqual(['published']);
  expect(reads.filter(row => row.table === 'enrollments')).toEqual([{ table: 'enrollments', column: 'course_id', value: 'published' }]);
});
it('public responses exclude join codes, owner/institution identifiers, and future private columns', async () => {
  setup({ rows: [published] });
  const response = await request(app).get('/api/courses');
  expect(response.status).toBe(200);
  expect(response.body.data[0]).toMatchObject({ id: 'published', _id: 'published', title: 'Published course', maxStudents: 5, enrollmentCount: 2 });
  for (const key of ['course_code', 'created_by', 'organization_id', 'future_private_column']) {
    expect(response.body.data[0]).not.toHaveProperty(key);
  }
});
it('a catalog containing only drafts returns an honest empty public list', async () => {
  setup({ rows: [draft] });
  await expect(courseService.getAllCourses()).resolves.toEqual([]);
  expect(mockFrom.mock.calls.map(([table]) => table)).toEqual(['courses']);
});
it('an actual zero enrollment count remains zero', async () => {
  setup({ rows: [published], count: 0 });
  await expect(courseService.getAllCourses()).resolves.toMatchObject([{ enrollmentCount: 0 }]);
});
it.each([{ enrollmentError: true }, { count: null }])('does not fabricate zero enrollment when a count is unavailable: %j', async options => {
  setup({ rows: [published], ...options });
  await expect(courseService.getAllCourses()).rejects.toMatchObject({ statusCode: 503 });
});
it('course-query failures remain visible rather than becoming an empty catalog', async () => {
  setup({ courseError: true });
  const response = await request(app).get('/api/courses');
  expect(response.status).toBe(500);
  expect(response.body.success).toBe(false);
  expect(response.text).not.toContain('private course DB error');
});
