# Deployment configuration

## Docker (recommended)

The Compose stack runs the API privately and serves the frontend through Nginx
on port `8080`. Nginx proxies browser requests from `/api` to the API container,
so the frontend never contains a backend host or server secret.

1. Copy `.env.docker.example` to `.env.docker` and replace every placeholder.
   Set `FRONTEND_URL` to the exact public **HTTPS** origin; it must not be
   `localhost` in production.
2. Apply all database migrations in `backend/migrations/` before the first
   start.
3. Build and start the services:

   ```bash
   docker compose up -d --build
   docker compose ps
   ```

4. Place a TLS reverse proxy (Caddy, Nginx, or a cloud load balancer) in front
   of `127.0.0.1:8080`, then point `FRONTEND_URL` at that HTTPS domain.

The Compose file deliberately binds only to loopback by default. Set
`ERAEDU_BIND_ADDRESS=0.0.0.0` only when a firewall or load balancer controls
public access. Never expose port `5000`; it is only reachable by the frontend
container.

Useful operations:

```bash
docker compose logs -f
docker compose pull
docker compose up -d --build
docker compose down
```

Verify `https://your-domain/`, `https://your-domain/health`, sign-in, quiz
start, and the admin dashboard after each deployment.

Set one canonical backend API URL before publishing. Do not leave historical host URLs in CI or frontend builds.

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
