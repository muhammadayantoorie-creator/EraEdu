-- Run ONLY after the table/column/type blockers in audit_database_readonly.sql
-- are resolved. Counts only: no names, emails, IDs, passwords, keys or answers.
-- A query error is NOT a pass. Large databases may hit the 30-second limit;
-- schedule a reviewed off-peak/read-replica check, do not remove safety limits blindly.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
WITH checks(check_name,affected,detail) AS (
 SELECT 'account status unknown',count(*),'Never assume NULL means active; review 029 prerequisites'
 FROM public.users WHERE is_suspended IS NULL
 UNION ALL
 SELECT 'unsupported account role',count(*),'Review legacy roles explicitly; do not rewrite roles just to pass'
 FROM public.users WHERE role IS NULL OR role NOT IN ('student','teacher','admin')
 UNION ALL
 SELECT 'duplicate normalized account emails',count(*),'Review privately; do not delete or merge accounts automatically'
 FROM (SELECT lower(trim(email)) FROM public.users GROUP BY lower(trim(email)) HAVING count(*)>1) d
 UNION ALL
 SELECT 'password-reset challenge fields expired over 24 hours',count(*),
   'Temporary-field cleanup candidate only; preserve accounts, passwords and current reset links. No cleanup is performed.'
 FROM public.users WHERE reset_password_token IS NOT NULL
   AND reset_password_expires_at < statement_timestamp() - interval '24 hours'
 UNION ALL
 SELECT 'student OTP challenge fields expired over 24 hours',count(*),
   'Temporary-field cleanup candidate only; preserve accounts and active verification challenges. No cleanup is performed.'
 FROM public.users WHERE student_otp_hash IS NOT NULL
   AND student_otp_expires_at < statement_timestamp() - interval '24 hours'
 UNION ALL
 SELECT 'invalid course capacity',count(*),'NULL is unlimited; supplied limits must be positive'
 FROM public.courses WHERE max_students IS NOT NULL AND max_students<=0
 UNION ALL
 SELECT 'duplicate enrollments',count(*),'Review records before applying/repairing 023 uniqueness'
 FROM (SELECT user_id,course_id FROM public.enrollments GROUP BY user_id,course_id HAVING count(*)>1) d
 UNION ALL
 SELECT 'quiz codes without a teacher-exam reference',count(*),'030 must refuse these rows; review legacy topic codes without deleting or relinking them'
 FROM public.quiz_codes code_row LEFT JOIN public.teacher_quizzes exam ON exam.id=code_row.quiz_id
 WHERE code_row.quiz_id IS NOT NULL AND exam.id IS NULL
 UNION ALL
 SELECT 'active quiz codes with a different course than their teacher exam',count(*),'Review intended scope after course changes; do not silently transfer access or enrollment'
 FROM public.quiz_codes code_row JOIN public.teacher_quizzes exam ON exam.id=code_row.quiz_id
 WHERE code_row.is_active IS TRUE AND code_row.course_id IS DISTINCT FROM exam.course_id
 UNION ALL
 SELECT 'active teacher exams linked to unpublished courses',count(*),'May be intentional drafts. Students cannot start until the selected course is published and they enroll; no automatic publishing'
 FROM public.teacher_quizzes exam JOIN public.courses course_row ON course_row.id=exam.course_id
 WHERE exam.is_active IS TRUE AND course_row.is_published IS DISTINCT FROM true
 UNION ALL
 SELECT 'courses over capacity',count(*),'Investigate history and capacity changes; do not remove students automatically'
 FROM public.courses c WHERE max_students IS NOT NULL
 AND (SELECT count(*) FROM public.enrollments e WHERE e.course_id=c.id)>c.max_students
 UNION ALL
 SELECT 'enrollments with missing student or course',count(*),'Preserve records for reviewed repair'
 FROM public.enrollments e LEFT JOIN public.users u ON u.id=e.user_id LEFT JOIN public.courses c ON c.id=e.course_id
 WHERE u.id IS NULL OR c.id IS NULL
 UNION ALL
 SELECT 'topics with missing course',count(*),'Review references; do not delete material'
 FROM public.topics t LEFT JOIN public.courses c ON c.id=t.course_id WHERE c.id IS NULL
 UNION ALL
 SELECT 'assigned bank questions with missing topic',count(*),'Unassigned questions are permitted; only broken non-null references counted'
 FROM public.questions q LEFT JOIN public.topics t ON t.id=q.topic_id WHERE q.topic_id IS NOT NULL AND t.id IS NULL
 UNION ALL
 SELECT 'teacher exams with missing owner or assigned course',count(*),'Standalone exams can have NULL course_id'
 FROM public.teacher_quizzes q LEFT JOIN public.users u ON u.id::text=q.teacher_id
 LEFT JOIN public.courses c ON c.id=q.course_id WHERE u.id IS NULL OR (q.course_id IS NOT NULL AND c.id IS NULL)
 UNION ALL
 SELECT 'course exam manager mismatch',count(*),'024 transfers management while preserving original authorship/history'
 FROM public.teacher_quizzes q JOIN public.courses c ON c.id=q.course_id WHERE q.teacher_id IS DISTINCT FROM c.created_by::text
 UNION ALL
 SELECT 'invalid exam security settings',count(*),'Monitoring must be explicit; threshold must be between 1 and 100'
 FROM public.teacher_quizzes WHERE camera_monitoring IS NULL OR violation_limit IS NULL OR violation_limit NOT BETWEEN 1 AND 100
 UNION ALL
 SELECT 'attempts with missing student',count(*),'Do not erase assessment history'
 FROM public.quiz_attempts a LEFT JOIN public.users u ON u.id=a.user_id WHERE u.id IS NULL
 UNION ALL
 SELECT 'teacher attempts with missing exam',count(*),'Teacher attempts use teacher_quizzes, not quizzes'
 FROM public.quiz_attempts a LEFT JOIN public.teacher_quizzes q ON q.id=a.quiz_id WHERE a.topic_id IS NULL AND q.id IS NULL
 UNION ALL
 SELECT 'topic attempts with missing or mismatched exam/topic',count(*),'Topic attempts intentionally use quizzes and topics'
 FROM public.quiz_attempts a LEFT JOIN public.quizzes q ON q.id=a.quiz_id LEFT JOIN public.topics t ON t.id=a.topic_id
 WHERE a.topic_id IS NOT NULL AND (q.id IS NULL OR t.id IS NULL OR q.topic_id IS DISTINCT FROM a.topic_id)
 UNION ALL
 SELECT 'duplicate active attempts per model',count(*),'Never delete student work to make a unique index succeed'
 FROM (SELECT user_id,quiz_id,(topic_id IS NULL) FROM public.quiz_attempts WHERE status='in-progress'
   GROUP BY user_id,quiz_id,(topic_id IS NULL) HAVING count(*)>1) d
 UNION ALL
 SELECT 'active teacher attempts without timing snapshot',count(*),'027 requires an exam-free migration window; do not fabricate fresh deadlines'
 FROM public.quiz_attempts WHERE topic_id IS NULL AND status='in-progress'
 AND (teacher_quiz_snapshot IS NULL OR jsonb_typeof(teacher_quiz_snapshot) IS DISTINCT FROM 'object'
   OR jsonb_typeof(teacher_question_state) IS DISTINCT FROM 'object')
 UNION ALL
 SELECT 'active topic attempts without question snapshot',count(*),'022; investigate without resetting the assessment'
 FROM public.quiz_attempts WHERE topic_id IS NOT NULL AND status='in-progress' AND topic_question_snapshot IS NULL
 UNION ALL
 SELECT 'completed attempts with impossible score bounds',count(*),'A bounded score alone does not prove correct grading'
 FROM public.quiz_attempts WHERE status='completed' AND (score IS NULL OR max_score IS NULL OR score<0 OR max_score<0 OR score>max_score)
 UNION ALL
 SELECT 'duplicate integrity event identities',count(*),'019; NULL IDs are legacy events, not invented duplicates'
 FROM (SELECT quiz_attempt_id,event_id FROM public.cheating_violations WHERE event_id IS NOT NULL GROUP BY quiz_attempt_id,event_id HAVING count(*)>1) d
 UNION ALL
 SELECT 'integrity events with missing attempt or mismatched student',count(*),'Persisted events are authoritative; review attribution'
 FROM public.cheating_violations v LEFT JOIN public.quiz_attempts a ON a.id=v.quiz_attempt_id WHERE a.id IS NULL OR v.student_id IS DISTINCT FROM a.user_id
 UNION ALL
 SELECT 'cached violation count differs from persisted events',count(*),'Investigate; do not overwrite event history with browser counters'
 FROM public.quiz_attempts a WHERE a.violation_count IS DISTINCT FROM (SELECT count(*)::integer FROM public.cheating_violations v WHERE v.quiz_attempt_id=a.id)
 UNION ALL
 SELECT 'feedback ownership/completion mismatch',count(*),'009; review historical rows, never bypass ownership'
 FROM public.student_feedback f LEFT JOIN public.quiz_attempts a ON a.id=f.attempt_id
 WHERE a.id IS NULL OR a.user_id IS DISTINCT FROM f.student_id OR a.status IS DISTINCT FROM 'completed' OR a.quiz_id IS DISTINCT FROM f.quiz_id
 UNION ALL
 SELECT 'organizations over seat capacity',count(*),'Every membership row, including owner/admin, consumes one seat'
 FROM public.organizations o WHERE (SELECT count(*) FROM public.organization_members m WHERE m.organization_id=o.id)>o.seat_limit
 UNION ALL
 SELECT 'organizations with invalid capacity',count(*),'Seat limit must be between 1 and 10000'
 FROM public.organizations WHERE seat_limit IS NULL OR seat_limit NOT BETWEEN 1 AND 10000
 UNION ALL
 SELECT 'memberships with missing organization or user',count(*),'Review institution boundaries'
 FROM public.organization_members m LEFT JOIN public.organizations o ON o.id=m.organization_id LEFT JOIN public.users u ON u.id=m.user_id WHERE o.id IS NULL OR u.id IS NULL
 UNION ALL
 SELECT 'duplicate organization memberships',count(*),'One seat per (organization,user)'
 FROM (SELECT organization_id,user_id FROM public.organization_members GROUP BY organization_id,user_id HAVING count(*)>1) d
 UNION ALL
 SELECT 'payment records with invalid state or amount',count(*),'No provider calls or entitlement changes are made by this report'
 FROM public.safepay_payments WHERE status IS NULL OR status NOT IN ('pending','paid','failed','cancelled') OR amount IS NULL OR amount<=0 OR (status='paid' AND paid_at IS NULL)
 UNION ALL
 SELECT 'payment records with missing owner or institution',count(*),'NULL organization_id is a supported legacy personal payment'
 FROM public.safepay_payments p LEFT JOIN public.users u ON u.id=p.user_id LEFT JOIN public.organizations o ON o.id=p.organization_id WHERE u.id IS NULL OR (p.organization_id IS NOT NULL AND o.id IS NULL)
)
SELECT check_name,CASE WHEN affected=0 THEN 'PASS' ELSE 'REVIEW' END AS status,affected,detail
FROM checks ORDER BY affected DESC,check_name;
COMMIT;
