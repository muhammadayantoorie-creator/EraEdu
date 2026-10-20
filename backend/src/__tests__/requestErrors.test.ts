process.env.NODE_ENV = 'production';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../middleware/errorHandler';
import { teacherTimingSchemaError, legacyTeacherAttemptError } from '../services/teacherTimingSchema';

const app = express();
app.use(express.json({ limit: '100b' }));
app.post('/body', (_req, res) => res.json({ success: true }));
app.get('/cors', (_req, _res, next) => next(new Error('Not allowed by CORS')));
app.get('/timing', (_req, _res, next) => next(teacherTimingSchemaError({ code: 'PGRST202',
  message: 'Could not find the function public.start_teacher_attempt in the schema cache' })));
app.get('/legacy-attempt', (_req, _res, next) => next(legacyTeacherAttemptError()));
app.use(errorHandler);
beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => jest.restoreAllMocks());
it('malformed JSON returns a safe 400 instead of 500 or raw parser text', async () => {
  const response = await request(app).post('/body').set('Content-Type', 'application/json').send('{"private":');
  expect(response.status).toBe(400);
  expect(response.body.error.message).toBe('Request body must contain valid JSON.');
  expect(response.body).not.toHaveProperty('stack');
});
it('oversized requests return 413 with a safe explanation', async () => {
  const response = await request(app).post('/body').send({ data: 'x'.repeat(200) });
  expect(response.status).toBe(413);
  expect(response.body.error.message).toBe('Request body is too large.');
});
it('a rejected browser origin returns 403', async () => {
  const response = await request(app).get('/cors');
  expect(response.status).toBe(403);
  expect(response.body.error.message).toBe('Request origin is not allowed.');
});
it('missing timing setup returns a stable 503 code without exposing the raw database error', async () => {
  const response = await request(app).get('/timing');
  expect(response.status).toBe(503);
  expect(response.body.error.code).toBe('TEACHER_TIMING_SCHEMA_REQUIRED');
  expect(response.body.message).toContain('027_teacher_attempt_deadlines.sql');
  expect(JSON.stringify(response.body)).not.toContain('PGRST202');
  expect(response.body).not.toHaveProperty('stack');
});
it('a preserved legacy attempt returns a review conflict rather than another migration instruction', async () => {
  const response = await request(app).get('/legacy-attempt');
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('LEGACY_TEACHER_ATTEMPT_REVIEW_REQUIRED');
  expect(response.body.message).toContain('cannot be resumed');
  expect(JSON.stringify(response.body)).not.toContain('027_teacher_attempt_deadlines.sql');
});
