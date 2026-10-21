-- EraEdu schema/security inventory through migration 031.
-- Run the ENTIRE file in the connected Supabase project's SQL Editor as the
-- database administrator. It returns ONE result table. It does not read user
-- records, invoke application RPCs, apply migrations, or modify data/schema.
-- PASS means only the named check passed, NOT that the database is release-ready.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
WITH
requirements(table_name, columns_csv, source) AS (VALUES
 ('users','id,name,email,password,role,bio,interests,created_at,updated_at','base schema'),
 ('users','profile_picture_url,face_encoding','003'),
 ('users','reset_password_token,reset_password_expires_at','004'),
 ('users','is_suspended,suspended_at','008 / 029'),
 ('users','subscription_status','010'),
 ('users','student_otp_hash,student_otp_expires_at,student_otp_attempts','014'),
 ('users','free_assessment_trials_used','017'),
 ('courses','id,title,description,category,difficulty,thumbnail,created_by,is_published,created_at,updated_at','base schema'),
 ('courses','max_students','006 / 023'),
 ('courses','course_code','015'),
 ('courses','organization_id','024'),
 ('topics','id,title,description,course_id,order,created_at,updated_at','base schema'),
 ('questions','id,content,question_text,options,correct_answer,correct_answers,difficulty,topic_id,explanation,question_type,created_by,created_at,updated_at','base schema / enhanced questions'),
 ('enrollments','id,user_id,course_id,enrolled_at,progress','base schema / 023'),
 ('quizzes','id,topic_id,created_by,title,time_limit,is_published','base schema / topic exams'),
 ('quiz_questions','id,quiz_id,question_id,order_number','base schema'),
 ('teacher_quizzes','id,teacher_id,title,description,time_limit,questions,access_code,scheduled_start,is_active,created_at,updated_at','001'),
 ('teacher_quizzes','course_id,camera_monitoring,violation_limit','002 / 005 / 007 / 016'),
 ('teacher_quizzes','original_teacher_id','024'),
 ('quiz_codes','id,quiz_id,course_id,created_by,code,expires_at,is_active,access_count,max_attempts','base schema'),
 ('quiz_attempts','id,user_id,quiz_id,topic_id,score,max_score,total_questions,answers,status,difficulty,teacher_grade,teacher_feedback,is_flagged,auto_submitted,submission_reason,accessed_via,started_at,completed_at','base schema'),
 ('quiz_attempts','violation_count,violations','019'),
 ('quiz_attempts','topic_question_snapshot','022'),
 ('quiz_attempts','teacher_quiz_ref,topic_quiz_ref','025'),
 ('quiz_attempts','teacher_quiz_snapshot,teacher_question_state,teacher_answers_finalized_at','027'),
 ('cheating_violations','id,quiz_attempt_id,student_id,quiz_id,teacher_id,violation_type,detection_method,severity,timestamp,details','base schema'),
 ('cheating_violations','event_id','019'),
 ('notifications','id,user_id,title,message,type,quiz_id,quiz_code,is_read,created_at','base schema'),
 ('student_feedback','id,attempt_id,student_id,quiz_id,rating,category,liked,improvements,would_recommend,created_at','009'),
 ('organizations','id,name,owner_id,seat_limit,created_at,updated_at','012'),
 ('organizations','free_assessment_trials_used,subscription_status','018'),
 ('organization_members','organization_id,user_id,role,created_at','012'),
 ('safepay_payments','tracker_token,user_id,plan,amount,currency,status,paid_at,created_at,updated_at','013'),
 ('safepay_payments','organization_id','018'),
 ('admin_governance_audit','id,actor_id,target_user_id,action,details,created_at','020 / 026'),
 ('course_assignment_audit','id,course_id,actor_id,organization_id,previous_teacher_id,new_teacher_id,created_at','024')
), tables AS (
 SELECT DISTINCT table_name, to_regclass(format('public.%I',table_name)) AS oid FROM requirements
), columns AS (
 SELECT r.table_name, col AS column_name, r.source, a.attnum, a.attnotnull,
        a.atttypid, a.attgenerated, pg_get_expr(d.adbin,d.adrelid) AS default_expr
 FROM requirements r CROSS JOIN LATERAL unnest(string_to_array(r.columns_csv,',')) col
 LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(format('public.%I',r.table_name))
   AND a.attname=col AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
), contracts(table_name,column_name,type_name,not_null,default_value,source) AS (VALUES
 ('users','is_suspended','boolean',true,'false','029'),
 ('questions','correct_answer','integer',false,NULL,'canonical multiple-choice option index'),
 ('courses','max_students','integer',false,NULL,'006 / 023; NULL means unlimited'),
 ('teacher_quizzes','camera_monitoring','boolean',true,'true','005 / 016'),
 ('teacher_quizzes','violation_limit','integer',true,'3','007 / 016'),
 ('quiz_attempts','topic_question_snapshot','jsonb',false,NULL,'022'),
 ('quiz_attempts','teacher_quiz_snapshot','jsonb',false,NULL,'027'),
 ('quiz_attempts','teacher_question_state','jsonb',true,'''{}''::jsonb','027'),
 ('quiz_attempts','teacher_quiz_ref','uuid',false,NULL,'025'),
 ('quiz_attempts','topic_quiz_ref','uuid',false,NULL,'025')
), functions(signature,security_definer,service_execute,source) AS (VALUES
 ('public.add_organization_teacher_atomic(uuid,uuid)',true,true,'021'),
 ('public.enroll_course_with_capacity(uuid,uuid)',true,true,'023'),
 ('public.admin_create_assigned_course(uuid,uuid,uuid,text,text,text,text,text,integer)',true,true,'024'),
 ('public.admin_reassign_course(uuid,uuid,uuid,uuid)',true,true,'024'),
 ('public.assessment_history_protection_ready()',false,true,'025'),
 ('public.admin_update_user_atomic(uuid,uuid,text,boolean)',true,true,'026'),
 ('public.finish_teacher_attempt(uuid,text)',true,false,'027 internal helper; no direct client access'),
 ('public.start_teacher_attempt(uuid,uuid)',true,true,'027'),
 ('public.teacher_attempt_action(uuid,uuid,text,text,jsonb)',true,true,'027'),
 ('public.report_teacher_violation(uuid,uuid,jsonb)',true,true,'027'),
 ('public.apply_verified_safepay_payment(text,text,uuid)',true,true,'028')
), function_state AS (
 SELECT f.*, p.oid, p.prosecdef, p.proconfig FROM functions f
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(f.signature)
), role_state AS (
 SELECT name, (SELECT oid FROM pg_roles WHERE rolname=name) AS oid
 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(name)
), indexes(table_name,index_name,key_columns,source) AS (VALUES
 ('enrollments','enrollments_one_seat_per_student_course',ARRAY['user_id','course_id'],'023'),
 ('courses','courses_course_code_unique',ARRAY['course_code'],'015'),
 ('cheating_violations','cheating_violations_attempt_event_id_unique',ARRAY['quiz_attempt_id','event_id'],'019'),
 ('quiz_attempts','quiz_attempts_one_active_topic_exam',ARRAY['user_id','quiz_id'],'022'),
 ('quiz_attempts','quiz_attempts_one_active_teacher_exam',ARRAY['user_id','quiz_id'],'027'),
 ('organization_members','organization_members_pkey',ARRAY['organization_id','user_id'],'012'),
 ('student_feedback','student_feedback_attempt_id_student_id_key',ARRAY['attempt_id','student_id'],'009'),
 ('safepay_payments','safepay_payments_pkey',ARRAY['tracker_token'],'013')
), constraints(table_name,constraint_name,source) AS (VALUES
 ('courses','courses_max_students_positive','023'),
 ('teacher_quizzes','teacher_quizzes_violation_limit_check','007 / 016'),
 ('quiz_attempts','quiz_attempts_quiz_id_required','025'),
 ('quiz_attempts','quiz_attempts_teacher_quiz_ref_fkey','025'),
 ('quiz_attempts','quiz_attempts_topic_quiz_ref_fkey','025'),
 ('quiz_attempts','quiz_attempts_topic_id_fkey','025'),
 ('teacher_quizzes','teacher_quizzes_course_id_fkey','025')
), triggers(table_name,trigger_name,function_name,source) AS (VALUES
 ('teacher_quizzes','enforce_free_assessment_trial_limit_on_create','enforce_free_assessment_trial_limit','017 / 018'),
 ('teacher_quizzes','keep_quiz_original_teacher_on_insert','keep_quiz_original_teacher','024'),
 ('teacher_quizzes','require_current_course_teacher_for_quiz_write','require_current_course_teacher_for_quiz','024'),
 ('quiz_codes','require_current_teacher_for_quiz_code_write','require_current_teacher_for_quiz_code','024')
), checks(section,check_name,status,detail) AS (
 SELECT 'table',table_name,CASE WHEN c.relkind IN ('r','p') THEN 'PASS' ELSE 'BLOCKED' END,
   'Required public table; missing tables require reviewed base schema, not blind bootstrap'
 FROM tables t LEFT JOIN pg_class c ON c.oid=t.oid
 UNION ALL
 SELECT 'column',table_name||'.'||column_name,CASE WHEN attnum IS NULL THEN 'BLOCKED' ELSE 'PASS' END,
   source||'; actual type='||coalesce(format_type(atttypid,NULL),'MISSING')
 FROM columns
 UNION ALL
 SELECT 'contract',k.table_name||'.'||k.column_name,
   CASE WHEN c.attnum IS NULL OR c.atttypid IS DISTINCT FROM to_regtype(k.type_name)
     OR c.attnotnull IS DISTINCT FROM k.not_null
     OR (k.default_value IS NOT NULL AND c.default_expr IS DISTINCT FROM k.default_value)
     THEN 'BLOCKED' ELSE 'PASS' END,
   k.source||'; NOT NULL='||coalesce(c.attnotnull::text,'MISSING')||'; default='||coalesce(c.default_expr,'NULL')
 FROM contracts k LEFT JOIN columns c USING (table_name,column_name)
 UNION ALL
 SELECT 'generated',table_name||'.'||column_name,
   CASE WHEN attgenerated='s' THEN 'REVIEW' ELSE 'BLOCKED' END,
   '025; verify the teacher/topic CASE split, not just column existence: '||coalesce(default_expr,'MISSING')
 FROM columns WHERE column_name IN ('teacher_quiz_ref','topic_quiz_ref')
 UNION ALL
 SELECT 'relationship','quiz_codes.quiz_id -> teacher_quizzes.id',
   CASE WHEN EXISTS (
     SELECT 1 FROM pg_constraint fk
     JOIN pg_attribute source_column ON source_column.attrelid=fk.conrelid AND source_column.attname='quiz_id' AND NOT source_column.attisdropped
     JOIN pg_attribute target_column ON target_column.attrelid=fk.confrelid AND target_column.attname='id' AND NOT target_column.attisdropped
     WHERE fk.conrelid=to_regclass('public.quiz_codes') AND fk.confrelid=to_regclass('public.teacher_quizzes')
       AND fk.contype='f' AND fk.conkey=ARRAY[source_column.attnum]::smallint[] AND fk.confkey=ARRAY[target_column.attnum]::smallint[]
   ) AND NOT EXISTS (
     SELECT 1 FROM pg_constraint fk JOIN pg_attribute column_state ON column_state.attrelid=fk.conrelid AND column_state.attname='quiz_id'
     WHERE fk.conrelid=to_regclass('public.quiz_codes') AND fk.contype='f' AND column_state.attnum=ANY(fk.conkey)
       AND fk.confrelid IS DISTINCT FROM to_regclass('public.teacher_quizzes')
   ) THEN 'PASS' ELSE 'BLOCKED' END,
   '030; the old bootstrap can leave a topic-quiz FK under the same constraint name. Review legacy rows before repair.'
 UNION ALL
 SELECT 'role',name,CASE WHEN oid IS NULL THEN 'BLOCKED' ELSE 'PASS' END,'Expected Supabase role' FROM role_state
 UNION ALL
 SELECT 'function',signature,
   CASE WHEN oid IS NULL OR prosecdef IS DISTINCT FROM security_definer THEN 'BLOCKED'
     WHEN security_definer AND NOT coalesce('search_path=public'=ANY(proconfig),false) THEN 'BLOCKED'
     ELSE 'PASS' END,
   source||'; checks signature/security/search_path only; does NOT execute or verify function body'
 FROM function_state
 UNION ALL
 SELECT 'function_permission',f.signature||' / '||r.name,
   CASE WHEN f.oid IS NULL OR r.oid IS NULL THEN 'BLOCKED'
     WHEN has_function_privilege(r.oid,f.oid,'EXECUTE') THEN 'BLOCKED' ELSE 'PASS' END,
   f.source||'; browser roles must not invoke this RPC, including inherited/PUBLIC grants'
 FROM function_state f CROSS JOIN role_state r WHERE r.name IN ('anon','authenticated')
 UNION ALL
 SELECT 'function_permission',signature||' / service_role',
   CASE WHEN f.oid IS NOT NULL AND r.oid IS NOT NULL AND has_function_privilege(r.oid,f.oid,'EXECUTE') THEN 'PASS' ELSE 'BLOCKED' END,
   source||'; server must be able to call the RPC'
 FROM function_state f CROSS JOIN role_state r WHERE r.name='service_role' AND f.service_execute
 UNION ALL
 SELECT 'unique_index',e.index_name,
   CASE WHEN NOT coalesce(i.indisunique AND i.indisvalid AND i.indisready,false)
     OR i.indrelid IS DISTINCT FROM to_regclass(format('public.%I',e.table_name))
     OR ARRAY(SELECT pg_get_indexdef(i.indexrelid,n,true) FROM generate_series(1,i.indnkeyatts) n) IS DISTINCT FROM e.key_columns
     THEN 'BLOCKED' WHEN i.indpred IS NOT NULL THEN 'REVIEW' ELSE 'PASS' END,
   e.source||'; actual definition='||coalesce(pg_get_indexdef(i.indexrelid),'MISSING')||'; verify any partial predicate'
 FROM indexes e LEFT JOIN pg_index i ON i.indexrelid=to_regclass(format('public.%I',e.index_name))
 UNION ALL
 SELECT 'constraint',e.table_name||'.'||e.constraint_name,
   CASE WHEN c.oid IS NULL THEN 'BLOCKED' ELSE 'REVIEW' END,
   e.source||'; validated='||coalesce(c.convalidated::text,'MISSING')||'; '||coalesce(pg_get_constraintdef(c.oid),'MISSING')
   ||'; review definition/delete policy; NOT VALID requires legacy-data review, not blind validation'
 FROM constraints e LEFT JOIN pg_constraint c ON c.conrelid=to_regclass(format('public.%I',e.table_name)) AND c.conname=e.constraint_name
 UNION ALL
 SELECT 'trigger',e.table_name||'.'||e.trigger_name,
   CASE WHEN t.oid IS NULL OR t.tgenabled NOT IN ('O','A') OR p.proname IS DISTINCT FROM e.function_name THEN 'BLOCKED' ELSE 'REVIEW' END,
   e.source||'; verify trigger events/body: '||coalesce(pg_get_triggerdef(t.oid),'MISSING')
 FROM triggers e LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass(format('public.%I',e.table_name)) AND t.tgname=e.trigger_name AND NOT t.tgisinternal
 LEFT JOIN pg_proc p ON p.oid=t.tgfoid
 UNION ALL
 SELECT 'rls',t.table_name,CASE WHEN c.oid IS NULL OR NOT c.relrowsecurity THEN 'BLOCKED' ELSE 'REVIEW' END,
   'Launch checklist requires RLS; enabled alone does not prove that policies are safe'
 FROM tables t LEFT JOIN pg_class c ON c.oid=t.oid
 UNION ALL
 SELECT 'browser_table_access',t.table_name||' / '||r.name,
   CASE WHEN t.oid IS NULL OR r.oid IS NULL THEN 'BLOCKED'
     WHEN has_table_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES')
       THEN 'BLOCKED'
     ELSE 'PASS' END,
   '031; application data goes through Express. Browser roles must have no direct table or column access; provider schemas are separate.'
 FROM tables t LEFT JOIN pg_class c ON c.oid=t.oid CROSS JOIN role_state r WHERE r.name IN ('anon','authenticated')
 UNION ALL
 SELECT 'server_table_access',t.table_name||' / service_role',
   CASE WHEN t.oid IS NULL OR r.oid IS NULL OR NOT has_table_privilege(r.oid,t.oid,'SELECT') THEN 'BLOCKED'
     WHEN NOT coalesce(s.rolbypassrls OR s.rolsuper,false) THEN 'REVIEW' ELSE 'PASS' END,
   'Server requires SELECT; verify operation-specific write grants separately. Non-bypass RLS needs policy review'
 FROM tables t CROSS JOIN role_state r LEFT JOIN pg_roles s ON s.oid=r.oid WHERE r.name='service_role'
 UNION ALL
 SELECT 'server_operation_access',t.table_name||' / service_role / '||operation,
   CASE WHEN t.oid IS NOT NULL AND r.oid IS NOT NULL AND has_table_privilege(r.oid,t.oid,operation) THEN 'PASS' ELSE 'BLOCKED' END,
   '031; check each operation separately. A combined privilege string means ANY privilege, not all of them.'
 FROM tables t CROSS JOIN role_state r CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) operations(operation)
 WHERE r.name='service_role'
 UNION ALL
 SELECT 'policy',c.relname||'.'||p.polname,'REVIEW',
   'Existing policy; command='||p.polcmd::text||'; permissive='||p.polpermissive::text||'; inspect privately with grants; no row data exposed'
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN tables t ON t.oid=c.oid
 UNION ALL
 SELECT 'foreign_key_inventory',c.relname||'.'||k.conname,'REVIEW',pg_get_constraintdef(k.oid)
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN tables t ON t.oid=c.oid
 WHERE k.contype='f'
 UNION ALL
 SELECT 'release_gate','live API / data / concurrency / restore','NOT_TESTED',
   'Catalog checks cannot prove API-to-project connection, row integrity, authorization, race safety, payment sandbox, backups/restore, or migration-body equality. Use verification/DATABASE_REVIEW.md.'
)
SELECT section,check_name,status,detail FROM checks
ORDER BY CASE status WHEN 'BLOCKED' THEN 0 WHEN 'REVIEW' THEN 1 WHEN 'NOT_TESTED' THEN 2 ELSE 3 END,section,check_name;
COMMIT;
