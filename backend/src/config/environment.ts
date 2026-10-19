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
  if (isProduction && /replace-with|your-project|example\.com/i.test(value)) {
    throw new Error(`FATAL: Environment variable "${name}" still contains an example placeholder.`);
  }
  return value;
}

// Vercel does not guarantee NODE_ENV is explicitly present in every project.
// Treat a Vercel runtime as production so cookies, CORS, and error handling
// cannot accidentally fall back to development behaviour after deployment.
const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase() || (process.env.VERCEL === '1' ? 'production' : 'development');
if (!['production', 'development', 'test'].includes(nodeEnv)) {
  throw new Error('FATAL: NODE_ENV must be production, development, or test.');
}
// Downstream libraries and session cookies also inspect NODE_ENV directly.
process.env.NODE_ENV = nodeEnv;
const isProduction = nodeEnv === 'production';
const frontendRaw = process.env.FRONTEND_URL || (isProduction ? '' : 'http://localhost:3000');
const frontendAppUrl = isProduction ? requireEnv('FRONTEND_URL', 8).replace(/\/$/, '') : frontendRaw.replace(/\/$/, '');

function validateBrowserUrl(name: string, value: string, allowPath = false): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(`FATAL: ${name} must be a valid absolute URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || (!allowPath && url.pathname !== '/')) {
    throw new Error(`FATAL: ${name} must be an HTTP(S) ${allowPath ? 'app URL' : 'origin'} without credentials, query, or fragment.`);
  }
  if (isProduction && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error(`FATAL: ${name} must use a public HTTPS URL in production.`);
  }
  return allowPath ? url.href.replace(/\/$/, '') : url.origin;
}
const validatedFrontendUrl = validateBrowserUrl('FRONTEND_URL', frontendAppUrl, true);

const serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (isProduction && serviceKey.length < 20) {
  throw new Error('FATAL: SUPABASE_SERVICE_KEY must be configured in production.');
}

export const config = {
  nodeEnv,
  port: process.env.PORT || 5000,
  frontendAppUrl: validatedFrontendUrl,
  frontendUrl: new URL(validatedFrontendUrl).origin,
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
    .filter(Boolean)
    .map(origin => validateBrowserUrl('ALLOWED_ORIGINS', origin)),
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
