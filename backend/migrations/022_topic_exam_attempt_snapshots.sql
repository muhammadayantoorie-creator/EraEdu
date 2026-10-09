-- Topic exams use a published quizzes row and retain the exact questions
-- shown at start. Bank edits must not change an in-progress attempt or score.
-- A topic can start only when its course is published, the student is
-- enrolled, and a quizzes row for that topic has is_published = true.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.quiz_attempts
    WHERE topic_id IS NOT NULL AND quiz_id IS NOT NULL AND status = 'in-progress'
    GROUP BY user_id, quiz_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active topic attempts exist; review student work before applying migration 022';
  END IF;
END $$;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS topic_question_snapshot jsonb;

-- The snapshot contains answer keys. Student clients use the Express API,
-- which returns only the active question without its key. Do not allow direct
-- browser-role SELECT on this table (including an own-row RLS policy).
REVOKE ALL ON public.quiz_attempts FROM anon, authenticated;

-- Repeated starts reuse the active attempt. Inspect and resolve any legacy
-- duplicate in-progress topic attempts before applying this index; do not
-- delete student work automatically.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_attempts_one_active_topic_exam
  ON public.quiz_attempts (user_id, quiz_id)
  WHERE topic_id IS NOT NULL AND status = 'in-progress';
