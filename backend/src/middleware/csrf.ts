import { Request, Response, NextFunction } from 'express';
import { config } from '../config/environment';

// Keep the CSRF boundary and credentialed CORS on the same exact-origin list.
// A cross-origin form can send a request even when CORS prevents reading its
// response, so CORS alone does not protect the session cookie.
const localOrigins = config.nodeEnv === 'production' ? [] : [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
];

export const allowedBrowserOrigins = new Set([
  config.frontendUrl,
  ...localOrigins,
  ...config.additionalAllowedOrigins,
].filter(Boolean));

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
// Express routes are case-insensitive and accept trailing slashes by default.
const sessionSettingPath = /^\/api\/auth\/(?:login|verify-face-login|verify-student-otp)\/*$/i;

export const requireTrustedBrowserOrigin = (req: Request, res: Response, next: NextFunction) => {
  if (safeMethods.has(req.method)) return next();

  // An explicit Bearer token takes precedence over a cookie in protect().
  // Bearer-only API clients cannot be authenticated by a browser's ambient
  // cookie, while session-setting routes must always verify their origin.
  const hasBearerToken = /^Bearer\s+\S+$/i.test(req.headers.authorization || '');
  const setsSessionCookie = sessionSettingPath.test(req.path);
  if (!setsSessionCookie && (hasBearerToken || !req.cookies?.eraedu_session)) return next();

  const origin = req.get('Origin');
  if (origin) {
    if (allowedBrowserOrigins.has(origin)) return next();
  } else {
    // Some same-origin clients omit Origin. Accept a Referer only after
    // parsing its complete origin; absent or malformed headers fail closed.
    const referer = req.get('Referer');
    if (referer) {
      try {
        if (allowedBrowserOrigins.has(new URL(referer).origin)) return next();
      } catch { /* Reject malformed Referer below. */ }
    }
  }

  return res.status(403).json({
    success: false,
    error: {
      code: 'CSRF_ORIGIN_FORBIDDEN',
      message: 'Request origin is not allowed. Reload the app from its configured URL and retry.',
    },
  });
};
