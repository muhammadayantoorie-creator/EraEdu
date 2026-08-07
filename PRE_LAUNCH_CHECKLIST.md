# EraEdu production launch checklist

Use this checklist before publishing a release. Do not treat a successful frontend build as a production sign-off.

## Database

- Apply migrations in order: `001` through `009` from `backend/migrations/`.
- Confirm `teacher_quizzes.violation_limit` exists and has a default of `3`.
- Confirm `users.is_suspended` and `users.suspended_at` exist.
- Confirm Row Level Security is enabled for production tables and browser roles do not have direct write access to user, attempt, violation, or quiz tables.
- Do not run `backend/src/scripts/create-all-tables.sql` on an existing production database.
- Back up the production database and test recovery before launch.

## Environment and deployment

- Set `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET` (32+ characters), `FRONTEND_URL`, and `NODE_ENV=production` in the backend host.
- Confirm the backend starts with a public HTTPS `FRONTEND_URL`; production startup rejects localhost URLs and a missing service key.
- Use `ALLOWED_ORIGINS` only for additional exact trusted origins. Never use a wildcard origin.
- Set `GEMINI_API_KEY` and `RESEND_API_KEY` only if those features are enabled.
- Set `VITE_API_URL` in the frontend deployment environment to the single canonical backend URL, ending in `/api`.
- Set `FRONTEND_URL` to the exact frontend origin. CORS now uses exact origin matching.
- Remove stale Railway, Vercel, GitHub Pages, or GitLab URLs from CI and deployment documentation before selecting the production host.
- Never put Supabase service-role keys, JWT secrets, or Resend keys in frontend variables or source control.

## Product verification

- Register and sign in as a student and as a teacher.
- Verify face enrollment, face login, password reset, and account suspension.
- Create a quiz with camera monitoring and a violation limit; verify that the configured limit auto-submits an attempt.
- Verify quiz review, final confirmation, and preparation stages before a teacher opens a quiz.
- Verify desktop, tablet, mobile, keyboard navigation, Escape-to-close, and dark-mode readability.
- Verify admin user search, role changes, suspension, and restoration using a non-primary administrator account.

## Release gates

- Run backend build and tests: `cd backend && npm ci && npm run build && npm test`.
- Run frontend checks: `cd frontend && npm ci && npm run lint && npm run build`.
- Run an authenticated smoke test against the deployed API: `/health`, login, quiz launch, violation report, and admin overview.
- Ensure CI is green and uses `npm ci`; do not publish from a machine with uncommitted secrets or local-only configuration.
- Record the deployed frontend URL, backend URL, database migration version, release commit, and rollback owner.
