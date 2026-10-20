-- Read-only diagnosis of the exact rows blocking migration 027.
-- Works BEFORE timing columns exist. Returns attempt/exam metadata only;
-- never returns student identities, questions, answer contents or answer keys.
-- Age alone does not establish that an attempt is abandoned. Review privately
-- with the exam administrator before changing any assessment record.
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT
  a.id AS attempt_id,
  a.quiz_id AS exam_id,
  q.title AS exam_title,
  a.started_at AS started_at,
  a.status,
  CASE WHEN jsonb_typeof(to_jsonb(a) -> 'answers') = 'array'
    THEN jsonb_array_length(to_jsonb(a) -> 'answers')
    ELSE NULL END AS saved_answer_count,
  CASE
    WHEN jsonb_typeof(to_jsonb(a) -> 'teacher_quiz_snapshot') = 'object'
      AND jsonb_typeof(to_jsonb(a) -> 'teacher_quiz_snapshot' -> 'questions') = 'array'
      THEN 'SNAPSHOT PRESENT: preserve original state and deadlines'
    ELSE 'LEGACY OR INVALID SNAPSHOT: administrator review required'
  END AS timing_review,
  count(*) OVER () AS total_blocking_attempts
FROM public.quiz_attempts a
LEFT JOIN public.teacher_quizzes q ON q.id = a.quiz_id
WHERE a.topic_id IS NULL AND a.status = 'in-progress'
ORDER BY a.started_at NULLS FIRST, a.id
LIMIT 100;
COMMIT;
