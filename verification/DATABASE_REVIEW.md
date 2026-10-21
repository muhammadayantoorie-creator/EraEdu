# Database compatibility review — 2026-10-21

The repository review covers 18 application tables, the migration chain through
031, and 56 backend runtime files. The new full-schema check compares 750 literal
column uses and four embedded relationships with a disposable PostgreSQL catalog.
Ten dynamic query/write sites were also reviewed: admin lookup/count helpers,
analytics and activity readers, profile updates, question updates, notifications
and conditional exam settings. Static coverage does not prove every dynamic
query or every value stored in the live database. Supabase project tools are not
available in this session, so the live schema, data and applied migration bodies
remain unverified.

## Confirmed mismatches and repairs

- The standalone question form submitted option text while `correct_answer`
  is an integer. It now sends the index; the API also normalizes older text
  submissions and retains index zero on create/edit.
- Question creation wrote `hint`, absent from the documented schema. It now
  writes `explanation`. Hint reads use that canonical field and can retain an
  optional legacy hint value without requiring a new duplicate column.
- Admin integrity events requested a PostgREST relationship from a polymorphic
  event quiz ID to teacher exams. That FK does not exist. Bounded batch lookups
  now resolve both teacher and topic exams, students, attempts and courses.
- The startup check selected a nonexistent `users.count` column. It now checks
  `users.id` and reports success only when the query succeeds.
- The bootstrap defined `quiz_codes` twice. Its first topic-exam FK survived
  `IF NOT EXISTS`, conflicting with the current teacher-code API. Migration 030
  repairs the FK only when every non-null code reference already identifies a
  teacher exam; otherwise it rolls back without deleting or relinking records.
- Migration 031 enforces the current architecture: Express owns authentication
  and uses `SUPABASE_SERVICE_KEY`; browser roles have no direct application-table
  access. It enables RLS, removes table/column browser grants, and preserves
  service-role CRUD, existing policies, provider schemas and custom tables.
  Unexpected inherited grants cause rollback, rather than changes to other roles.

The backend's eight reported production dependency vulnerabilities were resolved
with compatible updates. The production-only audit returned zero. Development
tool dependency advisories remain outside this production dependency result.

## Verification and regression prevention

Local validation passed: 401 backend tests, 60 database regression cases (the
full suite plus the added repeat-030 case), backend TypeScript, frontend lint/
type check/build, and three actual question-form browser fixture cases.

`npm run test:database` in backend now runs the isolated database suites in CI.
It replays the migrations together, checks query/schema contracts and audits,
then exercises assignment → publication → enrollment → exam/code → immutable
submission → reassignment as the service role. Tests also cover historical-data
retention, repeat application, failure rollback, browser privilege denial,
unexpected inherited grants and protected deletions.

Validation also includes backend Jest and TypeScript, frontend lint/type check/
build, and `question-storage-browser.mjs` against the actual form with intercepted
API responses. Browser fixtures never write live records. PGlite is in-memory
and single-connection; real lock contention, provider/storage behavior and a real
signed-in teacher/student workflow still require staging acceptance tests.

## Complete the live review

1. Confirm the backend points to the intended project and its
   `SUPABASE_SERVICE_KEY` is the server service-role key. Do not expose that key
   through frontend variables or chat. Retain a current backup/restore path.
2. Run [preflight-runtime-reconciliation.sql](../backend/scripts/preflight-runtime-reconciliation.sql)
   in that project's SQL Editor. Both rows must report PASS. If legacy codes
   block 030, review them; do not delete them to force a pass.
3. Run [030_reconcile_quiz_code_reference.sql](../backend/migrations/030_reconcile_quiz_code_reference.sql),
   then [031_enforce_api_database_boundary.sql](../backend/migrations/031_enforce_api_database_boundary.sql).
   These use transactions and bounded locks/timeouts. A failure is a rollback,
   not an instruction to remove the guard or reset the database. Do not rerun
   the entire historical migration chain on a populated project.
4. Run [audit_database_readonly.sql](../backend/scripts/audit_database_readonly.sql).
   Resolve BLOCKED rows before running the aggregate data audit. REVIEW rows
   require interpretation, including legacy NOT VALID constraints; never blindly
   validate constraints or classify all review rows as errors.
5. Run [audit_database_data_readonly.sql](../backend/scripts/audit_database_data_readonly.sql)
   and optionally the object inventory. These return metadata/counts, not private
   record contents. Draft courses, old attempts and missing references are review
   candidates, not automatic deletion or publication targets.
   The audit also flags MCQs with missing/out-of-range correct answers. The old
   zero-index bug may have affected historical bank rows; the intended answer
   must be confirmed by the author, never guessed or used to regrade snapshots.
6. Verify real sign-in/roles, assigned-course publication, course enrollment,
   exam create/edit/start/save/resume/submit, grading/results and monitoring in
   isolated staging accounts. Confirm API health after permission changes.

No live data was removed and neither migration was applied to the live project
by this review. Until the live audit and acceptance tests pass, this report is
evidence of repository compatibility, not certification of the production data.
