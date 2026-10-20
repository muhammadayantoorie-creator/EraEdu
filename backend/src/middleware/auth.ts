import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/environment';
import { supabase } from '../config/supabase';
import { accountStateError, assertActiveAccount, isAccountSchemaError } from '../services/accountState';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        _id: string;
        role: string;
      };
    }
  }
}

const accountRoles = new Set(['student', 'teacher', 'admin']);
const deny = (res: Response, status: number, code: string, message: string,
  details?: { currentRole: string; requiredRoles: string[] }) =>
  res.status(status).json({ success: false, message, error: { code, message, ...details } });

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  // An explicit Bearer token takes precedence if a client also has a browser cookie.
  const bearerToken = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const token = bearerToken || req.cookies?.eraedu_session;
  if (!token) return deny(res, 401, 'AUTH_REQUIRED', 'Not authorized. Sign in to continue.');

  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch {
    return deny(res, 401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.');
  }
  if (typeof decoded !== 'object' || typeof decoded.id !== 'string' || !decoded.id || typeof decoded.role !== 'string') {
    return deny(res, 401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.');
  }

  let liveUser: { id: string; role: string; is_suspended: boolean } | null;
  try {
    const result = await supabase.from('users')
      .select('id, role, is_suspended').eq('id', decoded.id).maybeSingle();
    if (result.error) {
      const failure = accountStateError(isAccountSchemaError(result.error));
      console.error('Authorization state lookup failed:', failure.code);
      return deny(res, failure.statusCode, failure.code, failure.message);
    }
    liveUser = result.data;
  } catch {
    const failure = accountStateError();
    console.error('Authorization state lookup failed:', failure.code);
    return deny(res, failure.statusCode, failure.code, failure.message);
  }

  if (!liveUser) return deny(res, 401, 'ACCOUNT_UNAVAILABLE', 'This account is no longer available. Please sign in again.');
  // Fail closed on unknown state; migration 029 reconciles the column contract.
  try { assertActiveAccount(liveUser); }
  catch (error: any) { return deny(res, error.statusCode, error.code, error.message); }
  if (!accountRoles.has(liveUser.role)) return deny(res, 403, 'ACCOUNT_ROLE_INVALID', 'This account has no supported access role. Please contact support.');
  // The signed role is never used to authorize a request. Comparing it only
  // revokes older tokens immediately after an administrator changes the role.
  if (decoded.role !== liveUser.role) return deny(res, 401, 'ROLE_CHANGED', 'Your account role changed. Please sign in again.');

  // A shared browser cookie can be replaced by signing in from another tab or
  // frontend. This hint can only reject a different identity; it never grants
  // access or replaces the identity verified above.
  const expectedAccount = req.get('X-EraEdu-Account');
  if (expectedAccount !== undefined && expectedAccount !== liveUser.id) {
    return deny(res, 401, 'SESSION_ACCOUNT_CHANGED', 'Your browser session changed to another account. Please sign in again before continuing.');
  }

  req.user = { _id: liveUser.id, role: liveUser.role };
  next();
};

export const authorize = (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return deny(res, 401, 'AUTH_REQUIRED', 'Not authorized. Sign in to continue.');
  if (!roles.includes(req.user.role)) {
    return deny(res, 403, 'ROLE_FORBIDDEN',
      `You are signed in as a ${req.user.role}. This action requires a ${roles.join(' or ')} account.`,
      { currentRole: req.user.role, requiredRoles: roles });
  }
  next();
};
