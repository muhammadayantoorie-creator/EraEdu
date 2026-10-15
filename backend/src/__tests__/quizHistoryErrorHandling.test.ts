process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();

jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/authService', () => ({ assertStudentEmailPolicy: jest.fn() }));

import { quizService } from '../services/quizService';

describe('quiz history errors', () => {
  beforeEach(() => mockFrom.mockReset());

  it('returns a genuine empty history when the query succeeds with no attempts', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ order: async () => ({ data: [], error: null }) }),
      }),
    });

    await expect(quizService.getQuizHistory('student-1')).resolves.toEqual([]);
  });

  it('propagates a storage failure instead of reporting a false empty history', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ order: async () => ({ data: null, error: { message: 'database unavailable' } }) }),
      }),
    });

    await expect(quizService.getQuizHistory('student-1')).rejects.toThrow('database unavailable');
  });
});
