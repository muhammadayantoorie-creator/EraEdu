-- Course created_by and teacher_quizzes.teacher_id are the CURRENT manager.
-- original_teacher_id records the assessment author; quiz/attempt IDs never change.
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.teacher_quizzes
  ADD COLUMN IF NOT EXISTS original_teacher_id text;
UPDATE public.teacher_quizzes SET original_teacher_id = teacher_id WHERE original_teacher_id IS NULL;

CREATE OR REPLACE FUNCTION public.keep_quiz_original_teacher()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.original_teacher_id IS NULL THEN NEW.original_teacher_id := NEW.teacher_id; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS keep_quiz_original_teacher_on_insert ON public.teacher_quizzes;
CREATE TRIGGER keep_quiz_original_teacher_on_insert
  BEFORE INSERT ON public.teacher_quizzes FOR EACH ROW
  EXECUTE FUNCTION public.keep_quiz_original_teacher();

-- Serialize course-linked exam writes with reassignment of that course.
CREATE OR REPLACE FUNCTION public.require_current_course_teacher_for_quiz()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_manager uuid;
BEGIN
  IF NEW.course_id IS NOT NULL THEN
    SELECT created_by INTO v_manager FROM public.courses WHERE id = NEW.course_id FOR SHARE;
    IF NOT FOUND OR v_manager::text IS DISTINCT FROM NEW.teacher_id THEN
      RAISE EXCEPTION 'Only the assigned course teacher can manage this exam';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS require_current_course_teacher_for_quiz_write ON public.teacher_quizzes;
CREATE TRIGGER require_current_course_teacher_for_quiz_write
  BEFORE INSERT OR UPDATE OF teacher_id, course_id ON public.teacher_quizzes
  FOR EACH ROW EXECUTE FUNCTION public.require_current_course_teacher_for_quiz();

CREATE OR REPLACE FUNCTION public.require_current_teacher_for_quiz_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_manager text;
BEGIN
  SELECT teacher_id INTO v_manager FROM public.teacher_quizzes WHERE id = NEW.quiz_id FOR SHARE;
  IF FOUND AND v_manager IS DISTINCT FROM NEW.created_by::text THEN
    RAISE EXCEPTION 'Only the current exam teacher can manage this code';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS require_current_teacher_for_quiz_code_write ON public.quiz_codes;
CREATE TRIGGER require_current_teacher_for_quiz_code_write
  BEFORE INSERT OR UPDATE OF created_by, quiz_id ON public.quiz_codes
  FOR EACH ROW EXECUTE FUNCTION public.require_current_teacher_for_quiz_code();

CREATE TABLE IF NOT EXISTS public.course_assignment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.users(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  previous_teacher_id uuid REFERENCES public.users(id),
  new_teacher_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS course_assignment_audit_course_time_idx
  ON public.course_assignment_audit(course_id, created_at DESC);
ALTER TABLE public.course_assignment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.course_assignment_audit FROM anon, authenticated;
GRANT ALL ON TABLE public.course_assignment_audit TO service_role;

CREATE OR REPLACE FUNCTION public.admin_create_assigned_course(
  p_actor_id uuid, p_teacher_id uuid, p_organization_id uuid,
  p_title text, p_description text, p_category text, p_difficulty text,
  p_course_code text, p_max_students integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin' AND is_suspended = false) THEN
    RAISE EXCEPTION 'Only active platform admins can assign courses';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_teacher_id AND role = 'teacher' AND is_suspended = false) THEN
    RAISE EXCEPTION 'An active registered teacher is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members
      WHERE organization_id = p_organization_id AND user_id = p_teacher_id) THEN
    RAISE EXCEPTION 'Teacher must belong to the selected institution';
  END IF;
  INSERT INTO public.courses
    (title, description, category, difficulty, course_code, max_students, created_by, organization_id)
  VALUES
    (p_title, p_description, p_category, p_difficulty, p_course_code, p_max_students, p_teacher_id, p_organization_id)
  RETURNING id INTO v_course_id;
  INSERT INTO public.course_assignment_audit
    (course_id, actor_id, organization_id, previous_teacher_id, new_teacher_id)
  VALUES (v_course_id, p_actor_id, p_organization_id, NULL, p_teacher_id);
  RETURN (SELECT to_jsonb(course) FROM public.courses AS course WHERE course.id = v_course_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reassign_course(
  p_actor_id uuid, p_course_id uuid, p_teacher_id uuid, p_organization_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course public.courses%ROWTYPE; v_old_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin' AND is_suspended = false) THEN
    RAISE EXCEPTION 'Only active platform admins can assign courses';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_teacher_id AND role = 'teacher' AND is_suspended = false) THEN
    RAISE EXCEPTION 'An active registered teacher is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members
      WHERE organization_id = p_organization_id AND user_id = p_teacher_id) THEN
    RAISE EXCEPTION 'Teacher must belong to the selected institution';
  END IF;
  SELECT * INTO v_course FROM public.courses WHERE id = p_course_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course not found'; END IF;
  IF v_course.organization_id IS NOT NULL AND v_course.organization_id <> p_organization_id THEN
    RAISE EXCEPTION 'Course cannot be moved to another institution';
  END IF;
  IF v_course.organization_id IS NULL AND v_course.created_by IS NOT NULL THEN
    SELECT role INTO v_old_role FROM public.users WHERE id = v_course.created_by;
    IF v_old_role = 'teacher' AND NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = p_organization_id AND user_id = v_course.created_by
    ) THEN
      RAISE EXCEPTION 'Current teacher is not in the selected institution';
    END IF;
  END IF;
  IF v_course.created_by = p_teacher_id AND v_course.organization_id = p_organization_id THEN
    RETURN false;
  END IF;
  UPDATE public.courses SET created_by = p_teacher_id, organization_id = p_organization_id
    WHERE id = p_course_id;
  UPDATE public.teacher_quizzes SET teacher_id = p_teacher_id::text
    WHERE course_id = p_course_id;
  UPDATE public.quiz_codes SET created_by = p_teacher_id
    WHERE course_id = p_course_id AND created_by = v_course.created_by;
  INSERT INTO public.course_assignment_audit
    (course_id, actor_id, organization_id, previous_teacher_id, new_teacher_id)
  VALUES (p_course_id, p_actor_id, p_organization_id, v_course.created_by, p_teacher_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_assigned_course(uuid, uuid, uuid, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_reassign_course(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_assigned_course(uuid, uuid, uuid, text, text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reassign_course(uuid, uuid, uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
