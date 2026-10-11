-- Read-only report. Review each row; never delete attempts to make it empty.
SELECT a.id AS attempt_id, a.quiz_id, a.topic_id, 'missing_student' AS issue
FROM public.quiz_attempts a LEFT JOIN public.users u ON u.id = a.user_id
WHERE u.id IS NULL
UNION ALL
SELECT a.id, a.quiz_id, a.topic_id, 'missing_teacher_exam'
FROM public.quiz_attempts a LEFT JOIN public.teacher_quizzes q ON q.id = a.quiz_id
WHERE a.topic_id IS NULL AND q.id IS NULL
UNION ALL
SELECT a.id, a.quiz_id, a.topic_id, 'missing_topic_exam'
FROM public.quiz_attempts a LEFT JOIN public.quizzes q ON q.id = a.quiz_id
WHERE a.topic_id IS NOT NULL AND q.id IS NULL
UNION ALL
SELECT a.id, a.quiz_id, a.topic_id, 'missing_topic'
FROM public.quiz_attempts a LEFT JOIN public.topics t ON t.id = a.topic_id
WHERE a.topic_id IS NOT NULL AND t.id IS NULL
UNION ALL
SELECT a.id, a.quiz_id, a.topic_id, 'exam_topic_mismatch'
FROM public.quiz_attempts a JOIN public.quizzes q ON q.id = a.quiz_id
WHERE a.topic_id IS NOT NULL AND q.topic_id IS DISTINCT FROM a.topic_id
UNION ALL
SELECT a.id, a.quiz_id, a.topic_id, 'missing_course'
FROM public.quiz_attempts a JOIN public.teacher_quizzes q ON q.id = a.quiz_id
LEFT JOIN public.courses c ON c.id = q.course_id
WHERE a.topic_id IS NULL AND q.course_id IS NOT NULL AND c.id IS NULL
UNION ALL
SELECT a.id, a.quiz_id, a.topic_id, 'missing_course'
FROM public.quiz_attempts a JOIN public.topics t ON t.id = a.topic_id
LEFT JOIN public.courses c ON c.id = t.course_id
WHERE a.topic_id IS NOT NULL AND t.course_id IS NOT NULL AND c.id IS NULL
ORDER BY attempt_id, issue;
