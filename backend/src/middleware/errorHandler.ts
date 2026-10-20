import { Request, Response, NextFunction } from 'express';
import { safeRouteLabel } from '../config/logger';
import { ACCOUNT_SCHEMA_REQUIRED } from '../services/accountState';

const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

// Errors whose .message is safe to surface to clients verbatim. Any other
// message at status 500 is replaced with a generic 'Server error' so that
// raw DB / supabase errors do not leak schema details to attackers.
const SAFE_400_MESSAGES = new Set<string>([
  'Invalid credentials',
  'Not authorized',
  'No token provided',
  'User not found',
]);

const SAFE_OPERATIONAL_MESSAGES = new Set<string>([
  'Submission monitoring records could not be loaded. Please retry or contact an administrator.',
  'Unable to confirm the exam save. Retry the same request.',
  'Unable to verify the selected course. Please retry.',
  'Student submissions could not be loaded. Please retry.',
  'Analytics could not be loaded. Please retry.',
  'Unable to load enrollment statistics',
  ACCOUNT_SCHEMA_REQUIRED,
  'Exam settings storage is unavailable. Apply backend/migrations/016_complete_teacher_quiz_schema.sql before saving this exam.',
  'Account status is temporarily unavailable. Please retry.',
  'Teacher exam timing is unavailable. An administrator must apply backend/migrations/027_teacher_attempt_deadlines.sql.',
  'Monitoring schema migration required: apply backend/migrations/019_make_cheating_events_authoritative.sql',
  'Account governance setup is incomplete. Apply backend/migrations/008_add_user_suspension.sql, 020_add_admin_governance_audit.sql, and 026_atomic_admin_governance.sql.',
  'Student feedback storage is unavailable. An administrator must apply or reconcile backend/migrations/009_add_student_feedback.sql.',
  'Unable to verify this exam attempt right now. Please retry.',
  'Feedback could not be saved right now. Please retry.',
  'Feedback could not be confirmed right now. Please retry.',
  'Student feedback could not be loaded right now. Please retry.',
  'Course capacity schema is missing. Apply migrations 006_add_course_capacity.sql and 023_enforce_course_capacity_atomically.sql.',
  'Atomic enrollment is unavailable. Apply migration 023_enforce_course_capacity_atomically.sql.',
  'Course code schema is missing. Apply migration 015_add_course_code.sql.',
  'Invalid course capacity. Correct max_students before enrollment.',
  'Course assignment setup is incomplete. Apply backend/migrations/024_assign_courses_to_teachers.sql.',
  'Assessment history protection is required before deletion. Apply backend/migrations/025_preserve_assessment_history.sql.',
]);

export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  console.warn(`[404] Route not found: ${req.method}`);
  const error: any = new Error('Route not found');
  error.statusCode = 404;
  next(error);
};

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  // Log a route template, never a raw URL with query tokens. In production,
  // arbitrary error messages can themselves include client-supplied secrets.
  console.error(`[Error] ${req.method} ${safeRouteLabel(req)}:`, isProd ? (err?.name || 'Error') : (err?.message || err));
  if (err?.stack && !isProd) console.error(err.stack);

  // express.json/urlencoded attach `status`, rather than `statusCode`, to
  // malformed/oversized bodies. These are client errors, not server crashes.
  let statusCode: number = err.statusCode || err.status || 0;
  if (err.type === 'entity.parse.failed') statusCode = 400;
  if (err.type === 'entity.too.large') statusCode = 413;
  let message: string = err.message || 'Server error';
  if (err.type === 'entity.parse.failed') message = 'Request body must contain valid JSON.';
  if (err.type === 'entity.too.large') message = 'Request body is too large.';
  if (message === 'Not allowed by CORS') {
    statusCode = 403;
    message = 'Request origin is not allowed.';
  }
  if (statusCode && (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599)) statusCode = 500;

  // Map common auth/registration messages to canonical HTTP codes
  if (!statusCode) {
    if (
      message === 'Invalid credentials' ||
      message === 'Not authorized' ||
      message === 'No token provided'
    ) {
      statusCode = 401;
    } else if (message === 'User not found') {
      statusCode = 404;
    } else if (message.startsWith('Unable to register')) {
      statusCode = 409;
    } else {
      statusCode = 500;
    }
  }

  // In production, never echo raw 500 messages — they often contain DB
  // internals (constraint names, query fragments).
  if (statusCode >= 500 && isProd && !SAFE_OPERATIONAL_MESSAGES.has(message)) {
    message = 'Server error';
  } else if (statusCode >= 400 && statusCode < 500 && isProd) {
    // 4xx is generally safe, but redact anything that looks like a stack frame
    if (message.includes('\n') || message.length > 500) {
      message = SAFE_400_MESSAGES.has(message) ? message : 'Bad request';
    }
  }

  res.status(statusCode).json({
    success: false,
    message,
    error: { message, ...(['AUTH_SCHEMA_REQUIRED', 'AUTH_STATE_UNAVAILABLE', 'ACCOUNT_SUSPENDED', 'TEACHER_TIMING_SCHEMA_REQUIRED', 'LEGACY_TEACHER_ATTEMPT_REVIEW_REQUIRED'].includes(err.code) ? { code: err.code } : {}) },
    ...(isProd ? {} : { stack: err.stack }),
  });
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
