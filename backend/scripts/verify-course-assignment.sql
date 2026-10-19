-- Read-only checks for the database behind the affected EraEdu API.
-- Run after the ENTIRE 024_assign_courses_to_teachers.sql completes.
-- No accounts, course records, assignments, or credentials are returned.
BEGIN READ ONLY;
WITH required_columns(table_name, column_name) AS (VALUES
  ('courses', 'organization_id'),
  ('courses', 'max_students'),
  ('courses', 'course_code'),
  ('teacher_quizzes', 'original_teacher_id'),
  ('users', 'is_suspended')
), required_functions(signature) AS (VALUES
  ('public.admin_create_assigned_course(uuid,uuid,uuid,text,text,text,text,text,integer)'),
  ('public.admin_reassign_course(uuid,uuid,uuid,uuid)')
)
SELECT 'column' AS check_type, table_name || '.' || column_name AS check_name,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = r.table_name AND c.column_name = r.column_name)
    THEN 'PASS' ELSE 'MISSING' END AS status
FROM required_columns r
UNION ALL
SELECT 'table', 'course_assignment_audit',
  CASE WHEN to_regclass('public.course_assignment_audit') IS NOT NULL THEN 'PASS' ELSE 'MISSING' END
UNION ALL
SELECT 'function', signature,
  CASE WHEN to_regprocedure(signature) IS NOT NULL THEN 'PASS' ELSE 'MISSING' END
FROM required_functions
UNION ALL
SELECT 'permission', signature || ' / service_role',
  CASE WHEN to_regprocedure(signature) IS NULL THEN 'MISSING'
    WHEN has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE') THEN 'PASS'
    ELSE 'DENIED' END
FROM required_functions
UNION ALL
SELECT 'permission', signature || ' / browser roles denied',
  CASE WHEN to_regprocedure(signature) IS NULL THEN 'MISSING'
    WHEN has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
      OR has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE') THEN 'UNSAFE'
    ELSE 'PASS' END
FROM required_functions
ORDER BY check_type, check_name;
COMMIT;
