# EraEdu isolated staging release run

Status: **not executed (2026-10-15)**. No usable staging URLs or confirmed isolated test environment were supplied. Record the staging frontend/API origins, deployed commit, migration version, browser/device, tester, time, and evidence links before an authorized run. The README's public demo is not assumed to be staging. Never use report passwords, production accounts, production payment keys, or production data. Local browser startup also failed before navigation, so no visual pass is claimed.

## Isolated fixture and cleanup

Use one staging-only admin (A), organization owner/teacher (T1), another teacher in a **different** organization (T2), a third eligible teacher in T1's organization (T3, for successful reassignment), and three students (S1/S2/S3) with distinct emails. Use a staging Supabase project and Safepay sandbox keys. Record generated IDs and tracker IDs in private test evidence, not this repository. Apply/reconcile all migration files through 028 in numeric order (the repository has no 011 file), verify the schema and unique constraints, and take a staging backup before testing. Migration 027 requires an exam-free maintenance window; never fabricate fresh deadlines for legacy active attempts. Do not call `clearDatabase` or delete shared records. Archive only these test fixtures after preserving evidence.

## Ordered flow and exact assertions

| Step | Action | Required observation |
| --- | --- | --- |
| 1 | Sign in as A, T1, T2, S1, S2, S3 in separate browser profiles; hard-refresh each dashboard. | Sessions persist. A can open governance; non-admins cannot enumerate admin users or change role/suspension. Suspend T1 with A, retry T1's existing cookie and Bearer token; expect denial. Restore and re-login. Repeat for admin demotion with a disposable admin. |
| 2 | A creates a course in T1's institution assigned to T1, with a custom category and a two-student limit; refresh/edit/reassign T1→T3 and back. Attempt reassignment to T2. | Identity, topic/assessment IDs and enrollment history remain stable. T2 cannot see/manage it; cross-institution assignment fails. Governance audit records each successful change. |
| 3 | T1 publishes the course, creates a topic and material, then a bank MCQ and a short-answer item. Create a teacher exam using a bank MCQ snapshot plus a manually authored MCQ. | The selected bank item maps options/key/time correctly; editing the bank item later does not change the existing exam. S1 sees only published material. T2 cannot edit T1's content. Direct URLs and refresh work. |
| 4 | Enroll S1 by code, repeat the request and double-click; race S2 and S3 for the final seat. | S1 consumes one seat. Exactly one of S2/S3 succeeds; capacity never exceeds the limit. Course card/detail agree on enrollment and visible topic count. An unrelated student sees no private/draft content. |
| 5 | S1 starts the teacher exam. Check direct start URL, refresh, second tab, background tab, and option shuffle. Spend 20 seconds of a 60-second question, leave and return, then send a late answer directly to API. | Compare `deadlineAt` from `/attempt/:id/activate` across calls: it is identical and remaining time is about 40 seconds. `/attempt/:id/active` restores saved answers without keys. A late changed answer is rejected; overall expiry finalizes only previously saved work. Repeated/concurrent starts yield one active attempt. **Requires migration 027 and staging verification.** |
| 6 | Use a fixed three-MCQ attempt where only Q3 is correct; submit twice/concurrently. | One completed attempt; score 1/max 3/33%; exactly one correct review row for multiple shuffle variants. Short answers retain manual-review policy. T1 can review; T2 and S2 cannot read the attempt. Before review S1 sees pending, after review S1 and T1 agree; refresh/history agree. |
| 7 | Trigger one permitted tab-switch/visibility event, retry the same event ID, then send two distinct events with a temporary network failure and a concurrent submit. Test configured auto-submit threshold. | One persisted row for duplicate retries, two for distinct events. Saved answers and score survive. T1/admin see attributed event type/time/details; S1's details obey visibility policy. T2 cannot review/flag T1's attempt. |
| 8 | After completion, S1 submits feedback; retry same submission; try another student's completed attempt ID from a separate isolated fixture and an incomplete attempt. A opens feedback page. | Exactly one owned completed-attempt feedback row; duplicate/foreign/incomplete attempts fail distinctly. Admin sees it; form retains input after transient failure. |
| 9 | With a separate isolated seat-capacity fixture, T1 adds a registered teacher twice, then races two other disposable registered teachers for its last seat. T2 from an unrelated organization attempts management. | Duplicate is idempotent; capacity is not exceeded; member row and used/remaining counts refresh; unrelated member denied. |
| 10 | In Safepay **sandbox**, start checkout then cancel; refresh `/profile?payment=cancelled`, `/auth/me`, and team view. Also test pending/failed tracker and a sandbox successful tracker plus webhook retry. | Cancel preserves session/team and does not upgrade. Only server-verified paid state upgrades once. Pending/failed remains accurate. Verify cookie `Secure`/`SameSite`, API origin, CORS, and actual deployed redirect. No real charge. |
| 11 | Navigate every admin card/menu, T1 course/topic/question/exam screens, and S1 study/profile/results on desktop and mobile. Use clicks, keyboard, direct URLs, browser back, and hard refresh. | Correct role layout, no redirect loops, no dead URLs, accurate empty/error states. Test no camera, covered lens, permission denial, model-load failure, and real face separately. External OS/Meet screen sharing while exam remains focused is **unsupported by browser-only signals** and must not be marked detected. |

For every step, capture request URL/method/status (redacting cookies/tokens/PII), response contract, UI screenshot, fixture ID, and pass/fail. A failed assertion blocks release; never relabel a 500 as a pass. Record rollback owner, backup restore drill result, monitoring/alert dashboard, and database migration evidence with the run.

## Repeatability and fault checks

- Give each run a unique prefix and reuse only that run's fixture IDs. Record expected published/draft topic counts, seat limits, enrollment rows and question keys privately before beginning. Do not change a real user's role for the suspension test.
- Use the browser's offline toggle to interrupt answer/event/feedback writes, restore connectivity, and use the same retry event ID. Verify a visible retry state and that the server row count does not increase on duplicate retries. Capture both the successful response and the persisted row.
- For simultaneous requests use two isolated browser profiles or a staging-only API harness carrying each user's own session. Record both HTTP results and the database invariant: one active attempt, one enrollment per student/course, used seats at or below limit, one final score, one entitlement transition. A mocked service result is not proof of PostgreSQL serialization.
- For pre-review access inspect every response the student screen consumes, including history, student analytics and dashboard summary. Pending detail alone is insufficient if another endpoint reveals an unreleased score; record this as a blocker.
- For the payment return keep the same browser profile across checkout, cancellation and hard reload. Verify the API cookie actually travels to the API origin. Repeat on the deployed frontend/backend hosts, not only a localhost proxy.
- For external screen sharing, start a sandbox meeting or OS capture outside the page, return focus to the exam and keep fullscreen. Document that EraEdu cannot infer the ongoing external capture from these browser APIs. Do not start a recording or install an extension as part of this test.

## Migration and rollback rehearsal

Take a restore-tested staging backup and record migration checksums. Read each migration's prerequisites; run the existing orphan report before 025, finish/review legacy active teacher attempts before 027, then apply 026–028 using the migration operator role. Check new RPCs are callable only by `service_role`, not browser roles. Do not weaken RLS or existing account checks to make tests pass.

Stop new starts, governance writes and payment processing before rolling back a paired API/UI release. Keep all snapshot/deadline/audit/payment rows and uniqueness protections. A pre-027 API can reset timing, so disabling new exams is safer than reopening an active exam with the old code. Follow the per-file rollback comments and rehearse restore on staging before any production rollout.

## Repeatable local SQL check (not staging)

The optional test tool is separate from application dependencies. Install pinned `@electric-sql/pglite@0.5.10` in a disposable directory with sufficient free space, not the production application. On PowerShell, from the repository root:

```powershell
npm.cmd install --prefix D:/EraEdu-sql-tools --no-save --package-lock=false --no-audit --no-fund @electric-sql/pglite@0.5.10
$env:PGLITE_MODULE_PATH = 'D:/EraEdu-sql-tools/node_modules/@electric-sql/pglite/dist/index.js'
node --test backend/scripts/verify-teacher-deadlines.mjs
```

The script creates only an in-memory database. It executes migration 027 with a fake clock and minimal prerequisite tables, then discards that database. It accepts no Supabase URL, credentials or existing database directory. It verifies behavior and SQL execution, but not the full migration chain, actual Supabase policies or concurrent sessions. Keep the two-connection staging cases above as release gates. The audit's test tool was installed in `D:/EraEdu-verification-20261014/sql-tools`; the example command uses a separate disposable path for repeat runs.
