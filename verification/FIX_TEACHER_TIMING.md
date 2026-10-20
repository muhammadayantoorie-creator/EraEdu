# Repair the teacher exam timing setup

The error naming `027_teacher_attempt_deadlines.sql` means the API could not use
the required timing schema/RPCs or the attempt has no original timing snapshot.
Passing the course-assignment checks (024) or monitoring checks (019) does not
verify migration 027. A successful `/health` database connection is also
insufficient evidence that the timing functions are installed and callable.

Use the Supabase project matching the deployed backend's `SUPABASE_URL`. Run each
file in full using SQL Editor as the database administrator. Repository pushes
and Vercel deployments do not execute these SQL files automatically.

The read-only verifier in step 3 may also be run first to identify the missing
objects. If it already reports 27 `PASS` rows, skip reinstallation and follow the
project/credential/legacy-attempt checks at the end of this document.

1. Stop new exam starts for an exam-free maintenance window. Run
   [`preflight-teacher-deadlines.sql`](../backend/scripts/preflight-teacher-deadlines.sql).
   It returns only an aggregate count. Continue only if it reports `PASS` and
   `active_teacher_attempts = 0`.
2. Run the complete
   [`027_teacher_attempt_deadlines.sql`](../backend/migrations/027_teacher_attempt_deadlines.sql).
   This installs the immutable snapshot, saved question state, timer/finalization
   functions and restricted RPC grants in one transaction. It also requests a
   PostgREST schema-cache reload at commit. A lock timeout rolls back the repair;
   retry during a quiet window after the lock holder completes.
3. Run [`verify-teacher-deadlines.sql`](../backend/scripts/verify-teacher-deadlines.sql).
   **All 27 checks must report `PASS`.** They check timing column types/defaults,
   function signatures/security, backend-only execution, browser access denial,
   active-attempt uniqueness and the migration 019 monitoring dependency.
4. Refresh the frontend and sign in again. With a disposable student enrolled in
   a published course, start a teacher exam, activate a question, save an answer,
   and refresh. The same attempt and original deadline must return. Submit and
   confirm the teacher can review the saved answers. Prefer staging; do not
   experiment on an assessed student's attempt.

If preflight reports `STOP`, finish or review the existing attempts before
applying 027. Do not delete attempts, change their status to fabricate a
completion, copy today's question bank into an old attempt, or invent new
deadlines. The migration refuses active attempts and preserves their work.

For the specific `P0001: Migration 027 cannot infer deadlines for active teacher
exams` error, the guard stopped the transaction before adding timing columns or
replacing functions. If SQL Editor leaves the session in an aborted transaction,
run `ROLLBACK;` before the next diagnostic query. Repeating migration 027 will
continue to fail while these records remain active.

Run [`review-blocking-teacher-attempts.sql`](../backend/scripts/review-blocking-teacher-attempts.sql)
to identify up to 100 blocking attempts. It works even when migration 027 has
never run. It returns attempt/exam IDs, exam title, original start, saved-answer
count, snapshot presence and the total number of blocking records. It returns
no student identities or answer contents and changes nothing.

An `in-progress` database status does not prove a student is currently taking
the exam, and an old start date does not prove the work may be discarded. Confirm
with the exam administrator which attempts are ongoing versus abandoned tests.
An explicitly approved cancellation/retake decision needs the reviewed attempt
IDs and preservation of existing work; do not use a blanket `UPDATE ... SET
status='completed'` or remove the guard. Legacy attempts without a snapshot
cannot be finished by the new timing RPCs just by reapplying migration 027.

If verification reports `MISSING` or `DENIED`, inspect the named item in this
same project. An index dependency failure points to migration 019. `UNSAFE`
means browser-role access or a function security contract needs administrator
review; do not grant browser execution to make an exam launch succeed.
The verifier is structural evidence, not a complete live workflow test.

If all checks pass but the error persists, confirm that the deployed backend
uses this project's URL and service-role credential, and repeat with a new
disposable attempt. An old attempt without an original snapshot requires review;
reapplying the schema cannot recover timing evidence that was never recorded.
Do not place credentials in screenshots, SQL output or reports.

The backend also distinguishes missing timing objects from unrelated permission,
connection and schema-cache failures, so those failures do not incorrectly
instruct an operator to reapply 027.
