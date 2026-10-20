-- Read-only structural/security checks for migration 027 and its 019 dependency.
-- Run the ENTIRE file in the backend's Supabase project as the SQL administrator.
-- All 27 rows must report PASS. No account/exam records are returned or RPCs executed.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
WITH required_columns(table_name, column_name, expected_type) AS (VALUES
  ('quiz_attempts', 'teacher_quiz_snapshot', 'jsonb'::regtype),
  ('quiz_attempts', 'teacher_question_state', 'jsonb'::regtype),
  ('quiz_attempts', 'teacher_answers_finalized_at', 'timestamptz'::regtype),
  ('quiz_attempts', 'violation_count', 'integer'::regtype),
  ('cheating_violations', 'event_id', 'text'::regtype)
), required_functions(signature, service_entry) AS (VALUES
  ('public.start_teacher_attempt(uuid,uuid)', true),
  ('public.teacher_attempt_action(uuid,uuid,text,text,jsonb)', true),
  ('public.report_teacher_violation(uuid,uuid,jsonb)', true),
  ('public.finish_teacher_attempt(uuid,text)', false)
), functions AS (
  SELECT f.*, p.oid, p.prosecdef, p.proconfig, p.prorettype
  FROM required_functions f LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.signature)
), roles AS (
  SELECT name, (SELECT oid FROM pg_roles WHERE rolname = name) AS oid
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(name)
)
SELECT 'table' AS check_type, table_name AS check_name,
  CASE WHEN to_regclass('public.' || table_name) IS NOT NULL THEN 'PASS' ELSE 'MISSING' END AS status
FROM (VALUES ('quiz_attempts'), ('teacher_quizzes'), ('cheating_violations')) t(table_name)
UNION ALL
SELECT 'column', table_name || '.' || column_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.' || r.table_name)
      AND a.attname = r.column_name AND NOT a.attisdropped AND a.atttypid = r.expected_type
  ) THEN 'PASS' ELSE 'MISSING OR INCOMPATIBLE' END
FROM required_columns r
UNION ALL
SELECT 'column contract', 'quiz_attempts.teacher_question_state / not null and empty-object default',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = to_regclass('public.quiz_attempts') AND a.attname = 'teacher_question_state'
      AND NOT a.attisdropped AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''{}''::jsonb'
  ) THEN 'PASS' ELSE 'MISSING OR INCOMPATIBLE' END
UNION ALL
SELECT 'function', signature,
  CASE WHEN oid IS NULL THEN 'MISSING'
    WHEN prorettype = 'jsonb'::regtype THEN 'PASS' ELSE 'INCOMPATIBLE RETURN TYPE' END
FROM functions
UNION ALL
SELECT 'function security', signature || ' / security definer and fixed search path',
  CASE WHEN oid IS NULL THEN 'MISSING'
    WHEN prosecdef AND proconfig @> ARRAY['search_path=public'] THEN 'PASS' ELSE 'UNSAFE' END
FROM functions
UNION ALL
SELECT 'permission', signature || ' / service_role',
  CASE WHEN f.oid IS NULL OR r.oid IS NULL THEN 'MISSING'
    WHEN has_function_privilege(r.oid, f.oid, 'EXECUTE') THEN 'PASS' ELSE 'DENIED' END
FROM functions f CROSS JOIN roles r WHERE f.service_entry AND r.name = 'service_role'
UNION ALL
SELECT 'permission', signature || ' / browser roles denied',
  CASE WHEN f.oid IS NULL OR EXISTS (SELECT 1 FROM roles WHERE oid IS NULL) THEN 'MISSING'
    WHEN EXISTS (SELECT 1 FROM roles r WHERE r.name IN ('anon', 'authenticated')
      AND has_function_privilege(r.oid, f.oid, 'EXECUTE')) THEN 'UNSAFE' ELSE 'PASS' END
FROM functions f
UNION ALL
SELECT 'permission', 'quiz_attempts / browser table and column access denied',
  CASE WHEN to_regclass('public.quiz_attempts') IS NULL
      OR EXISTS (SELECT 1 FROM roles WHERE oid IS NULL) THEN 'MISSING'
    WHEN EXISTS (SELECT 1 FROM roles r WHERE r.name IN ('anon', 'authenticated') AND (
      has_table_privilege(r.oid, to_regclass('public.quiz_attempts'), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(r.oid, to_regclass('public.quiz_attempts'), 'SELECT,INSERT,UPDATE,REFERENCES')
    )) THEN 'UNSAFE' ELSE 'PASS' END
UNION ALL
SELECT 'index', 'quiz_attempts_one_active_teacher_exam',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute student ON student.attrelid = i.indrelid
      AND student.attname = 'user_id' AND NOT student.attisdropped
    JOIN pg_attribute exam ON exam.attrelid = i.indrelid
      AND exam.attname = 'quiz_id' AND NOT exam.attisdropped
    WHERE i.indexrelid = to_regclass('public.quiz_attempts_one_active_teacher_exam')
      AND i.indrelid = to_regclass('public.quiz_attempts')
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts = 2
      AND i.indkey[0] = student.attnum AND i.indkey[1] = exam.attnum
      AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[[:space:]()]', '', 'g') IN (
        'topic_idISNULLANDstatus=''in-progress''::text',
        'topic_idISNULLANDstatus::text=''in-progress''::text'
      )
  ) THEN 'PASS' ELSE 'MISSING OR INCOMPATIBLE' END
UNION ALL
SELECT 'index dependency', 'cheating_violations event retry uniqueness / migration 019',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute attempt ON attempt.attrelid = i.indrelid
      AND attempt.attname = 'quiz_attempt_id' AND NOT attempt.attisdropped
    JOIN pg_attribute event ON event.attrelid = i.indrelid
      AND event.attname = 'event_id' AND NOT event.attisdropped
    WHERE i.indrelid = to_regclass('public.cheating_violations')
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts = 2
      AND i.indkey[0] = attempt.attnum AND i.indkey[1] = event.attnum
      AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[[:space:]()]', '', 'g') = 'event_idISNOTNULL'
  ) THEN 'PASS' ELSE 'MISSING OR INCOMPATIBLE' END
ORDER BY check_type, check_name;
COMMIT;
