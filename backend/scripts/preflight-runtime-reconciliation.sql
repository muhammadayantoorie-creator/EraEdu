-- Metadata/counts only. No IDs, codes, accounts, answers or credentials returned.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT 'quiz codes requiring review before 030' AS check_name,
  CASE WHEN count(*) FILTER (WHERE code_row.quiz_id IS NOT NULL AND exam.id IS NULL)=0 THEN 'PASS' ELSE 'BLOCKED' END AS status,
  count(*) FILTER (WHERE code_row.quiz_id IS NOT NULL AND exam.id IS NULL) AS affected,
  'Must be zero; legacy topic codes and missing references are never deleted or relinked automatically.' AS detail
FROM public.quiz_codes code_row LEFT JOIN public.teacher_quizzes exam ON exam.id = code_row.quiz_id
UNION ALL
SELECT 'service role RLS bypass required for 031' AS check_name,
  CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND (rolbypassrls OR rolsuper))
    THEN 'PASS' ELSE 'BLOCKED' END AS status,
  CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND (rolbypassrls OR rolsuper)) THEN 0 ELSE 1 END AS affected,
  'The deployed API must use SUPABASE_SERVICE_KEY. Never put it in a frontend variable.' AS detail;
COMMIT;
