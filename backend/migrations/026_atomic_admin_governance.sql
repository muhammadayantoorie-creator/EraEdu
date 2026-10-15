-- Requires 008_add_user_suspension.sql and 020_add_admin_governance_audit.sql.
-- Apply before deploying the API that calls admin_update_user_atomic. The
-- function's UPDATE and audit INSERT run in the same Postgres transaction.
-- Rollback: stop governance writes, redeploy a compatible API, then revoke and
-- drop this function. Preserve the audit table and its existing records.

DO $$
BEGIN
  IF to_regclass('public.admin_governance_audit') IS NULL THEN
    RAISE EXCEPTION 'Apply 020_add_admin_governance_audit.sql before 026_atomic_admin_governance.sql';
  END IF;
END;
$$;

ALTER TABLE public.admin_governance_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_governance_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.admin_governance_audit TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_user_atomic(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_role text DEFAULT NULL,
  p_is_suspended boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_locked_id uuid;
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_updated public.users%ROWTYPE;
  v_role_changed boolean;
  v_suspension_changed boolean;
BEGIN
  IF p_actor_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Actor and target account IDs are required';
  END IF;
  IF p_actor_id = p_target_user_id THEN
    RAISE EXCEPTION 'You cannot change your own administrator access from this screen';
  END IF;
  IF p_role IS NULL AND p_is_suspended IS NULL THEN
    RAISE EXCEPTION 'No changes provided';
  END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('student', 'teacher', 'admin') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  -- Always lock both accounts in UUID order. An actor demoted or suspended
  -- concurrently is checked only after that change has committed; two admins
  -- updating each other cannot invert the lock order.
  FOR v_locked_id IN
    SELECT id FROM public.users
    WHERE id IN (p_actor_id, p_target_user_id)
    ORDER BY id FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role IS DISTINCT FROM 'admin' OR v_actor.is_suspended IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Only active platform admins can change users';
  END IF;
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target user not found'; END IF;
  IF v_target.is_suspended IS NULL THEN
    RAISE EXCEPTION 'Account suspension state unavailable';
  END IF;

  v_role_changed := p_role IS NOT NULL AND p_role IS DISTINCT FROM v_target.role;
  v_suspension_changed := p_is_suspended IS NOT NULL
    AND p_is_suspended IS DISTINCT FROM v_target.is_suspended;
  IF NOT v_role_changed AND NOT v_suspension_changed THEN
    v_updated := v_target;
  ELSE
    UPDATE public.users
    SET role = COALESCE(p_role, role),
        is_suspended = COALESCE(p_is_suspended, is_suspended),
        suspended_at = CASE
          WHEN NOT v_suspension_changed THEN suspended_at
          WHEN p_is_suspended THEN now()
          ELSE NULL
        END
    WHERE id = p_target_user_id
    RETURNING * INTO v_updated;

    IF v_role_changed THEN
      INSERT INTO public.admin_governance_audit
        (actor_id, target_user_id, action, details)
      VALUES
        (p_actor_id, p_target_user_id, 'role_change',
         jsonb_build_object('previousRole', v_target.role, 'role', v_updated.role));
    END IF;
    IF v_suspension_changed THEN
      INSERT INTO public.admin_governance_audit
        (actor_id, target_user_id, action, details)
      VALUES
        (p_actor_id, p_target_user_id,
         CASE WHEN p_is_suspended THEN 'suspend' ELSE 'restore' END,
         jsonb_build_object('previousIsSuspended', v_target.is_suspended,
                            'isSuspended', v_updated.is_suspended));
    END IF;
  END IF;

  -- Never return credentials or biometric fields to the administration UI.
  RETURN jsonb_build_object(
    'id', v_updated.id, 'name', v_updated.name, 'email', v_updated.email,
    'role', v_updated.role, 'created_at', v_updated.created_at,
    'is_suspended', v_updated.is_suspended,
    'suspended_at', v_updated.suspended_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_atomic(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_atomic(uuid, uuid, text, boolean)
  TO service_role;
NOTIFY pgrst, 'reload schema';
