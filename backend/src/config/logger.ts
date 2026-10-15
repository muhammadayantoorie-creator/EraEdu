import pino from 'pino';
import { Request } from 'express';

export const loggerOptions = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.cookies',
      'req.body.password',
      'req.body.token',
      'req.body.tempToken',
      'req.body.faceEncoding',
      'req.body.profilePicture',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'eraedu-api' },
};

export const logger = pino(loggerOptions);

// Never log raw URLs, query strings, headers or bodies: they can contain
// payment trackers, reset tokens, session cookies and submitted answers.
export const serializeHttpRequest = (req: { id?: string | number; method?: string; remoteAddress?: string }) => ({
  id: req.id,
  method: req.method,
  remoteAddress: req.remoteAddress,
});

// A route template is safe to log; the actual URL may contain sensitive IDs
// or tokens. Middleware failures and unknown routes have no route template.
export const safeRouteLabel = (req: Request): string =>
  typeof req.route?.path === 'string' ? `${req.baseUrl || ''}${req.route.path}` : '[unmatched route]';
