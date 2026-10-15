process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { config } from '../config/environment';
import { requireTrustedBrowserOrigin } from '../middleware/csrf';

const app = express();
app.use(cookieParser(), requireTrustedBrowserOrigin);
app.get('/mutation', (_req, res) => res.sendStatus(200));
app.post('/mutation', (_req, res) => res.sendStatus(204));
app.post('/api/auth/login', (_req, res) => res.sendStatus(204));
app.post('/api/auth/verify-student-otp', (_req, res) => res.sendStatus(204));
app.post('/api/auth/verify-face-login', (_req, res) => res.sendStatus(204));

const cookie = 'eraedu_session=example-session';
const trustedOrigin = config.frontendUrl;

describe('cookie-auth browser origin boundary', () => {
  it('accepts a configured exact Origin for a cookie-auth mutation', async () => {
    const response = await request(app).post('/mutation').set('Cookie', cookie).set('Origin', trustedOrigin);
    expect(response.status).toBe(204);
  });

  it('rejects a foreign, null or missing Origin even if CORS would hide the response', async () => {
    for (const origin of ['https://evil.example', 'null']) {
      const response = await request(app).post('/mutation').set('Cookie', cookie).set('Origin', origin);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CSRF_ORIGIN_FORBIDDEN');
    }
    const missing = await request(app).post('/mutation').set('Cookie', cookie);
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('CSRF_ORIGIN_FORBIDDEN');
  });

  it('accepts a trusted Referer only when Origin is absent, and rejects a conflicting Origin', async () => {
    const referer = `${trustedOrigin}/dashboard/student`;
    expect((await request(app).post('/mutation').set('Cookie', cookie).set('Referer', referer)).status).toBe(204);
    expect((await request(app).post('/mutation').set('Cookie', cookie)
      .set('Origin', 'null').set('Referer', referer)).status).toBe(403);
    expect((await request(app).post('/mutation').set('Cookie', cookie)
      .set('Referer', 'not-a-url')).status).toBe(403);
  });

  it('does not require browser origin headers for an explicit Bearer client or safe read', async () => {
    expect((await request(app).post('/mutation').set('Cookie', cookie)
      .set('Authorization', 'Bearer explicit-token')).status).toBe(204);
    expect((await request(app).post('/mutation')).status).toBe(204);
    expect((await request(app).get('/mutation').set('Cookie', cookie)).status).toBe(200);
  });

  it.each(['/api/auth/login', '/api/auth/verify-student-otp', '/api/auth/verify-face-login'])(
    'requires a trusted origin before %s can set a session cookie', async (path) => {
      expect((await request(app).post(path).set('Origin', trustedOrigin)).status).toBe(204);
      expect((await request(app).post(path).set('Origin', 'https://evil.example')).status).toBe(403);
      expect((await request(app).post(path)).status).toBe(403);
    },
  );

  it('guards equivalent case and trailing-slash login URLs', async () => {
    expect((await request(app).post('/API/AUTH/LOGIN/')).status).toBe(403);
    expect((await request(app).post('/API/AUTH/LOGIN/').set('Origin', trustedOrigin)).status).toBe(204);
  });
});
