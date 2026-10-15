import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import Safepay from '@sfpy/node-core';
import { config } from '../config/environment';
import { protect, authorize } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { paymentStatusFromTrackerState } from '../services/safepayPaymentState';

const router = Router();

const getClient = () => {
  const isProduction = config.safepayEnvironment === 'production';
  return new Safepay(config.safepaySecretKey, {
    authType: 'secret',
    host: isProduction ? 'https://api.getsafepay.com' : 'https://sandbox.api.getsafepay.com',
  });
};

const getOwnedOrganization = async (userId: string) => {
  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
};

const updatePaymentFromTracker = async (trackerToken: string, userId?: string) => {
  const query = supabase.from('safepay_payments').select('tracker_token').eq('tracker_token', trackerToken);
  const { data: payment, error } = userId ? await query.eq('user_id', userId).maybeSingle() : await query.maybeSingle();
  if (error) throw error;
  if (!payment) return null;

  const report: any = await getClient().reporter.payments.fetch(trackerToken);
  // The current Reporter endpoint returns the tracker directly under `data`.
  // Keep the nested fallback for older SDK response shapes.
  const tracker = report?.data?.tracker || report?.data;
  const reportedStatus = paymentStatusFromTrackerState(tracker?.state);
  // Only the server-fetched TRACKER_ENDED state maps to paid. The RPC locks
  // the payment and commits its status with entitlement activation, so an
  // activation failure cannot leave a paid-but-inactive payment behind.
  const { data: persistedStatus, error: transitionError } = await supabase.rpc('apply_verified_safepay_payment', {
    p_tracker_token: trackerToken,
    p_verified_status: reportedStatus,
    p_user_id: userId || null,
  });
  if (transitionError) {
    if (['PGRST202', 'PGRST204', '42883', '42703', '42P01', '42501'].includes(transitionError.code)) {
      throw new Error('Safepay entitlement setup is incomplete. Apply backend/migrations/010_add_subscription_status.sql, 013_add_safepay_payments.sql, 018_share_free_trials_by_institution.sql, and 028_atomic_safepay_entitlement.sql.');
    }
    throw new Error('Unable to finalize payment status. Please retry.');
  }
  if (persistedStatus === null) return null;
  if (!['pending', 'paid', 'failed', 'cancelled'].includes(persistedStatus)) {
    throw new Error('Unable to finalize payment status. Please retry.');
  }
  return { status: persistedStatus };
};

router.post('/checkout', protect, authorize('teacher'), async (req, res) => {
  if (!config.safepaySecretKey || !config.safepayPublicKey) return res.status(503).json({ success: false, error: { message: 'Safepay is not configured.' } });
  try {
    const organization = await getOwnedOrganization(req.user!._id);
    if (!organization) {
      return res.status(400).json({ success: false, error: { message: 'Create your institution workspace before activating the Institution plan.' } });
    }
    const env = config.safepayEnvironment === 'production' ? 'production' : 'sandbox';
    const client = getClient();
    // Safepay only accepts its supported metadata keys. The plan is stored in
    // our safepay_payments table after checkout, so do not send it to Safepay.
    const payment: any = await client.payments.session.setup({ merchant_api_key: config.safepayPublicKey, intent: 'CYBERSOURCE', mode: 'payment', entry_mode: 'raw', currency: 'PKR', amount: Math.round(config.safepayInstitutionPricePkr * 100), metadata: { order_id: `institution-${req.user!._id}` }, include_fees: false } as any);
    const passport: any = await client.client.passport.create();
    // The profile page polls Safepay with the tracker after checkout. Include
    // it in the return URL so a completed payment can activate the educator
    // subscription without relying solely on an asynchronous webhook.
    const tracker = encodeURIComponent(payment.data.tracker.token);
    const url = client.checkout.createCheckoutUrl({ env, tracker: payment.data.tracker.token, tbt: passport.data, source: 'hosted', redirect_url: `${config.frontendAppUrl}/profile?tracker=${tracker}`, cancel_url: `${config.frontendAppUrl}/profile?payment=cancelled&tracker=${tracker}` });
    const { error: saveError } = await supabase.from('safepay_payments').insert({
      tracker_token: payment.data.tracker.token,
      user_id: req.user!._id,
      organization_id: organization.id,
      plan: 'institution',
      amount: Math.round(config.safepayInstitutionPricePkr * 100),
      currency: 'PKR',
    });
    if (saveError) throw saveError;
    res.json({ success: true, data: { url } });
  } catch (error: any) { res.status(502).json({ success: false, error: { message: error?.message || 'Unable to create Safepay checkout.' } }); }
});

router.get('/status/:tracker', protect, authorize('teacher'), async (req, res) => {
  try {
    const payment = await updatePaymentFromTracker(req.params.tracker, req.user!._id);
    if (!payment) return res.status(404).json({ success: false, error: { message: 'Payment was not found.' } });
    res.json({ success: true, data: payment });
  } catch (error: any) {
    res.status(502).json({ success: false, error: { message: error?.message || 'Unable to check payment status.' } });
  }
});

// Lets the profile page recover a payment status even when a teacher closes
// the hosted-checkout return page before its tracker check finishes.
router.get('/subscription', protect, authorize('teacher'), async (req, res) => {
  try {
    const { data: latestPayment, error } = await supabase
      .from('safepay_payments')
      .select('tracker_token, plan, amount, currency, status, paid_at, created_at')
      .eq('user_id', req.user!._id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!latestPayment) return res.json({ success: true, data: null });

    const updated = await updatePaymentFromTracker(latestPayment.tracker_token, req.user!._id);
    res.json({
      success: true,
      data: {
        ...latestPayment,
        status: updated?.status || latestPayment.status,
      },
    });
  } catch (error: any) {
    res.status(502).json({ success: false, error: { message: error?.message || 'Unable to check subscription status.' } });
  }
});

// Mounted with express.raw() before the app JSON parser. Safepay retries
// webhooks, so fetching the tracker and updating an already-paid record is safe.
export const safepayWebhook = async (req: Request, res: Response) => {
  if (!config.safepayWebhookSecret) return res.status(503).send('Webhook is not configured');
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const signature = req.header('x-sfpy-signature') || '';
  // Safepay signs webhook payloads with the endpoint shared secret. Compare
  // the HMAC in constant time before looking at any payment data.
  const expected = crypto.createHmac('sha512', config.safepayWebhookSecret).update(rawBody).digest('hex');
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).send('Invalid signature');
  }
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid webhook');
  }
  const trackerValue = payload?.notification?.tracker || payload?.data?.tracker?.token || payload?.data?.tracker;
  const tracker = typeof trackerValue === 'string'
    ? trackerValue
    : typeof trackerValue?.token === 'string'
      ? trackerValue.token
      : null;
  if (!tracker || typeof tracker !== 'string') return res.status(400).send('Missing tracker');
  try {
    await updatePaymentFromTracker(tracker);
    return res.status(200).send('ok');
  } catch {
    // A provider or database outage must remain retryable to the webhook
    // sender; a 400 response would misclassify it as a malformed notification.
    return res.status(503).send('Webhook processing temporarily unavailable');
  }
};
export default router;
