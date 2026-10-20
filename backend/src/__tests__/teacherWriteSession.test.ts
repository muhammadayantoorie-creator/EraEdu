process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-teacher-write-session-secret-long-enough';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-key';
const mockFrom = jest.fn();
const mockCreateCourse = jest.fn();
const mockUpdateCourse = jest.fn();
const mockCreateQuiz = jest.fn();
const mockUpdateQuiz = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/courseService', () => ({ courseService: { createCourse: mockCreateCourse, updateCourse: mockUpdateCourse } }));
jest.mock('../services/quizService', () => ({ quizService: { createQuiz: mockCreateQuiz, updateQuiz: mockUpdateQuiz } }));
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import courses from '../routes/courses';
import quizzes from '../routes/quizzes';
const app = express();
app.use(express.json(), cookieParser());
app.use('/api/courses', courses);
app.use('/api/quizzes', quizzes);
const tokenFor = (id: string, role: string) => jwt.sign({ id, role }, process.env.JWT_SECRET!);
let currentAccount = { id: 'teacher-one', role: 'teacher', is_suspended: false };
beforeEach(() => {
  currentAccount = { id: 'teacher-one', role: 'teacher', is_suspended: false };
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: currentAccount, error: null }),
  }) }) }));
  for (const writer of [mockCreateCourse, mockUpdateCourse, mockCreateQuiz, mockUpdateQuiz]) {
    writer.mockReset(); writer.mockResolvedValue({ id: 'created-resource' });
  }
});
const endpoints = [['post', '/api/courses', mockCreateCourse], ['put', '/api/courses/course-one', mockUpdateCourse],
  ['post', '/api/quizzes', mockCreateQuiz], ['put', '/api/quizzes/exam-one', mockUpdateQuiz]] as const;

it.each(endpoints)('a current teacher can %s %s through the actual router', async (method, url, writer) => {
  const response = await request(app)[method](url).set('Cookie', `eraedu_session=${tokenFor('teacher-one', 'teacher')}`)
    .set('X-EraEdu-Account', 'teacher-one').send({ title: 'Test resource', questions: [] });
  expect(response.status).toBe(method === 'post' ? 201 : 200);
  expect(writer).toHaveBeenCalledTimes(1);
  expect(writer.mock.calls[0]).toContain('teacher-one');
});
it.each(endpoints)('rejects a replaced account session before %s %s can write', async (method, url, writer) => {
  currentAccount = { id: 'student-two', role: 'student', is_suspended: false };
  const response = await request(app)[method](url).set('Cookie', `eraedu_session=${tokenFor('student-two', 'student')}`)
    .set('X-EraEdu-Account', 'teacher-one').send({ title: 'Old teacher draft', questions: [] });
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('SESSION_ACCOUNT_CHANGED');
  expect(writer).not.toHaveBeenCalled();
});
it.each(endpoints)('an active admin retains access to %s %s', async (method, url, writer) => {
  currentAccount = { id: 'admin-one', role: 'admin', is_suspended: false };
  const response = await request(app)[method](url).set('Cookie', `eraedu_session=${tokenFor('admin-one', 'admin')}`)
    .set('X-EraEdu-Account', 'admin-one').send({ title: 'Admin resource', questions: [] });
  expect(response.status).toBe(method === 'post' ? 201 : 200);
  expect(writer).toHaveBeenCalledTimes(1);
  expect(writer.mock.calls[0]).toContain('admin-one');
});
it('also stops a replaced teacher session from creating under another teacher account', async () => {
  currentAccount = { id: 'teacher-two', role: 'teacher', is_suspended: false };
  const response = await request(app).post('/api/courses')
    .set('Cookie', `eraedu_session=${tokenFor('teacher-two', 'teacher')}`)
    .set('X-EraEdu-Account', 'teacher-one').send({ title: 'Old teacher draft' });
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('SESSION_ACCOUNT_CHANGED');
  expect(mockCreateCourse).not.toHaveBeenCalled();
});
it('explains a genuine student role denial without granting teacher privileges', async () => {
  currentAccount = { id: 'student-two', role: 'student', is_suspended: false };
  const response = await request(app).post('/api/quizzes')
    .set('Cookie', `eraedu_session=${tokenFor('student-two', 'student')}`).send({ title: 'Unauthorized exam' });
  expect(response.status).toBe(403);
  expect(response.body.error).toMatchObject({ code: 'ROLE_FORBIDDEN', currentRole: 'student', requiredRoles: ['teacher', 'admin'] });
  expect(response.body.message).toContain('student');
  expect(mockCreateQuiz).not.toHaveBeenCalled();
});
it('a forged account header never grants access to a teacher action', async () => {
  currentAccount = { id: 'student-two', role: 'student', is_suspended: false };
  const response = await request(app).post('/api/courses')
    .set('Cookie', `eraedu_session=${tokenFor('student-two', 'student')}`)
    .set('X-EraEdu-Account', 'student-two').send({ title: 'Unauthorized course' });
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe('ROLE_FORBIDDEN');
  expect(mockCreateCourse).not.toHaveBeenCalled();
});

it('passes the edited course and settings from the update endpoint to the save service', async () => {
  const changes = { title: 'Edited exam', courseId: 'course-two', scheduledStart: '2026-10-25T16:14:00.000Z',
    questions: [{ text: 'Question', options: ['A', 'B'], correctAnswer: 1 }], cameraMonitoring: false, violationLimit: 4 };
  const response = await request(app).put('/api/quizzes/exam-one')
    .set('Cookie', `eraedu_session=${tokenFor('teacher-one', 'teacher')}`)
    .set('X-EraEdu-Account', 'teacher-one').send(changes);
  expect(response.status).toBe(200);
  expect(mockUpdateQuiz).toHaveBeenCalledWith('exam-one', 'teacher-one', expect.objectContaining(changes));
});
