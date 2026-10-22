# EraEdu live database review — 21 October 2026

Historical snapshot from 21 October. The publication requirement described here
was superseded by migration 034 on 23 October: enrolled students can now
join code exams independently of course publication. See the
[current exam access rollout](FIX_EXAM_COURSE_ACCESS.md).

A later screenshot showed a separate exam code. See the
[second exam publication follow-up](COURSE_PUBLICATION_REPAIR_2026-10-21.md) for the targeted
live repair and the independently verified scheduling limit. The counts below
describe the earlier full-database review snapshot.

The active Supabase project **EraEduation** was inspected and repaired through
its authenticated connection. The known application schema/security audit now
has **zero BLOCKED checks**, compared with 94 initially. The publication error
for the first reviewed exam was resolved by publishing its exact linked course. This is a
verified repair of those database conditions, not a claim that every workflow
or historical record is perfect.

## Applied changes

The user approved the ten migrations in
[the repair plan](LIVE_DATABASE_REPAIR_PLAN.md), and all ten were recorded in
the live migration ledger. The historical chain was not replayed wholesale.

- Added the missing feedback and administrator audit tables, topic-attempt
  snapshots/index, and four required application functions.
- Added missing `auto_submitted` and `submission_reason` fields through
  [migration 032](../backend/migrations/032_reconcile_attempt_submission_fields.sql).
  The existing finalizer already referenced these absent fields. All ten legacy
  attempts retain NULL provenance rather than invented submission reasons;
  future attempts receive the normal false default.
- Installed history-preserving teacher/topic references and restrictive delete
  rules. Existing orphaned work was retained using NOT VALID constraints.
- Corrected the quiz-code FK to reference teacher exams after the live preflight
  passed. The code table was empty; no codes were removed or relinked.
- Protected all 18 application tables with RLS and removed direct browser
  table/column grants while retaining service-role CRUD.
- The first post-repair audit found two remaining failures: explicit Supabase
  default grants let browser roles invoke the organization-seat function despite
  migration 021's PUBLIC-only revoke. The tested
  [migration 033](../backend/migrations/033_protect_organization_seat_rpc.sql)
  removed those exact grants while preserving service execution and the function
  body. The live ledger now records eleven applied repairs.
- Published only the course linked to the first reviewed exam. It has one active enrolled
  student and is shared by two teacher exams. Publication affects both exams'
  normal eligibility. It did not transfer enrollment or publish other drafts.
- Cleared one password-reset challenge and one student OTP challenge confirmed
  expired more than 24 hours earlier. The transaction rechecked expiry/count
  predicates, changed only challenge fields on two accounts, and returned counts.
  Account passwords, active challenges, roles and suspension states were not
  changed by this cleanup.

The first reviewed exam retains its existing scheduled start of **21 October 2026 at 22:36
Pakistan time** (17:36 UTC), its one-minute duration and its one question. The
publication repair does not open it before that scheduled start.

## Verification

| Check | Result | Meaning and limits |
| --- | --- | --- |
| Live schema/security audit | 390 PASS, 73 REVIEW, 0 BLOCKED, 1 NOT_TESTED | All 73 catalog review entries exactly matched the disposable schema produced by the repository migrations. The remaining NOT_TESTED row covers end-to-end, concurrency and restore acceptance. |
| Installed application function bodies | 15/15 matched | Compared normalized body hashes with a disposable full migration replay; security/search-path and execution permissions were checked separately. |
| Live data integrity audit | 31 PASS, 4 REVIEW | The four review categories are documented below; they were not hidden or deleted to manufacture a clean report. |
| PostgreSQL public indexes | 0 invalid/not-ready indexes | Catalog inspection, not a load/performance benchmark. |
| Application browser boundary | 18/18 tables protected | RLS enabled, direct anon/authenticated table/column privileges removed. Browser roles cannot bypass RLS. |
| Disposable database regression suite | 67 passed, 0 failed | Includes the full migration replay, query/schema checks, grading/timing/authorization, rollback/history retention and the seven new 032/033 regressions. |
| Live public API/asset checks | 70 passed, 0 failed | API reports database readiness OK; catalog exposes one published course with management fields omitted; protected routes reject signed-out users; origins, validation and frontend/model assets pass. These are not signed-in workflow tests. |

No accounts, enrollments, exams, attempts, integrity events or payment records
were deleted. Exact row counts on the sixteen existing application tables
matched before and after the schema/publication repairs. The new feedback and
administrator audit tables contain zero rows. No historical grades, answers,
event records, payments or entitlements were rewritten by the repair scripts.

## Application table inventory

Counts from the live post-repair verification, not account/answer exports:

| Table | Rows |
| --- | ---: |
| users | 30 |
| courses | 15 |
| topics | 9 |
| questions | 2 |
| enrollments | 10 |
| quizzes | 0 |
| quiz_questions | 0 |
| teacher_quizzes | 21 |
| quiz_codes | 0 |
| quiz_attempts | 10 |
| cheating_violations | 18 |
| notifications | 38 |
| student_feedback | 0 |
| organizations | 1 |
| organization_members | 2 |
| safepay_payments | 8 |
| admin_governance_audit | 0 |
| course_assignment_audit | 0 |

The catalog inventory also inspected provider-managed schemas and the legacy
`stripe_webhook_events` table. Provider objects and that legacy table were
retained. The legacy table contains zero rows, has RLS enabled, and retains
default browser grants. The final policy inspection found no RLS policies and
neither browser role can bypass RLS, so those grants alone do not permit row
access. Its ownership/consumer context should be established before changing a
table outside the current application contract. An empty table is not evidence
that it can be deleted.

## Historical review items retained

| Category | Affected | Decision |
| --- | ---: | --- |
| Active exams linked to unpublished courses | 16 exams | A draft course is not automatically a defect. Only the course explicitly requested for the first reviewed exam was published. The owning teachers must decide which other courses should be published. |
| Historical cached violation totals differ from persisted events | 3 attempts | Stored counts are 2/0/0 while authoritative event counts are 8/2/6. Two attempts are completed and the third is the legacy orphan below; none has a historical timing snapshot. Event rows and grading history were retained. Current teacher/admin result code reads persisted events. |
| In-progress teacher attempt missing its timing snapshot | 1 attempt | This is the same orphaned attempt as the next row, not a second missing record. Its original timing/questions cannot be reconstructed from current exam edits. |
| Teacher attempt with no matching exam | 1 attempt | Preserve the record and its eight integrity events. Repair needs verified original exam/snapshot information or an explicit historical archival decision; do not guess an exam association or fabricate a new deadline. |

Ten legacy attempts also have unknown automatic-submission provenance because
those fields did not previously exist. NULL is retained deliberately and is not
evidence that every attempt was manually submitted.

## Remaining acceptance

A real signed-in teacher/student login → preview → start at the scheduled time
→ save/resume → submit → review flow was not performed against live accounts.
Full provider/storage behavior, real multi-connection contention, paid-provider
processing, backup availability and a restore drill remain unverified. Captured
catalog metadata is not a full data backup. These limits and the retained
historical exceptions prevent certification that everything is perfect.

The original [repository-only review](DATABASE_REVIEW.md) remains available for
the earlier compatibility repairs. The sanitized machine-readable evidence is
[LIVE_DATABASE_AUDIT_RESULTS.json](LIVE_DATABASE_AUDIT_RESULTS.json).
