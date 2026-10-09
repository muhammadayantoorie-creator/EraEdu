-- Apply after 006_add_course_capacity.sql. Existing NULL caps remain unlimited.
-- Inspect legacy invalid rows before validating the new constraint:
-- SELECT id, max_students FROM courses WHERE max_students IS NOT NULL AND max_students <= 0;
-- Check for duplicate enrollments before applying the unique index; resolve
-- any legacy duplicates deliberately rather than discarding rows in a migration.
-- SELECT user_id, course_id, count(*) FROM enrollments
-- GROUP BY user_id, course_id HAVING count(*) > 1;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS max_students integer;

CREATE UNIQUE INDEX IF NOT EXISTS enrollments_one_seat_per_student_course
  ON enrollments (user_id, course_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_max_students_positive'
      AND conrelid = 'courses'::regclass
  ) THEN
    ALTER TABLE courses ADD CONSTRAINT courses_max_students_positive
      CHECK (max_students IS NULL OR max_students > 0) NOT VALID;
  END IF;
END $$;

-- Locking the course row serializes enrollments (and capacity updates) for
-- this course. A duplicate check happens under that lock, before counting.
CREATE OR REPLACE FUNCTION public.enroll_course_with_capacity(p_course_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_enrolled bigint;
  v_inserted integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A student ID is required for enrollment.';
  END IF;
  SELECT max_students INTO v_limit
    FROM public.courses WHERE id = p_course_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = p_course_id AND user_id = p_user_id) THEN
    RETURN false;
  END IF;

  IF v_limit IS NOT NULL THEN
    IF v_limit < 1 THEN
      RAISE EXCEPTION 'Invalid course capacity. Correct max_students before enrollment.';
    END IF;
    SELECT count(*) INTO v_enrolled FROM public.enrollments WHERE course_id = p_course_id;
    IF v_enrolled >= v_limit THEN
      RAISE EXCEPTION 'This course is full. Please contact your teacher.';
    END IF;
  END IF;

  INSERT INTO public.enrollments (user_id, course_id, enrolled_at)
    VALUES (p_user_id, p_course_id, now())
    ON CONFLICT (user_id, course_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_course_with_capacity(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_course_with_capacity(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
