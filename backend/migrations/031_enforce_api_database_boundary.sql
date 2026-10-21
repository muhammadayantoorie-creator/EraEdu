-- EraEdu uses Express authentication and the server service-role client.
-- The frontend performs no direct application-table queries. Provider-managed
-- schemas (auth/storage/etc.), custom tables and existing policies are retained.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE table_name text; column_list text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND (rolbypassrls OR rolsuper))
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Migration 031 requires the Supabase browser roles and a service_role that bypasses RLS. Verify server credentials and roles first; no permissions have changed.';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'users','courses','topics','questions','enrollments','quizzes','quiz_questions',
    'teacher_quizzes','quiz_codes','quiz_attempts','cheating_violations','notifications',
    'student_feedback','organizations','organization_members','safepay_payments',
    'admin_governance_audit','course_assignment_audit'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(format('public.%I', table_name)) AND relkind IN ('r','p')) THEN
      RAISE EXCEPTION 'Required table public.% is missing. Review the schema audit before migration 031; no permissions have changed.', table_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO column_list
      FROM pg_attribute WHERE attrelid = to_regclass(format('public.%I', table_name))
        AND attnum > 0 AND NOT attisdropped;
    -- Table-level REVOKE does not remove prior column-specific grants.
    EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated', column_list, table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', table_name);
    IF has_table_privilege('anon', to_regclass(format('public.%I', table_name)), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('anon', to_regclass(format('public.%I', table_name)), 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_table_privilege('authenticated', to_regclass(format('public.%I', table_name)), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('authenticated', to_regclass(format('public.%I', table_name)), 'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Browser access remains through inherited role grants on public.%. Review memberships; migration 031 has been rolled back.', table_name;
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
