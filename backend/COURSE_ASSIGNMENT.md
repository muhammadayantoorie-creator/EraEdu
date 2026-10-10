# Course assignment (BUG-008)

`courses.created_by` is the current course manager. A teacher sees and manages
courses whose `created_by` matches their user ID. `courses.organization_id`
fixes the institution boundary at first admin assignment; later assignments
must select another active, registered teacher in that same organization.
Platform admins have global oversight through admin-only routes. This does not
create an institution approval role or change a user's account role.

Course-linked `teacher_quizzes.teacher_id` is also the current manager. The
assignment transaction updates it alongside the course so the new teacher can
review and grade existing exams, while the former manager loses that access.
`teacher_quizzes.original_teacher_id` is immutable author attribution for
existing and future exams. `cheating_violations.teacher_id` remains the manager
at event time; authorization for violation summaries follows the current exam
manager. The assignment audit records actor, institution, previous manager,
new manager, and time. Course, topic, question, enrollment, code, exam, and
attempt IDs are preserved; question `created_by` remains original authorship.

## Deployment

Apply earlier schema migrations, including organization membership (012),
course code (015), and capacity (006 and 023), then apply
`migrations/024_assign_courses_to_teachers.sql` before deploying the API/UI.
Use the backend Supabase service-role key. The migration adds nullable fields,
backfills exam authorship, and installs service-only transactional assignment
functions. No live migration was applied during development.

For a safe rollback, stop new assignments by reverting the API/UI while
retaining the additive columns, audit records, and current owner values.
Do not drop the audit or overwrite `created_by`/`teacher_id`: that would lose
provenance or undo course management. If database objects must be removed,
take a backup and coordinate a separate, reviewed migration after confirming
there are no assigned courses depending on them.

## Isolated acceptance check

Use one test organization, two registered teacher members, an admin, and a
student. Create or assign a course to teacher A, add topic/question/exam and
a student attempt, then reassign to teacher B. Teacher B should see/manage
the same course and exam IDs; teacher A and an unrelated teacher should be
denied. The attempt and enrollment remain linked to the same course/exam.
Try a teacher from a different organization, a suspended teacher, and a
second institution for an already-bound course: each must fail. Review the
`course_assignment_audit` row and `original_teacher_id`. Use isolated data,
not production accounts or report credentials.
