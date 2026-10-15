process.env.JWT_SECRET = 'isolated-auth-status-test-secret-at-least-32';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockWelcome = jest.fn().mockResolvedValue(undefined);
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom } }));
jest.mock('../services/emailService', () => ({ emailService: { sendWelcomeEmail: mockWelcome } }));

import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { authService } from '../services/authService';
import { register, login } from '../controllers/authController';
import { errorHandler } from '../middleware/errorHandler';
import { assertActiveAccount, isAccountSchemaError } from '../services/accountState';

const app = express();
app.use(express.json());
app.post('/register', register);
app.post('/login', login);
app.use(errorHandler);
const input = { name: 'Isolated Teacher', email: 'teacher@example.test', password: 'ExampleStrong123', role: 'teacher' };
const missingColumn = { code: '42703', message: 'column users.is_suspended does not exist' };

beforeEach(() => { mockFrom.mockReset(); mockWelcome.mockClear(); });

it.each([
  missingColumn,
  { code: 'PGRST204', message: "Could not find the 'is_suspended' column of 'users' in the schema cache" },
])('rejects registration before insert/email when required status schema is missing: %s', async error => {
  const insert = jest.fn();
  mockFrom.mockReturnValue({ select: () => ({ limit: async () => ({ error }) }), insert });
  const result = await request(app).post('/register').send(input);
  expect(result.status).toBe(503);
  expect(result.body.error.code).toBe('AUTH_SCHEMA_REQUIRED');
  expect(result.body.message).toContain('migration 029');
  expect(insert).not.toHaveBeenCalled();
  expect(mockWelcome).not.toHaveBeenCalled();
  expect(result.headers['set-cookie']).toBeUndefined();
});

it('registers an explicitly active server-owned account, then permits password sign-in', async () => {
  let saved: any;
  const insert = jest.fn(rows => {
    saved = { ...rows[0], id: 'isolated-teacher' };
    return { select: () => ({ single: async () => ({ data: saved, error: null }) }) };
  });
  mockFrom.mockReturnValue({
    select: () => ({ limit: async () => ({ error: null }), eq: async () => ({ data: saved ? [saved] : [], error: null }) }),
    insert,
  });
  const result = await request(app).post('/register').send({ ...input, is_suspended: true });
  expect(result.status).toBe(201);
  expect(saved.is_suspended).toBe(false);
  expect(saved.role).toBe('teacher');
  expect(await bcrypt.compare(input.password, saved.password)).toBe(true);
  expect(result.body.data.user).not.toHaveProperty('password');
  expect(mockWelcome).toHaveBeenCalledTimes(1);
  const signedIn = await request(app).post('/login').send(input);
  expect(signedIn.status).toBe(200);
  expect(signedIn.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(signedIn.body.data).not.toHaveProperty('token');
});

it.each([undefined, null, 'false', 0])('does not treat unknown or malformed suspension state as active: %s', value => {
  expect(() => assertActiveAccount({ is_suspended: value })).toThrow('migration 029');
});

it('distinguishes an unavailable database from a missing status column without leaking DB text', async () => {
  mockFrom.mockReturnValue({ select: () => ({ eq: async () => ({ error: { code: '08006', message: 'private connection details' } }) }) });
  const result = await request(app).post('/login').send(input);
  expect(result.status).toBe(503);
  expect(result.body.error.code).toBe('AUTH_STATE_UNAVAILABLE');
  expect(result.body.message).not.toContain('private');
  expect(result.headers['set-cookie']).toBeUndefined();
  expect(isAccountSchemaError({ code: '42703', message: 'column another_field missing' })).toBe(false);
});

it('keeps suspended accounts denied and returns a stable account code', async () => {
  mockFrom.mockReturnValue({ select: () => ({ eq: async () => ({ data: [{ ...input, is_suspended: true }], error: null }) }) });
  const result = await request(app).post('/login').send(input);
  expect(result.status).toBe(403);
  expect(result.body.error.code).toBe('ACCOUNT_SUSPENDED');
  expect(result.headers['set-cookie']).toBeUndefined();
});

it('does not allow registration to choose an admin role', async () => {
  await expect(authService.register({ ...input, role: 'admin' })).rejects.toMatchObject({ statusCode: 400 });
  expect(mockFrom).not.toHaveBeenCalled();
});
