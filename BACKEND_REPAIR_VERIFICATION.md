# Backend and frontend repair verification — 2026-10-19

This repair includes the existing unfinished result-release and monitoring-outbox changes in the working checkout, after review and verification.

## Confirmed problems and changes

- The public API root reported `environment: " production"` during the read-only deployment check. Exact production comparisons could therefore select development behavior. Configuration now trims and normalizes `NODE_ENV` for all consumers, rejects unknown environments, and applies placeholder validation to Vercel's implicit production mode as well.
- Invalid frontend URLs and unusable allowed origins now fail startup with an explicit configuration error. App paths such as GitHub Pages' `/EraEdu` remain supported separately from the exact CORS origin.
- Malformed JSON, oversized bodies, and rejected CORS origins now return safe 400, 413, and 403 errors respectively instead of misleading server failures.
- Teacher submissions and required teacher analytics queries no longer turn database errors into successful empty lists or zero counts. Retryable resource failures return 503 without exposing database messages.
- Student result history, summaries, submission responses, and analytics share the completed/reviewed release decision. Pending scores remain unavailable; reviewed zero remains a real zero. The frontend shows pending/unavailable states and retries instead of invented scores.
- Exam create/edit no longer retries while dropping required monitoring settings. Named missing columns produce an actionable migration error; unrelated failures are not misclassified.
- Monitoring events use an account-scoped persistent outbox with original event IDs, retries, acknowledgement before deletion, and explicit storage/network failures. App-level synchronization survives navigation. CI now runs the focused outbox verification and explicit frontend type checking.

## Public deployment checks before pushing

The checks used no credentials and made no database changes:

| Target | Actual response |
| --- | --- |
| `https://era-edu-mtoc.vercel.app/` | 200, EraEdu HTML and JavaScript |
| API host extracted from the public frontend bundle | `https://era-edu.vercel.app` |
| API `/` | 200; environment contained the leading space described above |
| API `/health` | 200; database and AI reported OK |
| API `/api/auth/me` without a session | 401 with `AUTH_REQUIRED` |
| API credentialed CORS origin for the configured frontend | Exact matching `https://era-edu-mtoc.vercel.app` |

These are availability checks of the deployment before this commit, not proof that the new commit has deployed or that authenticated workflows work.

## Local verification

- Backend TypeScript build passed.
- Full backend regression suite passed: 34 suites, 288 tests. After adding the two production-normalization cases, the final environment suite passed all 15 cases (the other suites were unchanged).
- Frontend monitoring outbox verification passed all six tests, covering offline reload, two tabs, account isolation/logout, backoff and denied writes, navigation, and unavailable storage.
- Frontend `npm run lint`, `npm run typecheck`, and `npm run build` passed. Existing warnings remain for the large face-detection bundle, browser-externalized TensorFlow/face-api Node modules, and stale Browserslist data.
- Backend dependencies installed with `npm ci`. The frontend installation stalled on this Windows environment, so final frontend checks used the other local checkout's complete dependency installation through a local junction. Both frontend lockfiles have the identical SHA-256 `E11A42470EDDED61D0A0E290AA5B2560C582989EA3E2463216D78243F93E813D`. No dependency versions or lockfiles were changed.
- `git diff --check` passed.

## Verification limits and deployment requirements

The browser connector failed to initialize with a missing `sandboxPolicy` field. Interactive UI, camera/device behavior, real-account sign-in, payment sandbox, and authenticated end-to-end workflows were not verified. No local real-service environment file or isolated test accounts were supplied. No production records or database migrations were changed.

Ensure the backend host has `NODE_ENV=production` (without extra spaces), the actual server-only Supabase service key, JWT secret, frontend URL, and exact allowed origins. Apply/reconcile the existing migration sequence as required by the documented staging runbook; in particular, 016 preserves exam settings, 027 supplies exam timing RPCs, and 029 reconciles account status. A green `/health` only checks database reachability and does not prove these schema contracts. This repair adds no migrations.

Run `STAGING_E2E_RUNBOOK.md` against isolated accounts and a payment sandbox before claiming full release readiness. See the earlier release audit for remaining device, concurrency, backup/restore, and schema verification requirements.
