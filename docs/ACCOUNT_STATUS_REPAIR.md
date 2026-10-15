# Sign-in / sign-up account-status repair

The screenshot's original message is emitted when a current-account lookup fails,
or `users.is_suspended` is not a boolean. It is **not evidence of bad credentials**.
The deployed cause is unconfirmed: no usable deployment URL, database metadata,
or sanitized API logs were supplied. `ERAEDU` is a name, not a full URL.

## Code-confirmed gap and repair

Migration 008 uses `ADD COLUMN IF NOT EXISTS`; that does not repair a pre-existing
nullable column or a missing default. Registration previously omitted the field,
so such a deployment could create a NULL-status account that then cannot sign in.
If the column is absent entirely, password login's `select('*')` omits it and
protected session lookups fail. A network/permission problem can also produce
the original message; migration 029 does not fix those unrelated failures.

- New registration checks that the status column is readable **before insertion**,
  explicitly sets server-owned `is_suspended: false`, and validates the returned state.
- Missing/malformed status returns HTTP 503 `AUTH_SCHEMA_REQUIRED`; an actual
  database query failure returns retryable 503 `AUTH_STATE_UNAVAILABLE`.
- Login and protected requests use the same fail-closed status check. Suspended
  users still receive 403; current roles and deleted accounts are still checked.
- Session restoration displays a schema-specific explanation rather than claiming
  repeated retries will repair setup. No cookie/security check was disabled.

## Deployment owner: inspect before applying

Use the SQL editor for the **database connected to the affected backend**, initially
in staging. Do not paste keys or user/password rows into chat. Record the API commit,
database project, migration ledger and a tested backup/restore point.

Read-only schema query:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND column_name IN ('is_suspended', 'suspended_at');
```

Only if `is_suspended` exists and is boolean, inspect aggregate status:

```sql
SELECT count(*) FILTER (WHERE is_suspended IS NULL) AS unknown_status,
       count(*) FILTER (WHERE is_suspended IS TRUE) AS suspended,
       count(*) FILTER (WHERE is_suspended IS FALSE) AS active
FROM public.users;
```

Apply/reconcile prerequisite migration 008, then the additive
`backend/migrations/029_reconcile_account_status.sql` with an authorized database
owner. 029 supplies missing columns and repairs the default/NOT NULL contract,
without rewriting any existing status or role. A missing column follows 008's
original false-default policy. Existing true values remain true.

**NULL legacy values or a non-boolean column stop the transaction.** Roll back the
failed transaction; an authorized owner must privately investigate those records
and explicitly decide their status, with an audit trail, before rerunning. Do not
bulk coalesce unknown statuses to false, remove the runtime check, or reset all
suspensions. Lock acquisition is bounded to five seconds; retry in a maintenance
window if the table is busy. The script requests a PostgREST schema-cache reload.

For a genuine lookup outage, inspect sanitized backend error codes, Supabase
availability, the server-only service-key configuration and permissions instead.
Do not put a service key in Vite variables or bypass RLS/access checks.

## Rollback

If 029 fails, its transaction leaves the schema and statuses unchanged. If it
succeeds, retain the compatible additive columns/default/constraint when rolling
back application code; do not drop suspension data. If a schema rollback is truly
required, compare the pre-change schema backup and review the specific DDL first.
Removing the constraint/default while this auth version runs reintroduces the
failure. No production database operation is performed by committing these files.

## Verification and manual acceptance

Local run on 2026-10-15, in the existing D-drive lockfile-installed verification
copy with placeholder test configuration (no `.env` or live database): backend
build passed; all **257 Jest tests / 31 suites** passed across the current working
tree (including other unfinished fixes); **3/3 isolated migration tests** passed.
Frontend build, lint and `tsc --noEmit` passed. The frontend has no `test` script;
no browser test is claimed. Existing build warnings concern bundle size, stale
Browserslist data and TensorFlow browser-externalized modules. The initial backend
build caught an unrelated unfinished test's tuple typing; correcting that fixture
allowed the reported rerun to pass. These are not deployed verification results.

- `accountStatusSetup.test.ts`: missing column/cache error prevents registration
  writes/email; active registration → sign-in; no token in JSON; HttpOnly cookie;
  malformed status denied; outage vs schema classification; suspension/admin-role denial.
- `authorizationState.test.ts`: existing cookie/Bearer sessions, role demotion,
  suspension/restore, deleted accounts, failed lookup, governance authorization.
- `node --test backend/scripts/verify-account-status.mjs`: isolated PostgreSQL
  cases for missing column, an existing default-less column, retained suspensions,
  idempotent migration, and atomic refusal of unknown legacy statuses. Set
  `PGLITE_MODULE_PATH` to a disposable installed PGlite module if needed.

On authorized staging, create an isolated teacher, sign in, refresh `/profile`,
and confirm `/api/auth/me` succeeds. Repeat with a policy-valid student account.
Suspend that test teacher as admin and verify the same session receives 403;
restore and retry. Confirm schema/setup errors do not create partial accounts,
and temporary lookup failures show retry without granting access. Do not use QA
report passwords. These deployed browser/database checks are **not yet executed**.
