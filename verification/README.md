# Product verification

The [database compatibility review](DATABASE_REVIEW.md) records the full migration
replay, backend-query/schema checks, confirmed repairs, and the live reconciliation
order for migrations 030/031. From backend, `npm run test:database` runs the
isolated database suites; CI now runs the same command on every main-branch push.
The standalone question form is checked with
`node verification/question-storage-browser.mjs` (or add `--live`), using the
separate Playwright setup and local preview described below.

For a database inventory and selective cleanup review, follow
[`DATABASE_CLEANUP.md`](DATABASE_CLEANUP.md). Its queries make no data changes.

For the error naming migration 027, follow
[`FIX_TEACHER_TIMING.md`](FIX_TEACHER_TIMING.md). It includes the read-only
preflight, the actual migration and the 27-check SQL verifier.

These are bounded smoke checks, not a complete authenticated release sign-off.
Run from the repository root. The live targets are EraEdu's existing Vercel API,
Vercel frontend and GitHub Pages frontend. Raw reports and public screenshots go
under ignored `backend/coverage/product-api` and `backend/coverage/product-browser`.
Never add real passwords, tokens, account screenshots or customer data to reports.

## Public API and asset checks

```powershell
node verification/product-api-checks.mjs --live
# Recheck only the catalog after a relevant deployment:
node verification/product-api-checks.mjs --live --catalog-only
```

This checks readiness, the published public catalog, 48 unauthenticated protected
GET routes, invalid session rejection, exact credentialed origins, malformed
public auth bodies, safe 404 responses, both frontend entry bundles and all face
model manifests/shards. Requests never supply a valid account/session. Invalid
POST bodies fail validation before account lookup, email or database writes.
Only aggregate public-course metadata is recorded; course codes/IDs are not
included in evidence.

An expected 401 proves the signed-out authentication boundary, not authorization
between logged-in users or successful business behavior behind that boundary.
An AI readiness flag proves configuration presence, not a successful AI response.

## Public browser checks

Use a separate tool installation of `playwright-core` and an installed Chrome.
It is intentionally not a production application dependency. Set
`PLAYWRIGHT_MODULE_PATH` to that installation's `playwright-core/index.mjs` if it
is not available through normal package resolution. Optionally set `CHROME_PATH`.

```powershell
node verification/product-browser-checks.mjs --live
# Focus a repeat on the tablet regression:
node verification/product-browser-checks.mjs --live --only=tablet
```

The script launches headless Chrome with fresh contexts. It tests desktop, mobile
and tablet navigation, client-side empty-login validation, registration role
fields, password-reset entry/error pages, public support/legal routes, signed-out
dashboard/exam redirects, not-found behavior and uncaught application exceptions.
It does not use personal browser profiles, submit registration/reset/payment
forms, request camera permission, or access authenticated accounts.

For account-backed registration/login, session persistence, teacher exam creation,
student submission, grading, monitoring, roles and payment sandbox behavior, use
isolated staging accounts and follow `STAGING_E2E_RUNBOOK.md`. This public smoke
suite does not replace those acceptance tests. The backend Jest and disposable
PostgreSQL suites are separate evidence, not live user-workflow results.

## Teacher create/edit session regression

For course-linked exam start failures, see [FIX_EXAM_COURSE_ACCESS.md](FIX_EXAM_COURSE_ACCESS.md).
The isolated browser checks use `node verification/student-exam-access-browser.mjs`
against the same local preview described below, or add `--live` for hosted bundles.
They exercise publication/enrollment refusals, completed submissions, allowed
preview and a refused start after access changes, without any live record writes.

From `frontend`, run `npm run test:session` to exercise the actual API client and
auth store with an in-memory adapter. Backend `teacherWriteSession.test.ts` uses
the real course/exam routers and signed fixture sessions with mocked data services.
It verifies teacher/admin access, student denial, and rejection before any write
when the displayed account differs from the authenticated account.

For the actual UI, build the frontend and serve it on `127.0.0.1:4173` using
`npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`. From the repository
root, with the same separate Playwright setup described above:

```powershell
node verification/teacher-session-browser.mjs
# After deployment, exercise both hosted bundles with intercepted API responses:
node verification/teacher-session-browser.mjs --live
```

These fixture tests cover course/exam creation and editing, successful saves,
account-change sign-in notices, account headers and single-write behavior. Every
API call is intercepted; no real signed-in account or database write is tested.
Evidence is stored under ignored `backend/coverage/teacher-session-browser`.

The edit-exam case changes the course, title and scheduled start, saves once,
then reopens the form to check those values. Its exam contains both multiple
choice and short-answer questions; both types and their existing answer data
must survive the update. The fixture server reflects the submitted data; real
controller/service persistence and course ownership are separately covered by
`teacherWriteSession.test.ts`, `quizUpdate.test.ts` and the disposable migration
024 checks. These checks do not certify a live teacher session.

The Vercel and Pages frontends share the API's browser session cookie. Signing
in as another user in the same browser profile can leave an older tab displaying
the previous account. Protected requests now include `X-EraEdu-Account`; the API
compares it with the verified session identity and rejects mismatches with
`SESSION_ACCOUNT_CHANGED`. This header cannot grant access. The frontend clears
its stale account, asks for a fresh sign-in and does not retry the mutation.

A genuine role denial returns `ROLE_FORBIDDEN` with the current role and required
roles. Teacher/admin course and exam create/edit permissions remain unchanged.
No database migration or role promotion is required for this repair. Use separate
browser profiles when testing teacher and student accounts simultaneously.
This reproduced session issue is not proof of the cause in any particular user's
uninspected live session.
