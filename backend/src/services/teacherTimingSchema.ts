export const TEACHER_TIMING_SCHEMA_MESSAGE = 'Teacher exam timing is unavailable. An administrator must apply backend/migrations/027_teacher_attempt_deadlines.sql.';
export const legacyTeacherAttemptError = () => Object.assign(
  new Error('This older exam attempt has no original timing snapshot and cannot be resumed. Please contact the exam administrator.'),
  { statusCode: 409, code: 'LEGACY_TEACHER_ATTEMPT_REVIEW_REQUIRED' },
);

// A function name appearing in a permission/connection error is not evidence
// that the function is missing. Match both the DB error class and its object.
export function teacherTimingSchemaError(error: any): Error | null {
  const description = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (description.includes('legacy teacher exam attempt requires administrator review')
    || description.includes('teacher exam timing migration is required for this attempt')) {
    return legacyTeacherAttemptError();
  }
  const missingFunction = ['42883', 'PGRST202'].includes(error?.code)
    && /\b(start_teacher_attempt|teacher_attempt_action|finish_teacher_attempt|report_teacher_violation)\b/.test(description);
  const missingColumn = ['42703', 'PGRST204'].includes(error?.code)
    && /\b(teacher_quiz_snapshot|teacher_question_state|teacher_answers_finalized_at)\b/.test(description);
  if (!missingFunction && !missingColumn && !description.includes('teacher exam timing migration')) return null;
  return Object.assign(new Error(TEACHER_TIMING_SCHEMA_MESSAGE), {
    statusCode: 503, code: 'TEACHER_TIMING_SCHEMA_REQUIRED',
  });
}
