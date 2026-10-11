process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/emailService', () => ({ emailService: {} }));

import { authService } from '../services/authService';
import { protect } from '../middleware/auth';
import type { NextFunction, Request, Response } from 'express';

beforeEach(() => mockFrom.mockReset());

it('saves permitted profile fields and reloads them without returning credentials', async () => {
  let stored: Record<string, any> = {
    id: 'teacher-1', name: 'Teacher', email: 'teacher@example.test', role: 'teacher',
    bio: '', interests: [], password: 'hashed-secret',
  };
  const selected: string[] = [];
  const query: any = {
    update: (patch: Record<string, any>) => { stored = { ...stored, ...patch }; return query; },
    select: (columns: string) => { selected.push(columns); return query; },
    eq: () => query,
    single: async () => ({
      data: Object.fromEntries(selected[selected.length - 1].split(',').map(column => {
        const key = column.trim();
        return [key, stored[key]];
      })),
      error: null,
    }),
  };
  mockFrom.mockReturnValue(query);

  const saved = await authService.updateProfile('teacher-1', {
    name: '  Updated Teacher  ', bio: 'Course lead', interests: ['Physics'], role: 'admin',
  });
  expect(saved).toMatchObject({ name: 'Updated Teacher', bio: 'Course lead', interests: ['Physics'], role: 'teacher' });
  expect(saved).not.toHaveProperty('password');
  expect(stored.role).toBe('teacher');
  expect((await authService.getCurrentUser('teacher-1'))).toMatchObject({
    name: 'Updated Teacher', bio: 'Course lead', interests: ['Physics'],
  });
  expect(selected[0]).not.toContain('password');
});

it('denies an anonymous profile write before reaching the service', async () => {
  const req = { cookies: {}, headers: {} } as Request;
  const json = jest.fn();
  const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
  const next = jest.fn() as NextFunction;
  await protect(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
});
