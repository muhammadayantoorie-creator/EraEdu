// The course CRUD routes use this middleware before createCourse. Keep this
// isolated from Supabase so the role boundary is covered without test data.
process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

import type { NextFunction, Request, Response } from 'express';

let authorize: typeof import('../middleware/auth').authorize;

beforeAll(async () => {
  ({ authorize } = await import('../middleware/auth'));
});

describe('course creation authorization', () => {
  it('rejects a student before the create-course controller can run', () => {
    const req = { user: { _id: 'student-1', role: 'student' } } as Request;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;
    const next = jest.fn() as NextFunction;

    authorize('teacher', 'admin')(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('not authorized'),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['teacher', 'admin'])('allows a %s to reach the create-course controller', (role) => {
    const req = { user: { _id: `${role}-1`, role } } as Request;
    const res = {} as Response;
    const next = jest.fn() as NextFunction;

    authorize('teacher', 'admin')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
