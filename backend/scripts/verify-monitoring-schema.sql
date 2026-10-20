-- Read-only structural checks for migration 019; returns no exam or user data.
-- All eight checks must report PASS in the same project used by the backend.
BEGIN READ ONLY;
WITH required_columns(table_name, column_name, expected_type) AS (VALUES
  ('cheating_violations', 'event_id', 'text'::regtype),
  ('quiz_attempts', 'violation_count', 'integer'::regtype),
  ('quiz_attempts', 'violations', 'jsonb'::regtype)
), required_defaults(column_name, expected_expression) AS (VALUES
  ('violation_count', '0'),
  ('violations', '''[]''::jsonb')
)
SELECT 'table' AS check_type, table_name AS check_name,
  CASE WHEN to_regclass('public.' || table_name) IS NOT NULL THEN 'PASS' ELSE 'MISSING' END AS status
FROM (VALUES ('cheating_violations'), ('quiz_attempts')) AS required_tables(table_name)
UNION ALL
SELECT 'column', table_name || '.' || column_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.' || r.table_name)
      AND a.attname = r.column_name AND NOT a.attisdropped AND a.atttypid = r.expected_type
  ) THEN 'PASS' ELSE 'MISSING OR INCOMPATIBLE' END
FROM required_columns r
UNION ALL
SELECT 'default', 'quiz_attempts.' || column_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = to_regclass('public.quiz_attempts') AND a.attname = r.column_name
      AND NOT a.attisdropped AND pg_get_expr(d.adbin, d.adrelid) = r.expected_expression
  ) THEN 'PASS' ELSE 'MISSING OR INCOMPATIBLE' END
FROM required_defaults r
UNION ALL
SELECT 'index', 'cheating_violations_attempt_event_id_unique',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute attempt ON attempt.attrelid = i.indrelid
      AND attempt.attname = 'quiz_attempt_id' AND NOT attempt.attisdropped
    JOIN pg_attribute event ON event.attrelid = i.indrelid
      AND event.attname = 'event_id' AND NOT event.attisdropped
    WHERE i.indexrelid = to_regclass('public.cheating_violations_attempt_event_id_unique')
      AND i.indrelid = to_regclass('public.cheating_violations')
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts = 2
      AND i.indkey[0] = attempt.attnum AND i.indkey[1] = event.attnum
      AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[[:space:]()]', '', 'g') = 'event_idISNOTNULL'
  ) THEN 'PASS' ELSE 'MISSING OR INCOMPATIBLE' END
ORDER BY check_type, check_name;
COMMIT;
