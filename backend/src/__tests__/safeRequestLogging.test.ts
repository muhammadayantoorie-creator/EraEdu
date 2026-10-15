process.env.NODE_ENV = 'test';

import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { Writable } from 'stream';
import { loggerOptions, serializeHttpRequest } from '../config/logger';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

const captureLogs = () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
};

describe('safe request logging', () => {
  it('omits raw URLs, query secrets, cookies and authorization from HTTP logs', async () => {
    const { lines, stream } = captureLogs();
    const testLogger = pino({ ...loggerOptions, level: 'info' }, stream);
    const app = express();
    app.use(pinoHttp({ logger: testLogger, serializers: { req: serializeHttpRequest } }));
    app.get('/api/payments/:tracker', (_req, res) => {
      res.cookie('eraedu_session', 'response-secret');
      res.sendStatus(200);
    });

    await request(app).get('/api/payments/path-secret?token=query-secret')
      .set('Cookie', 'eraedu_session=cookie-secret')
      .set('Authorization', 'Bearer bearer-secret');

    const logged = lines.join('');
    expect(logged).toContain('"statusCode":200');
    expect(logged).toContain('"method":"GET"');
    for (const secret of ['path-secret', 'query-secret', 'cookie-secret', 'bearer-secret', 'response-secret']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('redacts sensitive headers even when a structured log explicitly includes them', () => {
    const { lines, stream } = captureLogs();
    const testLogger = pino({ ...loggerOptions, level: 'info' }, stream);
    testLogger.info({
      req: { headers: { cookie: 'cookie-secret', authorization: 'bearer-secret' }, cookies: 'cookie-secret' },
      res: { headers: { 'set-cookie': 'response-secret' } },
    });
    const logged = lines.join('');
    expect(logged).toContain('[REDACTED]');
    expect(logged).not.toContain('cookie-secret');
    expect(logged).not.toContain('bearer-secret');
    expect(logged).not.toContain('response-secret');
  });

  it('does not echo an unknown URL or its query token in error logs or responses', async () => {
    const warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = express();
      app.use(notFoundHandler, errorHandler);
      const result = await request(app).get('/unknown/path-secret?token=query-secret');
      expect(result.status).toBe(404);
      const output = `${JSON.stringify(warnings.mock.calls)}${JSON.stringify(errors.mock.calls)}${JSON.stringify(result.body)}`;
      expect(output).not.toContain('path-secret');
      expect(output).not.toContain('query-secret');
      expect(result.body.error.message).toBe('Route not found');
    } finally {
      warnings.mockRestore();
      errors.mockRestore();
    }
  });
});
