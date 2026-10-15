process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockUpdateUser = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/adminService', () => ({ adminService: { updateUser: mockUpdateUser } }));

import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { protect, authorize } from '../middleware/auth';
import { authService } from '../services/authService';
import adminRouter from '../routes/admin';
import { errorHandler } from '../middleware/errorHandler';

type Account = { id: string; role: string; is_suspended: boolean | null };
const accounts = new Map<string, Account>();
let lookupError: unknown = null;
const secret = process.env.JWT_SECRET!;
const tokenFor = (id: string, role: string) => jwt.sign({ id, role }, secret, { expiresIn: '1h' });

const app = express();
app.use(express.json(), cookieParser());
app.get('/protected', protect, (req, res) => res.json({ id: req.user!._id, role: req.user!.role }));
app.get('/teacher', protect, authorize('teacher'), (_req, res) => res.json({ ok: true }));
app.get('/admin', protect, authorize('admin'), (_req, res) => res.json({ ok: true }));
app.use('/admin-api', adminRouter);
app.use(errorHandler);

beforeEach(() => {
  accounts.clear();
  lookupError = null;
  mockFrom.mockReset();
  mockUpdateUser.mockReset();
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'users') throw new Error(`Unexpected table ${table}`);
    return { select: () => ({ eq: (_column: string, id: string) => ({
      maybeSingle: async () => {
        if (lookupError instanceof Error) throw lookupError;
        return { data: accounts.get(id) || null, error: lookupError };
      },
    }) }) };
  });
});

describe('current account authorization', () => {
  it('accepts valid cookie and Bearer sessions using the current server role', async () => {
    accounts.set('admin-1', { id: 'admin-1', role: 'admin', is_suspended: false });
    const token = tokenFor('admin-1', 'admin');
    expect((await request(app).get('/admin').set('Cookie', `eraedu_session=${token}`)).status).toBe(200);
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    // A stale browser cookie must not shadow an explicitly supplied valid Bearer token.
    expect((await request(app).get('/admin').set('Cookie', 'eraedu_session=invalid')
      .set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  it('denies an already signed-in teacher immediately after suspension and restores access afterwards', async () => {
    const account: Account = { id: 'teacher-1', role: 'teacher', is_suspended: false };
    accounts.set(account.id, account);
    const token = tokenFor(account.id, 'teacher');
    expect((await request(app).get('/teacher').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    account.is_suspended = true;
    const denied = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ACCOUNT_SUSPENDED');
    account.is_suspended = false;
    expect((await request(app).get('/teacher').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  it('revokes an old admin token after role demotion even on a generic protected route', async () => {
    const account: Account = { id: 'admin-1', role: 'admin', is_suspended: false };
    accounts.set(account.id, account);
    const oldToken = tokenFor(account.id, 'admin');
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${oldToken}`)).status).toBe(200);
    account.role = 'student';
    const denied = await request(app).get('/protected').set('Authorization', `Bearer ${oldToken}`);
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('ROLE_CHANGED');
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);
    const staleMutation = await request(app).patch('/admin-api/users/student-2')
      .set('Authorization', `Bearer ${oldToken}`).send({ isSuspended: true });
    expect(staleMutation.status).toBe(401);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    const newToken = tokenFor(account.id, 'student');
    expect((await request(app).get('/protected').set('Authorization', `Bearer ${newToken}`)).status).toBe(200);
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${newToken}`)).body.error.code).toBe('ROLE_FORBIDDEN');
  });

  it('denies missing, invalid and deleted accounts without trusting a token role', async () => {
    expect((await request(app).get('/protected')).body.error.code).toBe('AUTH_REQUIRED');
    expect((await request(app).get('/protected').set('Authorization', 'Bearer invalid')).body.error.code).toBe('SESSION_INVALID');
    const deleted = await request(app).get('/protected').set('Authorization', `Bearer ${tokenFor('deleted-1', 'admin')}`);
    expect(deleted.status).toBe(401);
    expect(deleted.body.error.code).toBe('ACCOUNT_UNAVAILABLE');
    accounts.set('unknown-1', { id: 'unknown-1', role: 'unknown', is_suspended: false });
    expect((await request(app).get('/protected').set('Authorization', `Bearer ${tokenFor('unknown-1', 'unknown')}`)).status).toBe(403);
  });

  it('fails closed but retryably when the account lookup or suspension column is unavailable', async () => {
    accounts.set('teacher-1', { id: 'teacher-1', role: 'teacher', is_suspended: false });
    const token = tokenFor('teacher-1', 'teacher');
    lookupError = { code: '42703', message: 'is_suspended missing' };
    const failed = await request(app).get('/teacher').set('Authorization', `Bearer ${token}`);
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('AUTH_SCHEMA_REQUIRED');
    expect(failed.body.message).toContain('migration 029');
    lookupError = new Error('temporary network failure');
    expect((await request(app).get('/teacher').set('Authorization', `Bearer ${token}`)).status).toBe(503);
    lookupError = null;
    accounts.set('teacher-1', { id: 'teacher-1', role: 'teacher', is_suspended: null });
    expect((await request(app).get('/teacher').set('Authorization', `Bearer ${token}`)).status).toBe(503);
  });

  it('does not let another account mutate roles or suspension through the admin route', async () => {
    accounts.set('student-1', { id: 'student-1', role: 'student', is_suspended: false });
    accounts.set('admin-1', { id: 'admin-1', role: 'admin', is_suspended: false });
    const studentToken = tokenFor('student-1', 'student');
    const adminToken = tokenFor('admin-1', 'admin');
    const denied = await request(app).patch('/admin-api/users/student-2')
      .set('Authorization', `Bearer ${studentToken}`).send({ role: 'admin' });
    expect(denied.status).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    const selfChange = await request(app).patch('/admin-api/users/admin-1')
      .set('Authorization', `Bearer ${adminToken}`).send({ isSuspended: false });
    expect(selfChange.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    const invalid = await request(app).patch('/admin-api/users/student-2')
      .set('Authorization', `Bearer ${adminToken}`).send({ isSuspended: 'false' });
    expect(invalid.status).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
    mockUpdateUser.mockResolvedValue({ id: 'student-2', role: 'student', is_suspended: true });
    const updated = await request(app).patch('/admin-api/users/student-2')
      .set('Authorization', `Bearer ${adminToken}`).send({ isSuspended: true });
    expect(updated.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith('student-2', { isSuspended: true }, 'admin-1');
  });

  it('issues sessions only for currently active, supported account roles', async () => {
    const user = {
      id: 'admin-1', name: 'Isolated Admin', email: 'admin@example.test', role: 'admin',
      is_suspended: false as boolean | null, password: bcrypt.hashSync('StrongPass123', 4),
    };
    mockFrom.mockImplementation(() => ({ select: () => ({ eq: async () => ({ data: [user], error: null }) }) }));
    const login = await authService.login({ email: user.email, password: 'StrongPass123' });
    expect(login.user.role).toBe('admin');
    expect(jwt.verify(login.token, secret)).toMatchObject({ id: 'admin-1', role: 'admin' });
    user.role = 'legacy-role';
    await expect(authService.login({ email: user.email, password: 'StrongPass123' }))
      .rejects.toMatchObject({ statusCode: 403 });
    user.is_suspended = null;
    await expect(authService.login({ email: user.email, password: 'StrongPass123' }))
      .rejects.toMatchObject({ statusCode: 503 });
    user.role = 'admin';
    user.is_suspended = true;
    await expect(authService.login({ email: user.email, password: 'StrongPass123' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
