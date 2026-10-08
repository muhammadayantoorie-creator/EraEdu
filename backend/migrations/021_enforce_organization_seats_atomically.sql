-- Seat rule: every organization_members row (owner, admin, teacher) consumes one seat.
CREATE OR REPLACE FUNCTION add_organization_teacher_atomic(p_organization_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_used integer;
BEGIN
  SELECT seat_limit INTO v_limit FROM organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found'; END IF;
  IF EXISTS (SELECT 1 FROM organization_members WHERE organization_id = p_organization_id AND user_id = p_user_id) THEN
    RETURN true;
  END IF;
  SELECT count(*) INTO v_used FROM organization_members WHERE organization_id = p_organization_id;
  IF v_used >= v_limit THEN RAISE EXCEPTION 'Organization seat limit reached'; END IF;
  INSERT INTO organization_members (organization_id, user_id, role) VALUES (p_organization_id, p_user_id, 'teacher');
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION add_organization_teacher_atomic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_organization_teacher_atomic(uuid, uuid) TO service_role;
