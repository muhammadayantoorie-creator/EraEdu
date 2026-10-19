# Student Submissions loading repair

The reported page displayed a hardcoded generic message for every failed
`GET /api/quizzes/teacher/submissions` response. The screenshot alone does not
identify which query failed in the deployed database. Two failure mechanisms
were reproduced from the source and repaired without modifying production data.

## Reproduced failures

1. The batch monitoring reader explicitly selected `event_id`. Existing
   monitoring tables can predate migration 019, so PostgreSQL rejects the entire
   query when that column is absent, even though historic events are readable.
   This made completed submissions fail with HTTP 503. The single-attempt
   monitoring reader already selected available fields and did not have this
   read-time dependency.
2. A nullable legacy `quiz_attempts.user_id` was included in the users `IN`
   filter. A literal `null` is not a valid UUID, so one such attempt could cause
   the student lookup and the whole submission list to fail.

The regression cases failed before the change (including the HTTP list case).
Disposable PostgreSQL tests also reproduced the missing-column projection and
invalid UUID behavior using real SQL.

## Changes

- The batch review reader now selects the available monitoring columns, matching
  the existing single-attempt reader. Current schemas retain event IDs; legacy
  schemas retain the actual event rows, details, severities, methods and counts.
  Only whitelisted normalized event fields are returned by the API. The lookup
  remains scoped to attempts for the authenticated teacher's exams.
- Empty student references are excluded from UUID queries. The attempt remains
  visible with its existing `Unknown` identity fallback. An actual failed users
  query remains an error.
- Monitoring query errors or invalid/non-array responses return a safe retryable
  503. They are never converted into an empty list or a zero violation count.
- New monitoring writes still require stable event IDs and the appropriate
  migration/RPCs. Read compatibility does not drop write fields or weaken
  report deduplication, timing, ownership, or result-release rules.
- The page displays the API's operational error explanation with a retry action.
  SQL `NULL` and absent grades now show Pending; a reviewed numeric zero stays
  Graded. The Pending badge/filter use that same decision.
- Review details have an explicit loading state. Failed/loading monitoring
  reads show unavailable/loading rather than zero; Save Grade waits for valid
  review data. Closing/switching reviews invalidates stale responses.

No database migration or production record update is required for these read
compatibility changes. They do not replace applying the existing migration
sequence for reliable writes and exam timing. Genuine missing tables, permission
failures, connectivity problems, or other schema gaps still require diagnosis.

## Checks and remaining acceptance

Local results: all 312 backend tests across 36 suites passed. Backend build,
frontend lint/typecheck/build, all four client submission-state tests, and both
isolated PostgreSQL tests passed. Existing frontend build warnings concern the
face-detection bundle size, browser-externalized modules and stale Browserslist.

- Ten focused backend tests cover legacy and current event schemas, null student
  references, teacher/attempt isolation, actual dependency errors, safe HTTP
  errors, and the unchanged write migration requirement.
- Four client tests cover pending/zero grades, malformed grades, operational
  error messages and safe fallback handling. CI runs `npm run test:submissions`.
- Two in-memory PostgreSQL tests use no live database, accounts, or credentials.
  Run `backend/scripts/verify-legacy-submission-reads.mjs` with an isolated
  PGlite installation via `PGLITE_MODULE_PATH`.

An authenticated reproduction of this user's deployed request is unavailable:
no request response or isolated account was supplied, and the browser connector
failed to initialize earlier in this session. After deployment, hard-refresh
Student Submissions, check All/Pending/Graded including a zero grade, open a
completed review and verify its actual monitoring records. Confirm an actual
request failure stays visible and cannot save a grade with unloaded review data.
No claim that the original deployed failure is resolved is made solely from
local tests or the database health endpoint.
