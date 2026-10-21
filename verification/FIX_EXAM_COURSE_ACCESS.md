# Exam course-access checks

`start_teacher_attempt` in migration 027 rejects a course-linked exam start
unless the linked course exists, is published, and the authenticated student is
enrolled in that exact course. The screenshot's message comes from this guard.
It does not identify which prerequisite failed in the live database.

Previously, code preview checked enrollment but ignored course publication and
ignored errors from its enrollment/course lookups. An enrolled student could see
"Exam Found", acknowledge the rules, and then hit the generic course-access
error at Start.

Preview now verifies publication before offering Start and returns actionable
instructions. Enrollment is still checked before exam details are returned.
Lookup failures are retryable HTTP 503 responses, rather than fabricated access
or enrollment states. Completed submissions remain visible to enrolled students
after unpublishing. The atomic start guard remains authoritative if enrollment
or publication changes after preview; its refusal now explains both required
conditions. The join screen keeps errors visible after the toast disappears,
including errors raised after preview.

No migration, automatic publishing, automatic enrollment, or record deletion is
part of this repair. Changing an exam's selected course does not transfer student
enrollments from the previous course.

## Restore access in the application

1. As the assigned teacher, confirm the exam's selected course in Edit Exam.
2. Open Courses, edit that exact course, enable Published course, and save.
3. Share that course's 6-character course code with the intended students.
4. Each student opens My Courses, chooses Join Course and enters that course
   code. Enrollment in a different course does not grant access to this exam.
5. The student then uses the exam's separate 4-digit code in Join Exam.

Publish only courses intended to be available to students. An actual missing
course or failed lookup requires inspection; do not recreate/delete historical
records or bypass the start guard to suppress the message.

## Verification

Local validation passed: 387 backend tests in 41 suites, backend TypeScript
build, frontend lint/type check/production build, all 26 disposable timing SQL
cases and all five browser fixture scenarios. These results do not establish the
live course's publication or student enrollment state.

`quizCodeAccess.test.ts` exercises the real preview controller/service with
isolated data fixtures: unpublished and unknown publication states, missing
enrollment, changed course, lookup failures, missing course, allowed preview,
completed-submission review and an access change racing atomic start. It checks
that preview returns no question/answer keys and never writes records.

`verify-teacher-deadlines.mjs` executes the shipped SQL in disposable PostgreSQL,
including rejection of unenrolled students and unpublished/missing courses.
`student-exam-access-browser.mjs` tests the actual join form with intercepted API
responses. It covers publication/enrollment instructions, allowed preview,
completed submissions and persistent errors after a refused start. Run it against
a built frontend served at `127.0.0.1:4173`, or use `--live` for the hosted bundles.
All API calls are intercepted in the browser suite; a successful fixture run is
not a real signed-in save/start against the deployed database.
