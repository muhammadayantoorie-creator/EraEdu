# Deployment configuration

Set one canonical backend API URL before publishing. Do not leave historical host URLs in CI or frontend builds.

## Frontend

Set the GitHub repository variable `VITE_API_URL` to your backend API URL, for example `https://api.example.com/api`. The GitHub Pages workflow now fails if this variable is missing.

## Backend

Set these environment variables in the backend host:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET` (32+ characters)
- `FRONTEND_URL` (the exact public frontend origin)
- `NODE_ENV=production`

Optional integrations: `GEMINI_API_KEY`, `RESEND_API_KEY`.

After deployment, verify `/health`, login, quiz launch, and the admin control center. See `PRE_LAUNCH_CHECKLIST.md` for the complete sign-off process.
