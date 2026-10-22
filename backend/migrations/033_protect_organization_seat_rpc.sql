-- Supabase can give browser roles explicit EXECUTE grants through default
-- privileges. Migration 021's PUBLIC-only revoke does not remove those grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE ALL ON FUNCTION public.add_organization_teacher_atomic(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_organization_teacher_atomic(uuid, uuid)
  TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.add_organization_teacher_atomic(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.add_organization_teacher_atomic(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Inherited browser execution requires review; migration 033 has rolled back without changing other roles';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
