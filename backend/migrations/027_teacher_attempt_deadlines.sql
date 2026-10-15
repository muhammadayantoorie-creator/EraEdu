-- BUG-039: teacher-code exams retain a server-owned, immutable snapshot and
-- per-question activation deadline. Apply during an exam-free maintenance
-- window. Existing in-progress teacher exams cannot safely receive a newly
-- invented deadline, so finish or review those attempts before applying.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.quiz_attempts
    WHERE topic_id IS NULL AND status = 'in-progress'
  ) THEN
    RAISE EXCEPTION
      'Migration 027 cannot infer deadlines for active teacher exams. Finish or review them before applying it.';
  END IF;
END $$;

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS teacher_quiz_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS teacher_question_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS teacher_answers_finalized_at timestamptz;

-- Browser roles never read snapshots or saved canonical answers directly.
-- Migration 022 already protects quiz_attempts; do not broaden permissions on
-- teacher_quizzes here because that table has unrelated, existing policies.
REVOKE ALL ON public.quiz_attempts FROM anon, authenticated;

-- A retry or second browser tab resumes the same active teacher exam. This
-- index is deliberately scoped away from topic exams, which have their own
-- attempt lifecycle in migration 022. The functions below also use a
-- transaction advisory lock for the (student, exam) pair. That lock prevents
-- a start racing a final submission from creating a new active attempt after
-- the partial-index conflict disappears.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_attempts_one_active_teacher_exam
  ON public.quiz_attempts (user_id, quiz_id)
  WHERE topic_id IS NULL AND status = 'in-progress';

-- Finalize exactly once. This function reconstructs a complete answer list
-- from canonical answers accepted before each question deadline; unanswered
-- questions are represented explicitly and never earn a point.
CREATE OR REPLACE FUNCTION public.finish_teacher_attempt(
  p_attempt_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.quiz_attempts;
  v_attempt_user_id uuid;
  v_attempt_quiz_id uuid;
  v_answers jsonb;
  v_score integer;
  v_now timestamptz;
BEGIN
  IF p_reason NOT IN ('student', 'time_expired', 'excessive_violations') THEN
    RAISE EXCEPTION 'Invalid exam completion reason';
  END IF;

  -- Obtain the pair lock before the row lock. All start/action/report paths
  -- use the same order, so a concurrent start cannot wait on this row while
  -- a finalizer waits on the advisory lock.
  SELECT user_id, quiz_id
  INTO v_attempt_user_id, v_attempt_quiz_id
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND topic_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext(v_attempt_user_id::text),
    hashtext(v_attempt_quiz_id::text)
  );

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND topic_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found';
  END IF;
  -- `clock_timestamp` must be read after a waiting row lock. `now()` and a
  -- declaration-time timestamp would otherwise give lock waiters extra time.
  v_now := clock_timestamp();
  IF v_attempt.teacher_quiz_snapshot IS NULL THEN
    RAISE EXCEPTION 'Teacher exam timing migration is required for this attempt';
  END IF;
  IF jsonb_typeof(v_attempt.teacher_quiz_snapshot -> 'questions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Teacher exam snapshot is invalid';
  END IF;
  IF v_attempt.status <> 'in-progress' THEN
    RETURN to_jsonb(v_attempt) || jsonb_build_object('serverNow', v_now, 'newlyCompleted', false);
  END IF;

  SELECT
    COALESCE(jsonb_agg(answer ORDER BY question_index), '[]'::jsonb),
    COUNT(*) FILTER (WHERE COALESCE(answer ->> 'isCorrect', 'false') = 'true')::integer
  INTO v_answers, v_score
  FROM (
    SELECT
      ordinality - 1 AS question_index,
      COALESCE(
        v_attempt.teacher_question_state
          -> (v_attempt.quiz_id::text || '-q' || (ordinality - 1)::text)
          -> 'answer',
        jsonb_build_object(
          'questionId', v_attempt.quiz_id::text || '-q' || (ordinality - 1)::text,
          'selectedAnswer', NULL,
          'isCorrect', false,
          'questionType', CASE
            WHEN item ->> 'questionType' = 'shortAnswer'
              OR CASE
                WHEN jsonb_typeof(item -> 'options') = 'array'
                  THEN jsonb_array_length(item -> 'options')
                ELSE 0
              END = 0
            THEN 'shortAnswer'
            ELSE 'multipleChoice'
          END,
          'answerVersion', 2
        )
      ) AS answer
    FROM jsonb_array_elements(v_attempt.teacher_quiz_snapshot -> 'questions')
      WITH ORDINALITY AS question(item, ordinality)
  ) AS materialized_answers;

  UPDATE public.quiz_attempts
  SET status = 'completed',
      completed_at = v_now,
      answers = v_answers,
      score = COALESCE(v_score, 0),
      max_score = jsonb_array_length(v_attempt.teacher_quiz_snapshot -> 'questions'),
      auto_submitted = p_reason <> 'student',
      submission_reason = p_reason,
      teacher_answers_finalized_at = v_now
  WHERE id = v_attempt.id AND status = 'in-progress'
  RETURNING * INTO v_attempt;

  RETURN to_jsonb(v_attempt) || jsonb_build_object('serverNow', v_now, 'newlyCompleted', true);
END;
$$;

-- Start/resume a teacher-code exam. The partial unique index makes concurrent
-- starts converge on one attempt and its immutable quiz snapshot.
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
  -- Serialize starts with finalization for this exact student/exam pair. See
  -- the index note above for why the partial unique index is not sufficient
  -- by itself when a final submit races a second-tab start.
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
  IF v_quiz.course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.courses course_row
    JOIN public.enrollments enrollment ON enrollment.course_id = course_row.id
    WHERE course_row.id = v_quiz.course_id
      AND course_row.is_published = true
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

-- Read, activate, save, or finalize an attempt. The Express API is the only
-- caller and supplies the authenticated student id. It never returns the
-- snapshot directly to a browser.
CREATE OR REPLACE FUNCTION public.teacher_attempt_action(
  p_student_id uuid,
  p_attempt_id uuid,
  p_action text,
  p_question_id text DEFAULT NULL,
  p_answers jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.quiz_attempts;
  v_attempt_user_id uuid;
  v_attempt_quiz_id uuid;
  v_now timestamptz;
  v_overall_deadline timestamptz;
  v_raw_minutes text;
  v_state jsonb;
  v_answer jsonb;
  v_question jsonb;
  v_question_id text;
  v_question_index_text text;
  v_question_index integer;
  v_question_seconds integer;
  v_deadline timestamptz;
  v_selected integer;
  v_is_short boolean;
  v_expected text;
  v_canonical jsonb;
BEGIN
  IF p_action NOT IN ('read', 'activate', 'answer', 'submit') THEN
    RAISE EXCEPTION 'Invalid teacher exam action';
  END IF;

  -- Pair-lock before the row lock to serialize this action with starts,
  -- finalization, and violation threshold submission for the same attempt.
  SELECT user_id, quiz_id
  INTO v_attempt_user_id, v_attempt_quiz_id
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = p_student_id AND topic_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext(v_attempt_user_id::text),
    hashtext(v_attempt_quiz_id::text)
  );

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = p_student_id AND topic_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found';
  END IF;
  -- This must happen after the lock: a request queued behind another tab
  -- must not calculate expiry from the time it started waiting.
  v_now := clock_timestamp();
  IF v_attempt.teacher_quiz_snapshot IS NULL THEN
    RAISE EXCEPTION 'Teacher exam timing migration is required for this attempt';
  END IF;
  IF jsonb_typeof(v_attempt.teacher_quiz_snapshot -> 'questions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Teacher exam snapshot is invalid';
  END IF;
  IF v_attempt.status <> 'in-progress' THEN
    IF p_action = 'answer' THEN
      RAISE EXCEPTION 'Exam already submitted';
    END IF;
    RETURN to_jsonb(v_attempt) || jsonb_build_object('serverNow', v_now, 'expired', false, 'newlyCompleted', false);
  END IF;

  v_raw_minutes := v_attempt.teacher_quiz_snapshot ->> 'time_limit';
  IF v_raw_minutes ~ '^[0-9]{1,5}$' AND v_raw_minutes::integer BETWEEN 1 AND 10080 THEN
    v_overall_deadline := v_attempt.started_at + make_interval(mins => v_raw_minutes::integer);
  END IF;

  -- At the overall deadline the server finalizes existing saved answers. An
  -- answer action returns the completed state rather than accepting a change.
  IF v_overall_deadline IS NOT NULL AND v_now >= v_overall_deadline THEN
    RETURN public.finish_teacher_attempt(v_attempt.id, 'time_expired')
      || jsonb_build_object('expired', true);
  END IF;

  v_state := CASE
    WHEN jsonb_typeof(v_attempt.teacher_question_state) = 'object'
      THEN v_attempt.teacher_question_state
    ELSE '{}'::jsonb
  END;

  IF p_action = 'activate' THEN
    v_question_index_text := substring(COALESCE(p_question_id, '') FROM '-q([0-9]{1,6})$');
    IF v_question_index_text IS NULL THEN
      RAISE EXCEPTION 'Question does not belong to this attempt';
    END IF;
    v_question_index := v_question_index_text::integer;
    IF p_question_id <> (v_attempt.quiz_id::text || '-q' || v_question_index::text)
       OR v_question_index < 0
       OR v_question_index >= jsonb_array_length(v_attempt.teacher_quiz_snapshot -> 'questions') THEN
      RAISE EXCEPTION 'Question does not belong to this attempt';
    END IF;
    IF NOT (v_state ? p_question_id) THEN
      v_question := v_attempt.teacher_quiz_snapshot -> 'questions' -> v_question_index;
      v_question_seconds := CASE
        WHEN (v_question ->> 'timeLimit') ~ '^[0-9]{1,5}$'
          AND (v_question ->> 'timeLimit')::integer BETWEEN 1 AND 86400
        THEN (v_question ->> 'timeLimit')::integer
        ELSE 60
      END;
      v_deadline := LEAST(
        v_now + make_interval(secs => v_question_seconds),
        COALESCE(v_overall_deadline, 'infinity'::timestamptz)
      );
      v_state := v_state || jsonb_build_object(
        p_question_id,
        jsonb_build_object('activatedAt', v_now, 'deadlineAt', v_deadline)
      );
      UPDATE public.quiz_attempts
      SET teacher_question_state = v_state
      WHERE id = v_attempt.id
      RETURNING * INTO v_attempt;
    END IF;
  ELSIF p_action = 'answer' THEN
    IF jsonb_typeof(p_answers) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Answers must be an array';
    END IF;
    IF jsonb_array_length(p_answers) > jsonb_array_length(v_attempt.teacher_quiz_snapshot -> 'questions') THEN
      RAISE EXCEPTION 'Too many answers for this exam';
    END IF;
    IF (SELECT COUNT(*) <> COUNT(DISTINCT value ->> 'questionId')
        FROM jsonb_array_elements(p_answers)) THEN
      RAISE EXCEPTION 'Each question can only be answered once';
    END IF;

    FOR v_answer IN SELECT value FROM jsonb_array_elements(p_answers) LOOP
      IF jsonb_typeof(v_answer) <> 'object' THEN
        RAISE EXCEPTION 'Each answer must be an object';
      END IF;
      v_question_id := v_answer ->> 'questionId';
      v_question_index_text := substring(COALESCE(v_question_id, '') FROM '-q([0-9]{1,6})$');
      IF v_question_index_text IS NULL THEN
        RAISE EXCEPTION 'Question does not belong to this attempt';
      END IF;
      v_question_index := v_question_index_text::integer;
      IF v_question_id <> (v_attempt.quiz_id::text || '-q' || v_question_index::text)
         OR v_question_index < 0
         OR v_question_index >= jsonb_array_length(v_attempt.teacher_quiz_snapshot -> 'questions') THEN
        RAISE EXCEPTION 'Question does not belong to this attempt';
      END IF;
      IF NOT (v_state ? v_question_id) THEN
        RAISE EXCEPTION 'Question has not been activated';
      END IF;
      IF (v_state -> v_question_id -> 'answer') = v_answer THEN
        CONTINUE; -- a timed-out retry is safe only when it is identical
      END IF;
      IF (v_state -> v_question_id ->> 'deadlineAt')::timestamptz <= v_now THEN
        RAISE EXCEPTION 'Question deadline has passed';
      END IF;

      v_question := v_attempt.teacher_quiz_snapshot -> 'questions' -> v_question_index;
      v_is_short := v_question ->> 'questionType' = 'shortAnswer'
        OR CASE
          WHEN jsonb_typeof(v_question -> 'options') = 'array'
            THEN jsonb_array_length(v_question -> 'options')
          ELSE 0
        END = 0;
      IF v_is_short THEN
        IF jsonb_typeof(v_answer -> 'selectedAnswer') <> 'string' THEN
          RAISE EXCEPTION 'Short-answer responses must be text';
        END IF;
        v_expected := lower(btrim(COALESCE(v_question ->> 'answerText', '')));
        v_canonical := jsonb_build_object(
          'questionId', v_question_id,
          'selectedAnswer', v_answer ->> 'selectedAnswer',
          'isCorrect', length(btrim(v_answer ->> 'selectedAnswer')) > 0
            AND v_expected <> ''
            AND lower(btrim(v_answer ->> 'selectedAnswer')) = v_expected,
          'questionType', 'shortAnswer',
          'answerVersion', 2
        );
      ELSE
        IF jsonb_typeof(v_answer -> 'selectedAnswer') = 'null' THEN
          v_canonical := jsonb_build_object(
            'questionId', v_question_id,
            'selectedAnswer', NULL,
            'isCorrect', false,
            'questionType', 'multipleChoice',
            'answerVersion', 2
          );
        ELSIF jsonb_typeof(v_answer -> 'selectedAnswer') = 'number'
          AND (v_answer ->> 'selectedAnswer') ~ '^[0-9]{1,6}$' THEN
          v_selected := (v_answer ->> 'selectedAnswer')::integer;
          IF jsonb_typeof(v_question -> 'options') <> 'array'
             OR COALESCE(v_question ->> 'correctAnswer', '') !~ '^[0-9]{1,6}$'
             OR v_selected < 0
             OR v_selected >= jsonb_array_length(v_question -> 'options')
             OR (v_question ->> 'correctAnswer')::integer >= jsonb_array_length(v_question -> 'options') THEN
            RAISE EXCEPTION 'Selected option is out of range';
          END IF;
          v_canonical := jsonb_build_object(
            'questionId', v_question_id,
            'selectedAnswer', v_selected,
            'isCorrect', v_selected = (v_question ->> 'correctAnswer')::integer,
            'questionType', 'multipleChoice',
            'answerVersion', 2
          );
        ELSE
          RAISE EXCEPTION 'Selected option is out of range';
        END IF;
      END IF;
      v_state := jsonb_set(v_state, ARRAY[v_question_id, 'answer'], v_canonical, true);
    END LOOP;

    UPDATE public.quiz_attempts
    SET teacher_question_state = v_state
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;
  ELSIF p_action = 'submit' THEN
    RETURN public.finish_teacher_attempt(v_attempt.id, 'student');
  END IF;

  RETURN to_jsonb(v_attempt) || jsonb_build_object('serverNow', v_now, 'expired', false);
END;
$$;

-- Violation reporting shares the attempt lock with final submission. This
-- makes browser retries idempotent and means an automatic threshold finish
-- uses the already persisted, canonical answer state rather than a shorter
-- browser-memory array.
CREATE OR REPLACE FUNCTION public.report_teacher_violation(
  p_student_id uuid,
  p_attempt_id uuid,
  p_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.quiz_attempts;
  v_quiz public.teacher_quizzes;
  v_attempt_quiz_id uuid;
  v_violation_id uuid;
  v_count integer;
  v_limit integer;
  v_finish jsonb;
  v_now timestamptz;
  v_already_submitted boolean;
BEGIN
  IF jsonb_typeof(p_event) IS DISTINCT FROM 'object'
     OR COALESCE(p_event ->> 'violationType', '') = ''
     OR length(p_event ->> 'violationType') > 50
     OR COALESCE(p_event ->> 'eventId', '') = ''
     OR length(p_event ->> 'eventId') > 200
     OR length(COALESCE(p_event ->> 'detectionMethod', '')) > 100 THEN
    RAISE EXCEPTION 'Invalid integrity event';
  END IF;

  -- Always acquire the pair lock BEFORE the row lock, matching start/action/
  -- finish. The opposite order deadlocks a threshold report against submit.
  SELECT quiz_id INTO v_attempt_quiz_id
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = p_student_id AND topic_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_student_id::text), hashtext(v_attempt_quiz_id::text));

  SELECT * INTO v_attempt
  FROM public.quiz_attempts
  WHERE id = p_attempt_id AND user_id = p_student_id AND topic_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found';
  END IF;
  IF v_attempt.teacher_quiz_snapshot IS NULL THEN
    RAISE EXCEPTION 'Teacher exam timing migration is required for this attempt';
  END IF;
  IF v_attempt.status NOT IN ('in-progress', 'completed') THEN
    RAISE EXCEPTION 'Exam is no longer active';
  END IF;
  v_now := clock_timestamp();
  v_already_submitted := v_attempt.status = 'completed';

  -- A delayed/retried signal can arrive after submission. Preserve it as
  -- reported evidence (timestamp is receipt time, not proof of misconduct),
  -- but never reopen or regrade a completed attempt. Ownership remains
  -- required. The original exam's threshold is immutable.
  SELECT * INTO v_quiz FROM public.teacher_quizzes WHERE id = v_attempt.quiz_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam is unavailable';
  END IF;
  v_limit := LEAST(100, GREATEST(1, COALESCE((v_attempt.teacher_quiz_snapshot ->> 'violation_limit')::integer, 3)));

  INSERT INTO public.cheating_violations (
    quiz_attempt_id, student_id, quiz_id, teacher_id,
    violation_type, detection_method, severity, details, timestamp, event_id
  ) VALUES (
    v_attempt.id,
    p_student_id,
    v_attempt.quiz_id,
    CASE
      WHEN v_quiz.teacher_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN v_quiz.teacher_id::uuid
      ELSE NULL
    END,
    p_event ->> 'violationType',
    COALESCE(NULLIF(p_event ->> 'detectionMethod', ''), 'browser_event'),
    CASE WHEN p_event ->> 'severity' IN ('low', 'medium', 'high') THEN p_event ->> 'severity' ELSE 'low' END,
    CASE WHEN jsonb_typeof(p_event -> 'details') = 'object' THEN p_event -> 'details' ELSE '{}'::jsonb END,
    v_now,
    NULLIF(p_event ->> 'eventId', '')
  )
  ON CONFLICT (quiz_attempt_id, event_id) WHERE event_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_violation_id;

  IF v_violation_id IS NULL AND NULLIF(p_event ->> 'eventId', '') IS NOT NULL THEN
    SELECT id INTO v_violation_id
    FROM public.cheating_violations
    WHERE quiz_attempt_id = v_attempt.id AND event_id = p_event ->> 'eventId';
  END IF;

  SELECT COUNT(*)::integer INTO v_count
  FROM public.cheating_violations
  WHERE quiz_attempt_id = v_attempt.id;
  UPDATE public.quiz_attempts
  SET violation_count = v_count
  WHERE id = v_attempt.id;

  IF v_count >= v_limit AND NOT v_already_submitted THEN
    v_finish := public.finish_teacher_attempt(v_attempt.id, 'excessive_violations');
    RETURN jsonb_build_object(
      'violationId', v_violation_id,
      'violationCount', v_count,
      'violationLimit', v_limit,
      'autoSubmitted', COALESCE((v_finish ->> 'newlyCompleted')::boolean, false),
      'alreadySubmitted', false,
      'remainingViolations', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'violationId', v_violation_id,
    'violationCount', v_count,
    'violationLimit', v_limit,
    'autoSubmitted', false,
    'alreadySubmitted', v_already_submitted,
    'remainingViolations', GREATEST(0, v_limit - v_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finish_teacher_attempt(uuid, text),
  public.start_teacher_attempt(uuid, uuid),
  public.teacher_attempt_action(uuid, uuid, text, text, jsonb),
  public.report_teacher_violation(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_teacher_attempt(uuid, uuid),
  public.teacher_attempt_action(uuid, uuid, text, text, jsonb),
  public.report_teacher_violation(uuid, uuid, jsonb)
  TO service_role;

COMMIT;

-- Rollback: stop new starts and roll back the API/UI together. Retain the
-- immutable snapshots and deadlines: dropping them would let an old client
-- silently extend an attempt and would destroy review evidence.
