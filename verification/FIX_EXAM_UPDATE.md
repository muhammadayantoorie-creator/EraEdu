# Teacher exam update repair

The Edit Exam form submitted `courseId`, but the update controller discarded it
and the service never wrote `course_id`. Selecting a different course could
report success while the exam remained linked to its original course.

The update endpoint now forwards and saves the selected course after checking
that it is assigned to the authenticated teacher. The write still filters by
both exam ID and current teacher ID. Migration 024's existing database trigger
protects a course reassignment racing this check. No new migration is needed.
An omitted course from an older client preserves the existing link; an explicit
empty selection is rejected. The response includes the saved course and original
access code. Missing/reassigned exams and concurrent assignment failures produce
clear errors instead of a generic save failure. This change does not update
student attempts, snapshots, grades or access codes.

## Verification

- Backend Jest: 377 tests in 40 suites passed, including regression tests for
  controller forwarding, course persistence, settings and short-answer retention,
  omitted/empty courses, lookup failures and ownership rejection.
- Backend TypeScript build passed.
- Frontend lint, type check and production build passed.
- The five existing disposable migration 024 cases passed. The added course-edit
  case also passed: an assigned course change succeeds, another teacher's course
  is rejected by PostgreSQL, and existing attempt rows remain unchanged.
- All eight local `verification/teacher-session-browser.mjs` cases passed using
  intercepted API responses: course/title/schedule survive save and reopen,
  mixed question types retain their data, and one click makes one write.

These are isolated automated checks. They do not prove a real teacher can write
to the deployed Supabase database; that requires a connected project and an
authorized signed-in acceptance test.
