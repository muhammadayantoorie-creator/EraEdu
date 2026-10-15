process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockFetch = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));
jest.mock('../config/environment', () => ({ config: {
  safepayEnvironment: 'sandbox', safepaySecretKey: 'sandbox-secret',
  safepayPublicKey: 'sandbox-public', safepayWebhookSecret: 'isolated-webhook-secret',
  frontendAppUrl: 'http://localhost:3000', safepayInstitutionPricePkr: 4999,
} }));
jest.mock('@sfpy/node-core', () => ({ __esModule: true,
  default: jest.fn().mockImplementation(() => ({ reporter: { payments: { fetch: mockFetch } } })),
}));
jest.mock('../middleware/auth', () => ({
  protect: (req: any, _res: any, next: any) => { req.user = { _id: 'teacher-1', role: 'teacher' }; next(); },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import crypto from 'crypto';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import safepayRouter, { safepayWebhook } from '../routes/safepay';

const app = express();
app.post('/webhook', express.raw({ type: 'application/json' }), safepayWebhook);
app.use(express.json());
app.use('/api/safepay', safepayRouter);

let owner = 'teacher-1';
let status = 'pending';
let entitlement = 'free';
let activations = 0;
let failTransition = false;

const signedWebhook = (tracker = 'isolated-tracker') => {
  const body = JSON.stringify({ notification: { tracker } });
  const signature = crypto.createHmac('sha512', 'isolated-webhook-secret').update(body).digest('hex');
  return request(app).post('/webhook').set('Content-Type', 'application/json')
    .set('x-sfpy-signature', signature).send(body);
};

beforeEach(() => {
  owner = 'teacher-1';
  status = 'pending';
  entitlement = 'free';
  activations = 0;
  failTransition = false;
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockFetch.mockReset();
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'safepay_payments') throw new Error(`Unexpected table ${table}`);
    const filters: Record<string, string> = {};
    const query = {
      eq: (column: string, value: string) => { filters[column] = value; return query; },
      maybeSingle: async () => ({ data: filters.tracker_token === 'isolated-tracker' &&
        (!filters.user_id || filters.user_id === owner) ? { tracker_token: 'isolated-tracker' } : null,
      error: null }),
    };
    return { select: () => query };
  });
  mockRpc.mockImplementation(async (_name: string, args: any) => {
    if (failTransition) return { data: null, error: { code: 'P0001', message: 'temporary write failure' } };
    if (args.p_user_id && args.p_user_id !== owner) return { data: null, error: null };
    const nextStatus = ['paid', 'failed', 'cancelled'].includes(status) ? status : args.p_verified_status;
    if (nextStatus === 'paid' && status !== 'paid') { entitlement = 'active'; activations += 1; }
    status = nextStatus;
    return { data: status, error: null };
  });
});

describe('verified Safepay entitlement transition', () => {
  it.each([
    ['TRACKER_STARTED', 'pending', 'free'],
    ['TRACKER_EXPIRED', 'failed', 'free'],
    ['TRACKER_CANCELLED', 'cancelled', 'free'],
    ['TRACKER_ENDED', 'paid', 'active'],
  ])('polling server state %s returns %s without granting an unverified plan', async (state, expectedStatus, expectedEntitlement) => {
    mockFetch.mockResolvedValue({ data: { state } });
    const response = await request(app).get('/api/safepay/status/isolated-tracker');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(expectedStatus);
    expect(entitlement).toBe(expectedEntitlement);
    expect(mockRpc).toHaveBeenCalledWith('apply_verified_safepay_payment', {
      p_tracker_token: 'isolated-tracker', p_verified_status: expectedStatus, p_user_id: 'teacher-1',
    });
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('serializes repeated webhook and poll processing and never treats a later tracker state as an automatic refund', async () => {
    mockFetch.mockResolvedValue({ data: { state: 'TRACKER_ENDED' } });
    expect((await request(app).get('/api/safepay/status/isolated-tracker')).body.data.status).toBe('paid');
    expect((await signedWebhook()).status).toBe(200);
    mockFetch.mockResolvedValue({ data: { state: 'TRACKER_REVERSED' } });
    expect((await request(app).get('/api/safepay/status/isolated-tracker')).body.data.status).toBe('paid');
    expect(activations).toBe(1);
    expect(entitlement).toBe('active');
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['failed', 'TRACKER_STARTED'],
    ['cancelled', 'TRACKER_STARTED'],
  ])('does not regress a terminal %s checkout when a delayed provider response is %s', async (initialStatus, trackerState) => {
    status = initialStatus;
    mockFetch.mockResolvedValue({ data: { state: trackerState } });

    const response = await request(app).get('/api/safepay/status/isolated-tracker');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(initialStatus);
    expect(entitlement).toBe('free');
  });

  it('leaves a failed transition retryable without a paid-but-inactive marker', async () => {
    mockFetch.mockResolvedValue({ data: { state: 'TRACKER_ENDED' } });
    failTransition = true;
    const failedPoll = await request(app).get('/api/safepay/status/isolated-tracker');
    expect(failedPoll.status).toBe(502);
    expect(status).toBe('pending');
    expect(entitlement).toBe('free');
    expect((await signedWebhook()).status).toBe(503);
    failTransition = false;
    const recovered = await request(app).get('/api/safepay/status/isolated-tracker');
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.status).toBe('paid');
    expect(entitlement).toBe('active');
    expect(activations).toBe(1);
  });

  it('does not let a different teacher poll another owner’s tracker', async () => {
    owner = 'teacher-2';
    const response = await request(app).get('/api/safepay/status/isolated-tracker');
    expect(response.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a forged webhook before provider lookup or database writes', async () => {
    const response = await request(app).post('/webhook').set('Content-Type', 'application/json')
      .set('x-sfpy-signature', 'invalid').send(JSON.stringify({ notification: { tracker: 'isolated-tracker' } }));
    expect(response.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('requires the additive RPC migration and never falls back to separate writes', async () => {
    mockFetch.mockResolvedValue({ data: { state: 'TRACKER_ENDED' } });
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
    const response = await request(app).get('/api/safepay/status/isolated-tracker');
    expect(response.status).toBe(502);
    expect(response.body.error.message).toContain('028_atomic_safepay_entitlement.sql');
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('locks the tracker and writes entitlement and paid status in the same restricted database function', () => {
    const sql = readFileSync(join(__dirname, '../../migrations/028_atomic_safepay_entitlement.sql'), 'utf8');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain("UPDATE public.organizations SET subscription_status = 'active'");
    expect(sql).toContain("UPDATE public.users SET subscription_status = 'active'");
    expect(sql).toContain('UPDATE public.safepay_payments');
    expect(sql).toContain("IF v_status = v_payment.status THEN RETURN v_status; END IF;");
    expect(sql).toContain("WHEN v_payment.status IN ('paid', 'failed', 'cancelled') THEN v_payment.status");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.apply_verified_safepay_payment');
  });
});
