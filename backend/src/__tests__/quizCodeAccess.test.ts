process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-exam-access-secret-minimum-32-characters';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-key';
const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));
import express from 'express';
import request from 'supertest';
import { accessQuizByCode } from '../controllers/quizCodeController';
import { quizService } from '../services/quizService';

const app = express();
app.get('/preview/:code', (req, _res, next) => {
  req.user = { _id: 'student', role: 'student' } as any;
  next();
}, accessQuizByCode);

function setup({ published = true as boolean | null, enrolled = true, completed = false,
  missingCourse = false, courseError = null as any, enrollmentError = null as any, destination = 'course' } = {}) {
  const reads: { table: string; filters: Record<string, unknown> }[] = [];
  const write = jest.fn(() => { throw new Error('Preview must never write'); });
  mockFrom.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    reads.push({ table, filters });
    const finish = async () => {
      if (table === 'teacher_quizzes') return { data: { id: 'exam', course_id: destination, title: 'Exam', access_code: '1234',
        is_active: true, questions: [{ text: 'Hidden question', correctAnswer: 1, answerText: 'Hidden answer' }] }, error: null };
      if (table === 'enrollments') return { data: enrolled && filters.course_id === 'course' ? { id: 'enrollment' } : null, error: enrollmentError };
      if (table === 'quiz_attempts') return { data: completed ? { id: 'completed-attempt' } : null, error: null };
      if (table === 'courses') return { data: missingCourse ? null : { title: 'Selected course', is_published: published }, error: courseError };
      throw new Error(`Unexpected table ${table}`);
    };
    const query: any = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      single: finish, maybeSingle: finish, insert: write, update: write, delete: write };
    return query;
  });
  return { reads, write };
}
beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });

test.each([true, false, null])('an enrolled student can preview a code exam regardless of course publication (%s)', async published => {
  const { write } = setup({ published });
  const response = await request(app).get('/preview/1234');
  expect(response.status).toBe(200);
  expect(response.body.data.quiz).toMatchObject({ courseTitle: 'Selected course', alreadySubmitted: false });
  expect(JSON.stringify(response.body)).not.toMatch(/Hidden question|Hidden answer|correctAnswer|answerText/);
  expect(write).not.toHaveBeenCalled();
});

test.each([true, false, null])('a student must join the course first, regardless of publication (%s)', async published => {
  const { write } = setup({ enrolled: false, published });
  const response = await request(app).get('/preview/1234');
  expect(response.status).toBe(403);
  expect(response.body.error.message).toMatch(/My Courses.*6-character.*4-digit/);
  expect(response.body).not.toHaveProperty('data');
  expect(write).not.toHaveBeenCalled();
});

test('changing an exam\'s course does not transfer a student\'s enrollment', async () => {
  const { reads, write } = setup({ destination: 'different-course' });
  const response = await request(app).get('/preview/1234');
  expect(response.status).toBe(403);
  expect(reads.find(read => read.table === 'enrollments')?.filters).toEqual({ user_id: 'student', course_id: 'different-course' });
  expect(write).not.toHaveBeenCalled();
});

test.each(['enrollment', 'course'])('a failed %s lookup is retryable, not reported as a missing enrollment or draft course', async failure => {
  const { write } = setup(failure === 'enrollment' ? { enrollmentError: { message: 'private database detail' } }
    : { courseError: { message: 'private database detail' } });
  const response = await request(app).get('/preview/1234');
  expect(response.status).toBe(503);
  expect(response.body.error.message).toMatch(/retry/i);
  expect(JSON.stringify(response.body)).not.toMatch(/private database detail|not enrolled|not published/i);
  expect(write).not.toHaveBeenCalled();
});

test('a missing linked course is unavailable, never presented as a General exam', async () => {
  setup({ missingCourse: true });
  const response = await request(app).get('/preview/1234');
  expect(response.status).toBe(403);
  expect(response.body.error.message).toMatch(/teacher.*course/i);
  expect(response.body).not.toHaveProperty('data');
});

test('a published course with enrollment can be previewed without exposing questions or answer keys', async () => {
  const { write } = setup();
  const response = await request(app).get('/preview/1234');
  expect(response.status).toBe(200);
  expect(response.body.data.quiz).toMatchObject({ courseTitle: 'Selected course', questionCount: 1, alreadySubmitted: false });
  expect(JSON.stringify(response.body)).not.toMatch(/Hidden question|Hidden answer|correctAnswer|answerText/);
  expect(write).not.toHaveBeenCalled();
});

test('unpublishing does not hide an enrolled student\'s existing completed submission', async () => {
  setup({ published: false, completed: true });
  const response = await request(app).get('/preview/1234');
  expect(response.status).toBe(200);
  expect(response.body.data.quiz).toMatchObject({ alreadySubmitted: true, completedAttemptId: 'completed-attempt' });
});

test('an access change racing preview remains denied by the atomic start and gets recovery instructions', async () => {
  const { write } = setup();
  mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Course access is unavailable' } });
  await expect(quizService.startQuizByCode('1234', 'student')).rejects.toMatchObject({
    statusCode: 403, message: expect.stringMatching(/course.*enrollment/i),
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(write).not.toHaveBeenCalled();
});
