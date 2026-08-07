import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['req.headers.authorization', 'req.body.password', 'req.body.token', 'req.body.tempToken', 'req.body.faceEncoding', 'req.body.profilePicture', 'res.headers.set-cookie'],
    censor: '[REDACTED]',
  },
  base: { service: 'eraedu-api' },
});
