# Deployment configuration

## Vercel

Deploy the frontend and backend as separate Vercel projects. Set the frontend
project root to `frontend` and the backend project root to `backend`. The
frontend `vercel.json` provides SPA route fallback and browser security headers.

1. Apply all database migrations in `backend/migrations/` before the first
   deployment.
2. Deploy the frontend once and copy its generated HTTPS URL.
3. Set the backend environment variables listed below, using that frontend URL
   as `FRONTEND_URL`, then deploy the backend.
4. Set `VITE_API_URL` in the frontend project to the backend's public HTTPS
   URL and redeploy the frontend.
5. Verify the deployed homepage, `/health`, sign-in, quiz start, and the admin
   dashboard.

Use one canonical backend API URL before publishing. Do not leave historical
host URLs in CI or frontend builds.

## Frontend

Set the GitHub repository variable `VITE_API_URL` to your backend API URL, for example `https://api.example.com/api`. The GitHub Pages workflow now fails if this variable is missing.

### Vercel and GitHub Pages together

Both frontends use the same existing backend and Supabase database:

- Vercel: `https://era-edu-mtoc.vercel.app/`
- GitHub Pages: `https://muhammadayantoorie-creator.github.io/EraEdu/`
- Backend: `https://era-edu.vercel.app`

GitHub Pages must be enabled with **GitHub Actions** as its publishing source.
The repository Actions variable `VITE_API_URL` is the public backend URL above;
it contains no credentials. The Pages workflow builds with `--base=/EraEdu/`.
GitHub documents this publishing mode in its [Pages configuration API](https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site).

The backend's `vercel.json` supplies the public `GITHUB_PAGES_ORIGIN` setting
`https://muhammadayantoorie-creator.github.io`. This is a versioned, non-secret
function environment setting, supported by [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json#env).
It is combined with `ALLOWED_ORIGINS` and the canonical `FRONTEND_URL` for both
credentialed CORS and the cookie-auth CSRF boundary. Other GitHub Pages tenants,
spoofed suffixes, wildcard origins, and origins containing `/EraEdu/` are rejected.
When deploying the backend elsewhere, supply this optional setting through that
host's environment manager. To use a different Pages domain, update the setting
and redeploy rather than permitting all `github.io` domains.

The canonical `FRONTEND_URL` continues to control password-reset and payment
return links. Adding the Pages origin does not change those links, database
credentials, the Supabase project, or the current Vercel frontend origin.

Keep `frontend/public/404.html` as the Pages fallback; do not overwrite it with
`index.html` after building. It redirects deep links to the repository root, and
the index script restores their path, query, and hash before React Router loads.
`npm run test:hosting` checks this round trip and ordinary Vercel routes. GitHub
Pages does not provide an application server rewrite for client routes.

After deployment, check the homepage, a directly opened `/EraEdu/login` link,
the emitted `/EraEdu/assets/` URLs, and an API preflight from the Pages origin.
Also check the Vercel origin remains permitted and an unrelated Pages tenant is
still denied. Sign-in and account-specific operations require browser acceptance
testing with a real account; a successful preflight alone does not verify them.

## Backend

Set these environment variables in the backend host:

- `SUPABASE_URL`
- `SUPABASE_KEY` (the public/publishable key used for Supabase client initialization)
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET` (32+ characters)
- `FRONTEND_URL` (the exact public frontend origin)
- `NODE_ENV=production`
- `ALLOWED_ORIGINS` (optional comma-separated exact origins; never use `*`)
- `GITHUB_PAGES_ORIGIN` (optional exact HTTPS origin; supplied by `backend/vercel.json` on Vercel)

Enter `production` without surrounding whitespace. The API now normalizes
this value before configuring cookies and production validation; unknown
values fail startup. `FRONTEND_URL` must use HTTPS in production (an app path
such as `/EraEdu` is allowed), while `ALLOWED_ORIGINS` must contain only exact
HTTPS origins, without paths, query strings, or credentials.

In production, the backend refuses to start if `FRONTEND_URL` is missing, points
to localhost, or `SUPABASE_SERVICE_KEY` is missing. This prevents an accidental
development configuration from being exposed publicly.

### Session cookie and payment return check

The API session cookie is `HttpOnly`, `Secure`, and `SameSite=None` in
production. The browser client sends API requests with credentials, so the
deployed frontend origin must exactly match `FRONTEND_URL` or be listed in
`ALLOWED_ORIGINS`; wildcard origins cannot be used with credentialed CORS.
After a Safepay return, verify `/api/auth/me` still succeeds after a hard
reload. If it does not, inspect the browser's cookie/CORS diagnostics and the
exact deployed origins rather than treating a payment cancellation as logout.

Safepay must redirect to the same authenticated frontend origin. A cancellation
returns to `/profile?payment=cancelled`, which is informational only; plan
activation occurs solely after the backend verifies `TRACKER_ENDED` with
Safepay (including via the signed webhook).

Optional integrations: `GEMINI_API_KEY`, `RESEND_API_KEY`.

After deployment, verify `/health`, login, quiz launch, and the admin control center. See `PRE_LAUNCH_CHECKLIST.md` for the complete sign-off process.
