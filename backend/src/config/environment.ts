import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// On Vercel, env vars are injected directly — dotenv is a no-op.
// Locally, try .env first, then fall back to .env.local (created by `vercel env pull`).
if (process.env.VERCEL !== '1') {
  const envPath = path.resolve(process.cwd(), '.env');
  const envLocalPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  }
}

function requireEnv(name: string, minLength = 1): string {
  const val = process.env[name];
  if (!val || val.trim().length < minLength) {
    throw new Error(`FATAL: Environment variable "${name}" is missing or too short. Server will not start.`);
  }
  return val.trim();
}

function rejectProductionPlaceholder(name: string, value: string): string {
  // Example values are useful in committed templates but must never let a
  // production container start. Failing here provides an actionable error
  // instead of a permanently unhealthy database readiness probe.
  if (process.env.NODE_ENV === 'production' && /replace-with|your-project|example\.com/i.test(value)) {
    throw new Error(`FATAL: Environment variable "${name}" still contains an example placeholder.`);
  }
  return value;
}

// Vercel does not guarantee NODE_ENV is explicitly present in every project.
// Treat a Vercel runtime as production so cookies, CORS, and error handling
// cannot accidentally fall back to development behaviour after deployment.
const nodeEnv = process.env.NODE_ENV || (process.env.VERCEL === '1' ? 'production' : 'development');
const isProduction = nodeEnv === 'production';
const frontendRaw = process.env.FRONTEND_URL || (isProduction ? '' : 'http://localhost:3000');
const frontendAppUrl = isProduction ? requireEnv('FRONTEND_URL', 8).replace(/\/$/, '') : frontendRaw.replace(/\/$/, '');

if (isProduction && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(frontendAppUrl.replace(/\/$/, ''))) {
  throw new Error('FATAL: FRONTEND_URL must be a public HTTPS origin in production.');
}

const serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (isProduction && serviceKey.length < 20) {
  throw new Error('FATAL: SUPABASE_SERVICE_KEY must be configured in production.');
}

export const config = {
  nodeEnv,
  port: process.env.PORT || 5000,
  frontendAppUrl,
  frontendUrl: (() => {
    const raw = frontendAppUrl;
    try {
      return new URL(raw).origin;
    } catch {
      return raw;
    }
  })(),
  supabaseUrl: rejectProductionPlaceholder('SUPABASE_URL', requireEnv('SUPABASE_URL')),
  supabaseKey: rejectProductionPlaceholder('SUPABASE_KEY', requireEnv('SUPABASE_KEY')),
  // Never fall back to the public key for privileged server operations in
  // production. A missing service key must fail startup instead.
  supabaseServiceKey: rejectProductionPlaceholder(
    'SUPABASE_SERVICE_KEY',
    serviceKey || process.env.SUPABASE_KEY || '',
  ),
  additionalAllowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('FATAL: JWT_SECRET must be set and at least 32 characters long. Server will not start.');
    }
    return rejectProductionPlaceholder('JWT_SECRET', secret);
  })(),
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'EraEdu <onboarding@resend.dev>',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  safepayEnvironment: process.env.SAFEPAY_ENV || 'sandbox',
  safepaySecretKey: process.env.SAFEPAY_SECRET_KEY || '',
  safepayPublicKey: process.env.SAFEPAY_PUBLIC_KEY || '',
  safepayWebhookSecret: process.env.SAFEPAY_WEBHOOK_SECRET || '',
  // Retain the old variable as a fallback while the public plan is renamed.
  safepayInstitutionPricePkr: Number(process.env.SAFEPAY_INSTITUTION_PRICE_PKR || process.env.SAFEPAY_EDUCATOR_PRICE_PKR || 4999),
};
