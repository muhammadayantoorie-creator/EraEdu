process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));

import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import aiRoutes from '../routes/ai';
import { errorHandler } from '../middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/api/ai', aiRoutes);
app.use(errorHandler);

beforeEach(() => {
  mockFrom.mockReset();
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'users') throw new Error(`Unexpected table ${table}`);
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({
          data: { id: 'student-1', role: 'student', is_suspended: false }, error: null,
        }) }),
      }),
    };
  });
});

describe('learning recommendations availability', () => {
  it('requires a current authenticated account', async () => {
    const result = await request(app).get('/api/ai/recommendations');
    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe('AUTH_REQUIRED');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each(['/api/ai/recommendations', '/api/ai/insights'])(
    '%s returns honest unavailable data rather than fabricated performance',
    async (path) => {
      const token = jwt.sign({ id: 'student-1', role: 'student' }, process.env.JWT_SECRET!);
      const result = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ success: true, available: false, data: [] });
      expect(mockFrom).toHaveBeenCalledTimes(1);
    }
  );
});
