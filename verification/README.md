# Product verification

These are bounded smoke checks, not a complete authenticated release sign-off.
Run from the repository root. The live targets are EraEdu's existing Vercel API,
Vercel frontend and GitHub Pages frontend. Raw reports and public screenshots go
under ignored `backend/coverage/product-api` and `backend/coverage/product-browser`.
Never add real passwords, tokens, account screenshots or customer data to reports.

## Public API and asset checks

```powershell
node verification/product-api-checks.mjs --live
# Recheck only the catalog after a relevant deployment:
node verification/product-api-checks.mjs --live --catalog-only
```

This checks readiness, the published public catalog, 48 unauthenticated protected
GET routes, invalid session rejection, exact credentialed origins, malformed
public auth bodies, safe 404 responses, both frontend entry bundles and all face
model manifests/shards. Requests never supply a valid account/session. Invalid
POST bodies fail validation before account lookup, email or database writes.
Only aggregate public-course metadata is recorded; course codes/IDs are not
included in evidence.

An expected 401 proves the signed-out authentication boundary, not authorization
between logged-in users or successful business behavior behind that boundary.
An AI readiness flag proves configuration presence, not a successful AI response.

## Public browser checks

Use a separate tool installation of `playwright-core` and an installed Chrome.
It is intentionally not a production application dependency. Set
`PLAYWRIGHT_MODULE_PATH` to that installation's `playwright-core/index.mjs` if it
is not available through normal package resolution. Optionally set `CHROME_PATH`.

```powershell
node verification/product-browser-checks.mjs --live
# Focus a repeat on the tablet regression:
node verification/product-browser-checks.mjs --live --only=tablet
```

The script launches headless Chrome with fresh contexts. It tests desktop, mobile
and tablet navigation, client-side empty-login validation, registration role
fields, password-reset entry/error pages, public support/legal routes, signed-out
dashboard/exam redirects, not-found behavior and uncaught application exceptions.
It does not use personal browser profiles, submit registration/reset/payment
forms, request camera permission, or access authenticated accounts.

For account-backed registration/login, session persistence, teacher exam creation,
student submission, grading, monitoring, roles and payment sandbox behavior, use
isolated staging accounts and follow `STAGING_E2E_RUNBOOK.md`. This public smoke
suite does not replace those acceptance tests. The backend Jest and disposable
PostgreSQL suites are separate evidence, not live user-workflow results.
