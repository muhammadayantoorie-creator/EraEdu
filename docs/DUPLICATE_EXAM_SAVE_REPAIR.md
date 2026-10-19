# Duplicate exams after one save

The reported My Exams screenshot showed three matching short-answer exams
with distinct access codes. The teacher confirmed that one save created
duplicates. Source inspection confirmed that the form allowed another submit
while its first request was pending, and each POST generated a new exam/code.
The API also awaited student notification after committing the exam: a thrown
notification error could make an already successful save look unsuccessful.

## Repair

- Both MCQ and short-answer creates use the same synchronous submission guard.
  The form, mode controls, and Cancel are disabled while saving; the submit
  button shows `Saving…`. The guard also prevents double Enter/click events
  before React has rendered the disabled state. Updates receive the same
  protection against simultaneous writes.
- Each create draft sends an `Idempotency-Key` UUID. A failed/lost response
  retains that key for the unchanged draft. Editing the draft or explicitly
  opening a new form creates a new operation, so intentional identical exams
  remain supported.
- The API derives a stable UUID from the authenticated teacher and request
  key and inserts it into the existing exam `id` primary key. A repeated
  operation returns its saved exam and access code; a competing insert recovers
  the winner. The lookup also checks current teacher ownership. Missing/invalid
  keys are handled separately: malformed keys are rejected, while legacy
  clients without a key keep their existing creation behavior.
- A save operation key identifies one immutable create operation. API clients
  must use a new key for a new/changed create; the browser handles this. Replays
  return the existing record, including any later edits to that record.
- The API uses a normal INSERT, so duplicate-primary-key errors roll back
  trial-counter changes made by BEFORE INSERT triggers. It also recovers a
  concurrent completed save when the free-trial check now reports no slots.
  Notifications run only for a newly inserted record. Their failure no longer
  converts that committed creation into a failed save.

No SQL migration is needed. The repair uses the existing primary key and
retains existing courses, exams, access codes, quotas, and attempt history.
Existing duplicate records are not automatically identified or deleted:
matching titles/content can be intentional, and an access code may already
have student attempts. Review those records before deleting any unused copy.

## Verification

Local results: all 302 backend tests across 35 suites passed; backend build,
frontend lint/typecheck/build, all 5 client save tests, and both PostgreSQL
uniqueness/trial tests passed. Existing frontend warnings concern the large
face-detection bundle, browser-externalized modules, and stale Browserslist data.

- Ten focused backend cases cover repeat/retry, simultaneous requests,
  notification failure, response loss, quota races, intentional new exams,
  teacher isolation, malformed keys, MCQ/short-answer creation, and HTTP header
  forwarding.
- Five client tests cover rapid clicks/Enter, lost responses, changed/reopened
  drafts, both question modes, and edit write protection. CI runs them with
  `npm run test:exam-save`.
- Two disposable PostgreSQL tests execute the existing migration 018 trial
  trigger and confirm one exam/counter increment after duplicate attempts for
  both independent teachers and institution members, including the final
  free-trial boundary. Run `backend/scripts/verify-exam-create-uniqueness.mjs`
  with an isolated PGlite installation via `PGLITE_MODULE_PATH`. These tests
  use no live database, accounts, or credentials.

The browser connector could not initialize (`sandboxPolicy` was missing), so
authenticated browser acceptance remains unverified. To check after deployment,
hard-refresh My Exams, create an isolated MCQ exam and a short-answer exam,
and rapidly click Save/press Enter while the request is pending. Each operation
should add exactly one row/code. Retry an unchanged draft after a lost response
and confirm the same row/code. Explicitly create a new draft with the same title
and confirm it is allowed. No production exams were deleted during this repair.
