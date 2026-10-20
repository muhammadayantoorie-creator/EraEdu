-- Read-only review of active teacher rows before migration 027. Legacy orphans
-- with no exam definition or original snapshot are preserved, not blockers.
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
  CASE WHEN q.id IS NOT NULL THEN 'TEACHER EXAM EXISTS'
    WHEN topic_quiz.id IS NOT NULL THEN 'TOPIC EXAM REFERENCE: review attempt model'
    ELSE 'MISSING EXAM' END AS exam_reference,
  a.started_at AS started_at,
  a.status,
  CASE WHEN jsonb_typeof(to_jsonb(a) -> 'answers') = 'array'
    THEN jsonb_array_length(to_jsonb(a) -> 'answers')
    ELSE NULL END AS saved_answer_count,
  CASE
    WHEN q.id IS NULL AND topic_quiz.id IS NULL
      AND COALESCE(to_jsonb(a) -> 'teacher_quiz_snapshot', 'null'::jsonb) = 'null'::jsonb
      AND COALESCE(to_jsonb(a) -> 'topic_question_snapshot', 'null'::jsonb) = 'null'::jsonb
      THEN 'PRESERVE LEGACY ORPHAN: no exam or original snapshot; no new timer'
    WHEN jsonb_typeof(to_jsonb(a) -> 'teacher_quiz_snapshot') = 'object'
      AND jsonb_typeof(to_jsonb(a) -> 'teacher_quiz_snapshot' -> 'questions') = 'array'
      THEN 'SNAPSHOT PRESENT: preserve original state and deadlines'
    ELSE 'LEGACY OR INVALID SNAPSHOT: administrator review required'
  END AS timing_review,
  count(*) OVER () AS total_blocking_attempts
FROM public.quiz_attempts a
LEFT JOIN public.teacher_quizzes q ON q.id = a.quiz_id
LEFT JOIN public.quizzes topic_quiz ON topic_quiz.id = a.quiz_id
WHERE a.topic_id IS NULL AND a.status = 'in-progress'
ORDER BY a.started_at NULLS FIRST, a.id
LIMIT 100;
COMMIT;
