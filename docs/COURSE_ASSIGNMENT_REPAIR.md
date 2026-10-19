# Fix the Courses “assignment setup is incomplete” error

The Courses page raises the screenshot's message when `SELECT * FROM courses`
does not return `organization_id`. Migration 024 supplies this column and the
assignment audit/functions. A code push or a healthy `/health` response does not
apply database migrations.

## Run manually

1. Open the Supabase project used by the affected backend, then **SQL Editor → New query**.
2. Copy the **entire** contents of `backend/migrations/024_assign_courses_to_teachers.sql`, paste them into the editor, and click **Run**. Run the whole file together, including `BEGIN` and `COMMIT`.
3. In a new query, run the entire `backend/scripts/verify-course-assignment.sql`. All 12 checks should say `PASS`.
4. Refresh EraEdu's admin Courses page. Existing courses without an institution should load with a null organization; use **Assign** to select an institution and its registered teacher. The migration does not guess institutions or automatically reassign courses.

If a statement fails, run `ROLLBACK;` in the failed SQL session. Resolve the
reported prerequisite before rerunning the entire migration. Required base
tables include `users`, `courses`, `teacher_quizzes`, `quiz_codes`,
`organizations`, and `organization_members`; prerequisite migrations are
006, 012, 015, 016, and account-status migration 008/029 as applicable.
Do not run a database reset/bootstrap to repair an existing project.

The migration is repeatable. It adds the missing schema, retains existing
owners and assessment author/history, restricts assignment functions to the
server role, and requests a PostgREST schema-cache reload at commit. The new
transaction rolls all changes back together if a prerequisite is missing or a
statement fails. Retain the additive schema if rolling back application code;
do not drop assignment/audit history to undo this repair.

## Verification

The focused Jest cases reproduce the missing-column screenshot and verify
that existing courses with `organization_id: null` load normally. The isolated
PostgreSQL script `backend/scripts/verify-course-assignment.mjs` executes the
actual migration and checks repeatability, all 12 read-only checks, manager
reassignment with preserved history, idempotent audit behavior,
cross-institution denial, audit rollback, and rollback on missing prerequisites.
It uses a disposable in-memory database and never connects to Supabase.

For an existing isolated PGlite installation, set `PGLITE_MODULE_PATH` to its
`dist/index.js` and run `node --test backend/scripts/verify-course-assignment.mjs`.
Actual production schema state and authenticated Courses behavior remain
unverified until the operator runs the SQL and refreshes the app.

Local results for this repair: all 5 isolated PostgreSQL tests passed, all 15
course-assignment Jest tests passed, and the backend TypeScript build passed.
