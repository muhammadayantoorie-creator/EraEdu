-- Apply after 024. Adds protections for BOTH quiz_attempts models without
-- deleting or changing existing attempts. NOT VALID keeps legacy orphan rows
-- available for reviewed repair; new writes and deletes are still checked.
-- Run scripts/report_assessment_references.sql before and after applying.
BEGIN;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS teacher_quiz_ref uuid GENERATED ALWAYS AS
    (CASE WHEN topic_id IS NULL THEN quiz_id ELSE NULL END) STORED;
ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS topic_quiz_ref uuid GENERATED ALWAYS AS
    (CASE WHEN topic_id IS NOT NULL THEN quiz_id ELSE NULL END) STORED;

ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_quiz_id_fkey;
ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_quiz_id_required;
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_quiz_id_required
  CHECK (quiz_id IS NOT NULL) NOT VALID;
ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_teacher_quiz_ref_fkey;
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_teacher_quiz_ref_fkey
  FOREIGN KEY (teacher_quiz_ref) REFERENCES public.teacher_quizzes(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_topic_quiz_ref_fkey;
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_topic_quiz_ref_fkey
  FOREIGN KEY (topic_quiz_ref) REFERENCES public.quizzes(id) ON DELETE RESTRICT NOT VALID;

-- The old CASCADE on topic_id could erase even an already-orphaned topic exam.
ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_topic_id_fkey;
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_topic_id_fkey
  FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE RESTRICT NOT VALID;

-- Do not silently detach teacher exams from a deleted course. Owners can
-- unpublish the course; retaining the course row keeps historical attribution.
ALTER TABLE public.teacher_quizzes DROP CONSTRAINT IF EXISTS teacher_quizzes_course_id_fkey;
ALTER TABLE public.teacher_quizzes ADD CONSTRAINT teacher_quizzes_course_id_fkey
  FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE RESTRICT NOT VALID;

CREATE OR REPLACE FUNCTION public.assessment_history_protection_ready()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COUNT(*) = 5 FROM pg_constraint
  WHERE (contype = 'c' AND conrelid = 'public.quiz_attempts'::regclass AND conname = 'quiz_attempts_quiz_id_required')
    OR (contype = 'f' AND (
    (conrelid = 'public.quiz_attempts'::regclass AND conname IN (
      'quiz_attempts_teacher_quiz_ref_fkey', 'quiz_attempts_topic_quiz_ref_fkey',
      'quiz_attempts_topic_id_fkey'))
    OR (conrelid = 'public.teacher_quizzes'::regclass AND conname = 'teacher_quizzes_course_id_fkey')
  ));
$$;
REVOKE ALL ON FUNCTION public.assessment_history_protection_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assessment_history_protection_ready() TO service_role;
COMMIT;

-- Rollback requires a reviewed replacement retention policy. Dropping these
-- constraints would re-enable destructive cascades; do not do so automatically.
