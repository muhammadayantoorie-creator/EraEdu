-- Catalog inventory across non-system schemas. No application rows or secrets
-- are returned. Approximate counts/zero index scans do NOT prove data is unused.
-- This file makes no cleanup decision and executes no application functions.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
WITH application_tables(name) AS (VALUES
  ('users'), ('courses'), ('topics'), ('questions'), ('enrollments'),
  ('quizzes'), ('quiz_questions'), ('teacher_quizzes'), ('quiz_codes'),
  ('quiz_attempts'), ('cheating_violations'), ('notifications'),
  ('student_feedback'), ('organizations'), ('organization_members'),
  ('safepay_payments'), ('admin_governance_audit'), ('course_assignment_audit')
), objects AS (
  SELECT c.*, n.nspname,
    (SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
        AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e' LIMIT 1) AS extension_owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
)
SELECT o.nspname AS schema_name, o.relname AS object_name,
  CASE o.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
    WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table' END AS object_type,
  CASE WHEN o.extension_owner IS NOT NULL THEN 'KEEP: extension-owned object'
    WHEN o.nspname IN ('auth','storage','realtime','supabase_migrations','supabase_functions','extensions','vault','net','graphql','graphql_public')
      THEN 'KEEP: platform-managed schema'
    WHEN o.nspname <> 'public' THEN 'REVIEW OWNER: non-public/custom schema; no removal decision'
    WHEN EXISTS (SELECT 1 FROM application_tables a WHERE a.name = o.relname)
      THEN 'KEEP: application or assessment/payment/audit history'
    ELSE 'REVIEW ONLY: ownership and use not established; no removal decision'
  END AS disposition,
  CASE WHEN o.reltuples >= 0 AND o.relkind IN ('r','p','m') THEN o.reltuples::bigint ELSE NULL END AS approximate_rows,
  CASE WHEN o.relkind IN ('r','p','m') THEN pg_total_relation_size(o.oid) ELSE NULL END AS total_relation_bytes,
  o.extension_owner, o.relispartition AS is_partition,
  (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = o.oid OR k.confrelid = o.oid) AS constraint_relationships,
  (SELECT count(*) FROM pg_index i WHERE i.indrelid = o.oid) AS index_count,
  (SELECT jsonb_agg(jsonb_build_object('name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod), 'nullable', NOT a.attnotnull) ORDER BY a.attnum)
    FROM pg_attribute a WHERE a.attrelid = o.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns
FROM objects o
ORDER BY o.nspname, o.relname;
COMMIT;
