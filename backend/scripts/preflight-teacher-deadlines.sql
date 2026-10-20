-- Run in the same Supabase project used by the backend, before migration 027.
-- Read-only: returns a count, never account IDs, questions or submitted answers.
-- PASS permits the migration's exam-free window; it is not a schema verifier.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT 'Migration 027 exam-free window' AS check_name,
  count(*) AS active_teacher_attempts,
  CASE WHEN count(*) = 0 THEN 'PASS'
    ELSE 'STOP: active teacher attempts require administrator review; do not delete work or reset timers'
  END AS status
FROM public.quiz_attempts
WHERE topic_id IS NULL AND status = 'in-progress';
COMMIT;
