-- Run in the same Supabase project used by the backend, before migration 027.
-- Read-only: returns counts, never account IDs, questions or submitted answers.
-- PASS permits the migration's exam-free window; it is not a schema verifier.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
WITH active AS (
  SELECT a.user_id, a.quiz_id,
    q.id IS NULL AND topic_quiz.id IS NULL
      AND COALESCE(to_jsonb(a) -> 'teacher_quiz_snapshot', 'null'::jsonb) = 'null'::jsonb
      AND COALESCE(to_jsonb(a) -> 'topic_question_snapshot', 'null'::jsonb) = 'null'::jsonb
      AS preserved_legacy_orphan
  FROM public.quiz_attempts a
  LEFT JOIN public.teacher_quizzes q ON q.id = a.quiz_id
  LEFT JOIN public.quizzes topic_quiz ON topic_quiz.id = a.quiz_id
  WHERE a.topic_id IS NULL AND a.status = 'in-progress'
), duplicate_pairs AS (
  SELECT user_id, quiz_id FROM active GROUP BY user_id, quiz_id HAVING count(*) > 1
)
SELECT 'Migration 027 exam-free window' AS check_name,
  count(*) AS active_teacher_attempts,
  count(*) FILTER (WHERE NOT preserved_legacy_orphan) AS blocking_active_teacher_attempts,
  count(*) FILTER (WHERE preserved_legacy_orphan) AS preserved_legacy_orphan_attempts,
  (SELECT count(*) FROM duplicate_pairs) AS duplicate_active_pairs,
  CASE WHEN count(*) FILTER (WHERE NOT preserved_legacy_orphan) = 0
      AND NOT EXISTS (SELECT 1 FROM duplicate_pairs) THEN 'PASS'
    ELSE 'STOP: resumable or duplicate attempts require administrator review; do not delete work or reset timers'
  END AS status
FROM active;
COMMIT;
