# Audit before selective database cleanup

The cleanup scope is confirmed unnecessary data, not a database reset. These
queries read metadata or aggregate counts and perform no deletion or updates.
Run each whole file in the backend's actual Supabase project using SQL Editor.

1. [Object inventory](../backend/scripts/inventory_database_readonly.sql): tables,
   views, columns, approximate row counts, sizes and constraint counts across
   non-system schemas. Platform/extension objects and known application tables
   are retained. Unknown objects require ownership/use review; an empty table
   is not proof that it may be dropped. Approximate counts may be stale/unknown.
2. [Schema/security audit](../backend/scripts/audit_database_readonly.sql):
   required application tables/columns, functions, roles, grants, RLS, indexes,
   triggers and history constraints. Review `BLOCKED` prerequisites before step
   3; `REVIEW` is a request for inspection, not an instruction to delete.
3. [Data integrity/candidate audit](../backend/scripts/audit_database_data_readonly.sql):
   counts of broken references, duplicate identities/enrollments/events,
   capacity/grade/payment inconsistencies and expired temporary auth fields.
   It requires the schema/column/type prerequisites from step 2. An SQL error
   is not a pass. No names, emails, credentials, questions or answers are returned.

Share inventory metadata and audit results; do not share account exports or
keys. The catalog inventory is not a scan of every stored value and does not
establish that unrecognized objects are unused. The data audit covers the
known EraEdu application contracts, not all provider-managed internals.

Temporary password-reset/OTP challenge fields with explicit expiries more than
24 hours ago are potential cleanup candidates. They can be evaluated separately
from user accounts and active challenges. No hash/token values need to be read
or returned. Actual cleanup must use the fresh expiry predicates and return
only affected counts; it must not clear newly issued challenges.

Old exams, draft courses, users with no recent login, read notifications,
unsuccessful payments, duplicated-looking exams and orphaned attempts are not
automatically unnecessary. Assessment, payment and audit history can remain
required after their related object is missing. In particular, the preserved
legacy attempt from the migration 027 repair is not an approved deletion target.
Do not infer a record-retention policy from a date or a zero usage statistic.

After reviewing the actual results, document exact eligible objects/rows,
dependency effects, affected counts and the backup/restore path before preparing
targeted cleanup. Keep history and constraints intact. No production removal is
authorized merely by a report row being marked `REVIEW`.

`backend/src/scripts/clearDatabase.ts` is a wholesale reset script: it deletes
attempts, questions, quizzes, enrollments, topics, courses and users. The
development bootstrap also contains legacy grants. Neither is a selective
cleanup tool; do not run them for this task.
