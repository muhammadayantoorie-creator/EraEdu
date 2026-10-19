process.env.NODE_ENV = 'production';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../middleware/errorHandler';

const app = express();
app.use(express.json({ limit: '100b' }));
app.post('/body', (_req, res) => res.json({ success: true }));
app.get('/cors', (_req, _res, next) => next(new Error('Not allowed by CORS')));
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
