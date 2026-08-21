# EraEdu

EraEdu is a full-stack learning and assessment platform for secure online
quizzes, course delivery, teacher oversight, and student progress tracking.

It provides role-based access for students, teachers, and administrators;
face-assisted login; quiz proctoring signals; teacher analytics; quiz access
codes; and optional AI-powered question and study assistance.

## Highlights

- Role-based course, question, quiz, analytics, and administration workflows
- Password authentication with face-verification support
- Quiz integrity monitoring for focus changes, tab switches, and violations
- Secure quiz attempt ownership and controlled question access
- Teacher quiz creation, assignment, grading, and violation review
- Supabase-backed data, storage, and authentication integration
- Optional Gemini AI assistance and Resend email delivery
- Security headers, rate limits, validation, strict CORS, and health checks

## Architecture

```
Browser (React + Vite)
        │
        ▼
Express API (Node.js / Vercel serverless)
        │
        ▼
Supabase (Postgres, Auth, Storage)
```

## Tech stack

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, Zustand, face-api.js |
| Backend | Node.js, Express, TypeScript, JWT, Zod |
| Security | Helmet, express-rate-limit, CORS, bcryptjs |
| Platform services | Supabase, Gemini (optional), Resend (optional) |
| Deployment | Vercel |

## Repository layout

```
frontend/       React application
backend/        Express API and Vercel serverless entry point
DEPLOYMENT.md   Deployment configuration instructions
```

## Local development

Prerequisites: Node.js 22+, npm, and a Supabase project.

```bash
# API
cd backend
npm install
npm run dev

# UI — run in a second terminal
cd frontend
npm install
npm run dev
```

Create `backend/.env` for development:

```env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-publishable-key
SUPABASE_SERVICE_KEY=your-secret-server-key
JWT_SECRET=use-a-unique-secret-of-at-least-32-characters
```

Never commit environment files or server keys.

## Vercel deployment

Deploy the application as two Vercel projects from the same repository:

1. **Frontend:** set the Vercel root directory to `frontend`.
2. **Backend:** set the Vercel root directory to `backend`.
   The frontend includes its Vercel configuration for SPA routes and security
   headers; do not override its build or output settings.
3. Deploy the frontend and copy its HTTPS URL.
4. Add backend production variables: `NODE_ENV`, `SUPABASE_URL`,
   `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `FRONTEND_URL`, and
   `ALLOWED_ORIGINS`.
5. Deploy the backend and copy its HTTPS URL.
6. Add `VITE_API_URL=https://your-backend.vercel.app` to the frontend Vercel
   project and redeploy it.
7. In Supabase Authentication settings, add the frontend HTTPS URL as the
   Site URL and Redirect URL.

The backend health endpoint is available at:

```text
https://your-backend.vercel.app/health
```

## Validation

```bash
# Backend
cd backend
npm run build
npm test

# Frontend
cd frontend
npm run lint
npm run build
```

## Security notes

- Keep `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, Gemini keys, and email-provider
  keys in environment-variable managers only.
- Rotate a secret immediately if it is shared, logged, committed, or exposed.
- Use a real HTTPS domain for `FRONTEND_URL` in production.
- Ensure Supabase Row Level Security policies and database migrations are
  applied before accepting real users.

## License

ISC
