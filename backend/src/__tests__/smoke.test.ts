/**
 * Smoke tests — verify core API routes return expected status codes
 * without a real database connection. These run in CI with placeholder env vars.
 */

// Set env vars before importing app so environment.ts doesn't throw
process.env.JWT_SECRET     = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL   = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY   = 'placeholder-anon-key';
process.env.NODE_ENV       = 'test';
process.env.GITHUB_PAGES_ORIGIN = require('../../vercel.json').env.GITHUB_PAGES_ORIGIN;
process.env.SAFEPAY_WEBHOOK_SECRET = '';

import request from 'supertest';

// Smoke checks are deterministic and never contact an external database.
// A failing readiness dependency is explicit; it is not an accepted 500 on a
// route that is supposed to work.
jest.mock('../config/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => {
        const result = { data: null, count: null, error: { message: 'Isolated readiness failure' } };
        return { ...result, limit: async () => result };
      },
    }),
  },
}));

// Lazy import so env vars above are set first
let app: any;
beforeAll(async () => {
  // Suppress console noise during tests
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  app = (await import('../index')).default;
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('GitHub Pages browser access', () => {
  const pagesOrigin = process.env.GITHUB_PAGES_ORIGIN!;
  it('allows credentialed preflights and login validation from the exact deployed Pages origin', async () => {
    const preflight = await request(app).options('/api/auth/me').set('Origin', pagesOrigin)
      .set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'content-type');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(pagesOrigin);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    const login = await request(app).post('/api/auth/login').set('Origin', pagesOrigin).send({});
    expect(login.status).toBe(400);
    expect(login.body.error.fields).toBeDefined();
  });
  it('rejects other Pages tenants, deceptive suffixes and Origin values containing a path', async () => {
    for (const origin of ['https://another-owner.github.io', `${pagesOrigin}.evil.test`, `${pagesOrigin}/EraEdu`]) {
      const response = await request(app).options('/api/auth/me').set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET');
      expect(response.status).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
describe('Health endpoint', () => {
  it('GET /health reports exactly 503 when its isolated database dependency fails', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.database).toBe('degraded');
  });

  it('GET / returns API running message', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/EraEdu/i);
  });
});

// ---------------------------------------------------------------------------
describe('Auth routes — unauthenticated behaviour', () => {
  it('POST /api/auth/login rejects a missing body before database access', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'email' }),
      expect.objectContaining({ field: 'password' }),
    ]));
  });

  it('POST /api/auth/login rejects a malformed email before database access', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'not-an-email', password: 'WrongPassword1' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'email' }),
    ]));
  });

  it('POST /api/auth/forgot-password rejects a malformed email before database access', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'email' }),
    ]));
  });

  it('POST /api/auth/register rejects non-university student email addresses', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test Student',
        email: 'student@example.com',
        password: 'ValidPass1',
        role: 'student',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nutech\.edu\.pk/i);
  });
});

// ---------------------------------------------------------------------------
describe('Protected routes — require valid JWT', () => {
  it('GET /api/quizzes/history without token returns 401', async () => {
    const res = await request(app).get('/api/quizzes/history');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  it('GET /api/auth/me without token returns 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('POST /api/quizzes/attempts/fake-id/report-violation without token returns 401', async () => {
    const res = await request(app)
      .post('/api/quizzes/attempts/fake-id/report-violation')
      .send({ violationType: 'tab_change' });
    expect(res.status).toBe(401);
  });

  it('GET /api/ai/recommendations without token returns 401', async () => {
    const res = await request(app).get('/api/ai/recommendations');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('Safepay webhook CSRF exemption', () => {
  it('reaches webhook verification despite an unrelated Origin and cookie', async () => {
    const res = await request(app)
      .post('/api/safepay/webhook')
      .set('Cookie', 'eraedu_session=example-session')
      .set('Origin', 'https://safepay.example')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(503);
    expect(res.text).toBe('Webhook is not configured');
  });
});

describe('Rate limiting headers present', () => {
  it('POST /api/auth/login returns rate limit headers', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({});
    // RateLimit headers should be present
    const hasRateLimitHeader =
      'ratelimit-limit' in res.headers ||
      'x-ratelimit-limit' in res.headers ||
      'retry-after' in res.headers;
    expect(res.status).toBe(400);
    expect(hasRateLimitHeader).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('404 handling', () => {
  it('Unknown route returns 404 JSON', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
