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

## Backend

Set these environment variables in the backend host:

- `SUPABASE_URL`
- `SUPABASE_KEY` (the public/publishable key used for Supabase client initialization)
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET` (32+ characters)
- `FRONTEND_URL` (the exact public frontend origin)
- `NODE_ENV=production`
- `ALLOWED_ORIGINS` (optional comma-separated exact origins; never use `*`)

In production, the backend refuses to start if `FRONTEND_URL` is missing, points
to localhost, or `SUPABASE_SERVICE_KEY` is missing. This prevents an accidental
development configuration from being exposed publicly.

Optional integrations: `GEMINI_API_KEY`, `RESEND_API_KEY`.

After deployment, verify `/health`, login, quiz launch, and the admin control center. See `PRE_LAUNCH_CHECKLIST.md` for the complete sign-off process.
