# Repair the monitoring migration error

The reported message refers to migration 019, which provides stable monitoring
event IDs, a unique retry index, and attempt summary columns. Pushing application
code does not apply this migration to Supabase. The earlier course-assignment
verification checks migration 024; its 12 passing checks do not verify monitoring.

## Run manually

1. Open **SQL Editor > New query** in the Supabase project used by the affected backend.
2. Paste and run the entire `backend/migrations/019_make_cheating_events_authoritative.sql`, including `BEGIN` and `COMMIT`.
3. In a new query, run the entire `backend/scripts/verify-monitoring-schema.sql`. All **eight** rows must report `PASS`.
4. Refresh the affected EraEdu page and retry the operation.

The verification is read-only and returns structural check results, without exam
records, accounts, or credentials. It checks both tables, the three column types,
the two defaults, and the valid unique partial retry index.

If a statement fails, run `ROLLBACK;` in the failed SQL session before retrying
the entire file. A missing prerequisite table, incompatible column type, duplicate
existing event identity, or incompatible existing retry index requires review.
The migration deliberately stops instead of deleting events, converting historical
data, or replacing an index silently. Do not reset/bootstrap an existing database.
Lock and statement timeouts also abort the whole migration; retry when database
activity permits the changes.

This migration does not provide the teacher timing functions from migration 027.
If the API specifically reports missing migration 027 after this repair, follow
that migration's maintenance-window instructions, including its active-exam check.
Do not apply timing migrations blindly during active teacher exams.

## Application and SQL changes

- Migration 019 is now atomic and repeatable, requests a PostgREST schema-cache
  reload at commit, and validates existing types and the actual retry index.
  Existing exam scores, event rows, event IDs, and summary values are retained.
  Defaults apply to future inserts. Keep the additive schema when rolling back
  application code rather than dropping monitoring history or retry protection.
- The backend previously labelled any undefined-column error, or any error
  mentioning `cheating_violations`, as missing migration 019. Permission and
  connectivity failures could therefore produce the screenshot's misleading
  instructions. It now requires a missing monitoring column with the corresponding
  PostgreSQL/PostgREST error code, or the atomic writer's missing conflict index.
- The teacher writer now reports missing monitoring fields/indexes as migration
  019. Actual missing timing columns/functions still point to migration 027.
  Permission and unrelated database failures retain the normal error handling.
  Monitoring writes still require stable event IDs, authenticated attempt ownership,
  and the existing atomic teacher writer.

## Verification and remaining acceptance

Twelve regression tests exercise actual missing fields, PostgREST cache errors,
the missing conflict index, and unrelated permission/connectivity/column errors.
The focused monitoring/submissions suites pass all 36 tests.
The full backend suite passes all 324 tests across 37 suites, and the backend
TypeScript build passes.

Seven isolated PostgreSQL tests execute the actual migration and verification SQL,
including repeatability, all eight passing checks, preservation of historical
records/scores/summaries, retry uniqueness, and complete rollback on missing
prerequisites, duplicate event identities, incompatible types or incompatible
index definitions. They never connect to Supabase. With an isolated PGlite
installation, set `PGLITE_MODULE_PATH` to its `dist/index.js` and run
`node --test backend/scripts/verify-monitoring-schema.mjs`.

Production database changes remain manual, as requested. The live error is only
confirmed resolved after these eight checks pass in the backend's actual database
and the authenticated page operation succeeds.
