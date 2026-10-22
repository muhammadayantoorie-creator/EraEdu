# Approved live database repair plan — 21 October 2026

Historical snapshot from 21 October. The publication requirement described here
was superseded by migration 034 on 23 October: enrolled students can now
join code exams independently of course publication. See the
[current exam access rollout](FIX_EXAM_COURSE_ACCESS.md).

Project: EraEduation, the active EraEdu Supabase project. The initial live
schema/security audit returned 94 BLOCKED, 302 PASS, 58 REVIEW and one NOT_TESTED
check. Multiple failures have a common cause; this is not 94 separate migrations.
The live migration ledger is empty despite several existing function bodies
matching the repository. Do not replay the whole historical chain.

The user explicitly approved all ten targeted migrations below, and all ten
were successfully applied. Automatic approval review initially rejected the
batch; execution proceeded only after that explicit approval. The subsequent
live audit exposed Supabase's explicit browser EXECUTE defaults on migration
021's seat function. [Migration 033](../backend/migrations/033_protect_organization_seat_rpc.sql)
was then applied to meet the approved service-role-only requirement. It changes
only those function grants and preserves its body and organization memberships.
See [the completed live review](LIVE_DATABASE_REVIEW_2026-10-21.md).

| Migration | Exact change |
| --- | --- |
| [032](../backend/migrations/032_reconcile_attempt_submission_fields.sql) | Add missing `quiz_attempts.auto_submitted` and `submission_reason`. New attempts default to `false`; old rows keep NULL provenance. Refuse incompatible existing types. |
| [009](../backend/migrations/009_add_student_feedback.sql) | Create missing student feedback table, foreign keys, rating/category constraints and indexes; enable RLS and deny direct browser access. |
| [020](../backend/migrations/020_add_admin_governance_audit.sql) | Create missing administrator governance audit table and target/date index. |
| [021](../backend/migrations/021_enforce_organization_seats_atomically.sql) | Install the missing atomic organization-seat function; permit only the service role to execute it. No memberships are added by installation. |
| [022](../backend/migrations/022_topic_exam_attempt_snapshots.sql) | Add missing topic question snapshot column and unique active-topic-attempt index; deny browser access to stored answer snapshots. The duplicate-active-topic prerequisite currently passes. |
| [025](../backend/migrations/025_preserve_assessment_history.sql) | Add generated teacher/topic reference columns and historical-reference constraints. Replace destructive attempt/topic and exam/course delete actions with RESTRICT. Keep legacy references using NOT VALID constraints. |
| [026](../backend/migrations/026_atomic_admin_governance.sql) | Install audited atomic account-administration function, with service-role execution and protected audit-table permissions. No account roles/statuses are changed by installation. |
| [028](../backend/migrations/028_atomic_safepay_entitlement.sql) | Install atomic verified-payment/entitlement function with service-role execution. No payment/provider calls or entitlement updates occur during installation. |
| [030](../backend/migrations/030_reconcile_quiz_code_reference.sql) | Correct `quiz_codes.quiz_id` FK from topic quizzes to teacher exams. Refuse ambiguous legacy references. Current preflight passes and this table has zero rows. |
| [031](../backend/migrations/031_enforce_api_database_boundary.sql) | Enable RLS on all 18 application tables, revoke direct table/column privileges from PUBLIC/anon/authenticated, and retain service-role CRUD. Preserve provider schemas, custom tables and existing policies. This changes access permissions and requires post-change API verification. |

The batch saved catalog permissions/constraint metadata first, used transactions
with bounded lock/statement timeouts, stopped on errors, recorded newly
applied migrations, and reran the schema audit. This metadata is not a full data
backup; backup/restore availability has not been verified. Reversing history
protections or security changes needs a reviewed rollback, not a database reset.

All 60 existing disposable database checks passed. The four new migration-032
tests passed, covering legacy-value retention, normal new writes, repeat
application and incompatible-type rollback. A disposable full migration replay
through 032 also succeeded. All 11 installed application-function bodies checked
against the repository matched; the other four required functions are missing.

The original publication fix for the first reviewed exam is a separate, previously authorized
data operation. Its linked course is unpublished and shared with one other
teacher exam; publication affects that course and both exams' normal eligibility.
No proposal publishes every draft course, transfers enrollment, changes grades,
or deletes historical records.
