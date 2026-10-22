# Code exam course access

The repeated "Ask your teacher to publish this exam's course" error came from
coupling private code exams to the course's public catalog publication setting.
Publishing individual affected courses temporarily restored access, but left
other enrolled students exposed to the same failure on the next draft course.

Code exams now require membership in their exact linked course independently of
catalog publication. The preview API and the atomic database start function use
the same policy. Students can preview, start and resume an exam on an unpublished
course without making that course public. Missing courses and missing enrollment
still fail. Lookup errors remain retryable HTTP 503 responses. Changing an exam's
course does not transfer enrollment.

The database continues to enforce active exams, scheduled start, student role,
suspension, one completed submission, a single active attempt, immutable exam
snapshots, and server deadlines. The start RPC remains executable only by the
service role. Public catalog and topic-content publication policies are unchanged.
The repair does not update courses, enrollments, schedules, questions or grades.

## Release

1. Apply `backend/migrations/034_code_exam_course_access.sql` to the target database
   after migration 027 and the target's other pending migrations. It replaces only
   `start_teacher_attempt`, preserves service-only permissions and refreshes the
   PostgREST schema cache. Applying it again is safe.
2. Deploy the backend containing the updated `quizCodeService.ts` and
   `quizService.ts`. Both the migration and backend change are required: changing
   preview alone would leave the old database refusal in place.
3. With an enrolled disposable student, enter a valid active exam's 4-digit code
   while its course is unpublished. Verify preview, start, refresh/resume and
   submit. An unenrolled student must remain denied. Do not change an existing
   exam's schedule or delete a completed submission to test this.

Enrollment is still required. A student who has not joined the course should use
its separate 6-character course code from My Courses before entering the exam
code. Publication remains relevant to accessing the course's learning content.

## Verification

Local validation on 23 October 2026 passed: all 404 backend tests in 42 suites,
all 74 disposable PostgreSQL checks, the backend TypeScript build, and browser
fixture script syntax validation. The live rollout below is now complete.

## Live rollout: 23 October 2026 (Pakistan time)

The backend was deployed from [commit c451d7d](https://github.com/muhammadayantoorie-creator/EraEdu/commit/c451d7d0ae60228cec14c96519dd58a5212613b4).
The [release CI](https://github.com/muhammadayantoorie-creator/EraEdu/actions/runs/39840474800)
passed all 404 backend tests, all 67 database checks included in that commit,
and the backend build. The 74-check local total above also includes seven
pre-existing local migration checks that were kept outside this scoped release.
The [Vercel backend deployment](https://vercel.com/muhammadayantoorie-2147s-projects/era-edu/7s8yhdZhRvcsxQserqszWP8K8yLw)
succeeded; `/health` returned HTTP 200 with database readiness `ok`.

Supabase migration `code_exam_course_access` was applied and recorded as version
`20261022193019` (00:30:19 Pakistan time on 23 October). Before applying it, the
live start function matched the reviewed original migration 027. A separate
post-commit query confirmed the new function matches migration 034, requires
enrollment, and does not require course publication. Its security-definer setting,
fixed search path and service-only execution permissions remain intact.

Seven live database checks passed using new fixture records inside one transaction
executed as `service_role`: starting on an unpublished course, resuming the same
attempt, denying an unenrolled student, leaving the course unpublished, creating
only one attempt, answering/submitting/grading, and refusing a completed restart.
The transaction was rolled back. An independent read confirmed zero fixture
users, courses or exams remained. No existing student accounts, courses, schedules,
questions, enrollments or submissions were edited for this rollout.

All 70 public API/asset checks also passed after deployment. These cover readiness,
published-only public catalog visibility, signed-out protections, origins,
validation and hosted assets. The rollback-only RPC checks are live database
evidence; a real student's signed-in browser workflow was not exercised.

From `backend`, run:

```powershell
npm.cmd test -- --runInBand
npm.cmd run test:database
npm.cmd run build
```

`quizCodeAccess.test.ts` exercises the actual preview controller/service with
isolated data: true, false and null publication states; enrolled and unenrolled
students; course reassignment; missing courses; dependency failures; completed
submissions; hidden answer keys; and a refused atomic start after access changes.

`verify-teacher-deadlines.mjs` executes migrations 027/034 against disposable
PostgreSQL. It checks start/resume across publication states, membership removal,
unpublishing during an attempt, submission, deadlines, role/permission boundaries,
and repeat application without publishing courses or changing attempt identity.
The complete migration chain is also exercised by `verify-runtime-schema.mjs`.

`student-exam-access-browser.mjs` uses intercepted API responses to check the
join form's allowed draft-course preview, enrollment instructions, completed
submission and persistent refusal after access changes. Browser fixtures and
local database tests do not establish deployment or a real signed-in live start.
