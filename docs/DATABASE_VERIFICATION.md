# Database verification — 2026-10-16

**Live database status: not independently verified.** The user reports successfully
running migrations 029, 006 and 023, and supplied a screenshot showing zero duplicate
enrollment groups. This is useful evidence for those operations, not confirmation
that every migration, policy or application workflow is correct. No live database
credentials/project connection or usable staging URLs were provided to this audit.

## Run the safe reports, not all migrations blindly

1. Confirm the Supabase project is the one referenced by the deployed **backend**.
   Check that match privately in deployment configuration; never share service keys.
2. In its SQL Editor, as the authorized database administrator, run the entire
   `backend/scripts/audit_database_readonly.sql`. It opens a read-only transaction
   and returns one table of checks. Export the full result as CSV. It reads catalog
   metadata, not user rows, credentials or answer keys; it does not call app RPCs.
   A query error or timeout is a failed diagnostic, not a healthy result. If your
   editor retains a failed transaction, use `ROLLBACK;` before retrying.
3. Review `BLOCKED` and `REVIEW` rows before any repair. Run
   `backend/scripts/audit_database_data_readonly.sql` only after the required
   tables/columns/types are confirmed. It returns aggregate counts, not individual
   names, email addresses, account IDs, tokens, answers or payment tracker values.
   Run as the database administrator, not a restricted app role whose RLS-filtered
   rows might create misleading zero counts. The 30-second timeout bounds each
   report; large datasets should be checked off-peak or on an appropriate replica.
4. Share the two result tables for diagnosis. Do not share `.env` files, passwords,
   access keys, table exports, or screenshots of private user data.

For these reports, unlike a migration, **“Success. No rows returned” is not the
expected complete evidence**: the SELECT must produce a result table. Select the
result tab for the SELECT if the editor shows a final COMMIT command result.

### Status meanings

- `PASS`: only that named property/count passes the check.
- `BLOCKED`: a required object/contract/grant differs or cannot be checked.
- `REVIEW`: inspect the listed definition/policy/data inconsistency. This is not
  automatically a confirmed defect; renamed equivalent constraints/indexes and
  intentional legacy `NOT VALID` constraints require an informed decision.
- `NOT_TESTED`: checks requiring the deployed API, browser, independent database
  sessions, payment sandbox, or backup/restore evidence remain outstanding.

## Coverage and limits

The schema report inventories required columns across accounts, courses, topics,
bank questions, both exam models, attempts, events, feedback, notifications,
organizations, memberships, payments and governance/assignment audit tables.
It checks key types/defaults/nullability, generated references, expected unique
indexes, history constraints, assignment/trial triggers, RPC signatures/security
mode/search path, browser and service-role RPC grants, table/column-level browser
grants, RLS flags and existing policies/FKs. It does not execute RPCs or certify
their bodies. Policies, constraint definitions, partial-index predicates and
trigger events intentionally require review rather than an automatic green label.
This is a curated contract inventory, not an exhaustive catalog of every possible
application query, storage bucket, Supabase setting or SQL object.

The data report checks unknown roles/status, duplicate emails/enrollments/memberships,
course/team capacity, broken enrollment/topic/question/exam/attempt references,
assessment ownership, duplicate active attempts, missing active snapshots, score
bounds, event identities/attribution/cached counts, feedback ownership/completion,
and payment state/reference consistency. An inactive historical course/exam is
not an orphan merely because it is unavailable for new attempts. Passing score
bounds does not prove correct grading; a paid marker does not prove provider
verification. These require behavioral tests.

## Repository risks to check in the actual database

These are **code/schema-template observations**, not confirmed deployed findings:

- Legacy `create-all-tables.sql` is development-only and contains permissive
  grants/RLS setup. Do not rerun it on production to fill gaps.
- Migration 001 defines a broad authenticated teacher-exam SELECT policy.
  Assess effective grants plus policies, including question/answer-key exposure;
  an enabled RLS checkbox by itself does not prove safety.
- Legacy bootstrap/schema scripts can leave `quiz_codes.quiz_id` referencing
  topic `quizzes` while current teacher-code workflows use `teacher_quizzes`.
  Inspect the FK inventory and actual code-generation lifecycle before proposing
  a non-destructive relationship migration. Do not blindly drop the FK.
- `ADD COLUMN IF NOT EXISTS` does not repair an existing column's wrong type,
  nullability or default. Function/index names alone do not prove correct bodies,
  key columns or predicates. Migration presence must be reconciled, not inferred
  from the highest numbered SQL file someone ran.

## Repair rules

Back up and test restore first; rehearse the specific repair in isolated staging.
Record migration file checksums, prerequisites, before/after results and rollback
owner. Do not delete historical data, reset roles/suspensions, invent deadlines,
discard required security fields, or disable access checks to clear a warning.
Migration 025 requires reviewed historical references; 027 requires an exam-free
window and explicitly refuses to invent timers for already-active teacher exams.
Do not rerun all 001–029 on a live database without reviewing these prerequisites.
Constraints/indexes missing under an expected name may have equivalent alternatives;
inspect definitions before creating duplicate or conflicting objects.

## Remaining acceptance evidence

Use `STAGING_E2E_RUNBOOK.md` with isolated admin/teachers/students and record the
deployed commit, API/frontend origins and reconciled schema through 029. Verify
register/sign-in/refresh/current-role suspension; course allocation/material/bank
question/exam/enrollment; timed shuffled 1/3 grading; permitted review/results;
event retries/feedback; course and organization last-seat races; concurrent
start/submit/report; sandbox cancel/success/webhook retries; and backup/restore.
No real charges or production test-user mutations are authorized by these reports.

Full readiness also requires deployment cookie/CORS/CSRF and object authorization,
PostgREST cache/API connectivity, storage access, safe logging, monitoring, restore
and paired API/schema rollback. A public health response or passing SQL inventory
alone cannot certify the entire database.

## Local verification (diagnostics only)

Run `node --test backend/scripts/verify-database-audit.mjs` using disposable
PGlite 0.5.10 (`PGLITE_MODULE_PATH` may point to its `dist/index.js`). The test
uses only in-memory PostgreSQL, isolated fixture rows and repository SQL files.
It deliberately tests missing schema/roles, repaired vs drifted account defaults,
real capacity objects vs wrong keys/public RPC grants, column-level snapshot
exposure, and count-only data anomalies without changing fixture records.
No Supabase URL, key or live database directory is accepted.

Initial verification found a catalog `char` concatenation ambiguity in the new
report. Adding an explicit text cast fixed it; the subsequent run passed all five
diagnostic tests. This was a report-development failure, not a deployed database
finding. The final 2026-10-16 run passed **19/19 isolated SQL tests**: five
diagnostic tests, three account-status migration tests, and eleven teacher
deadline/grading/event tests. Command:

```powershell
$env:PGLITE_MODULE_PATH = 'D:/EraEdu-verification-20261014/sql-tools/node_modules/@electric-sql/pglite/dist/index.js'
node --test --test-concurrency=1 backend/scripts/verify-database-audit.mjs backend/scripts/verify-account-status.mjs backend/scripts/verify-teacher-deadlines.mjs
```

`git diff --check` passed. Application builds/Jest were not rerun for this
SQL-diagnostic/documentation-only change; the prior working-tree results remain
separate evidence. These 19 tests do not run the entire migration chain or real
multi-connection races and do not connect to the deployed database.

No product code, migrations or production data are changed by this audit work.
Earlier unfinished exam/result changes are left untouched and are not included
in publication of these diagnostic files.
