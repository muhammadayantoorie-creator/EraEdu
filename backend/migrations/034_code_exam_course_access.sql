-- Code exams are private to enrolled students and do not require publishing
-- the linked course in the public catalog. Replace the atomic start function
-- as well as the API preview policy; an API-only change would still fail Start.
-- Apply after 027. No courses, enrollments, schedules or submissions are changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.start_teacher_attempt(
  p_student_id uuid,
  p_quiz_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quiz public.teacher_quizzes;
  v_attempt public.quiz_attempts;
  v_now timestamptz;
BEGIN
  -- Serialize starts with finalization for this exact student/exam pair.
  -- The partial unique index alone is not sufficient when a final submit
  -- races a second-tab start.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_student_id::text),
    hashtext(p_quiz_id::text)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_student_id AND role = 'student' AND COALESCE(is_suspended, false) = false
  ) THEN
    RAISE EXCEPTION 'Student account is unavailable';
  END IF;

  SELECT * INTO v_quiz
  FROM public.teacher_quizzes
  WHERE id = p_quiz_id
  FOR UPDATE;
  IF NOT FOUND OR v_quiz.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Exam is unavailable';
  END IF;
  -- Take the timestamp only after any quiz-row lock wait. That timestamp is
  -- the authoritative attempt start and overall-deadline origin.
  v_now := clock_timestamp();
  IF v_quiz.scheduled_start IS NOT NULL AND v_quiz.scheduled_start > v_now THEN
    RAISE EXCEPTION 'Exam has not started';
  END IF;
  IF jsonb_typeof(v_quiz.questions) IS DISTINCT FROM 'array' OR jsonb_array_length(v_quiz.questions) = 0 THEN
    RAISE EXCEPTION 'Exam has no questions';
  END IF;
  -- Code exams require course membership, independently of catalog publication.
  -- Keep the course join: a dangling course reference must still fail closed.
  IF v_quiz.course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.courses course_row
    JOIN public.enrollments enrollment ON enrollment.course_id = course_row.id
    WHERE course_row.id = v_quiz.course_id
      AND enrollment.user_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'Course access is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.quiz_attempts
    WHERE user_id = p_student_id AND quiz_id = p_quiz_id
      AND topic_id IS NULL AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'You have already submitted this exam';
  END IF;

  INSERT INTO public.quiz_attempts (
    user_id, quiz_id, started_at, status, max_score,
    teacher_quiz_snapshot, teacher_question_state
  ) VALUES (
    p_student_id, p_quiz_id, v_now, 'in-progress',
    jsonb_array_length(v_quiz.questions), to_jsonb(v_quiz), '{}'::jsonb
  )
  ON CONFLICT (user_id, quiz_id)
    WHERE topic_id IS NULL AND status = 'in-progress'
  DO UPDATE SET id = public.quiz_attempts.id
  RETURNING * INTO v_attempt;

  RETURN to_jsonb(v_attempt) || jsonb_build_object('serverNow', v_now);
END;
$$;

-- Preserve the service-only boundary of migration 027.
REVOKE ALL ON FUNCTION public.start_teacher_attempt(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_teacher_attempt(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.start_teacher_attempt(uuid, uuid) IS
  'Start/resume a teacher-code exam for an enrolled student; course catalog publication is independent.';
NOTIFY pgrst, 'reload schema';
COMMIT;
