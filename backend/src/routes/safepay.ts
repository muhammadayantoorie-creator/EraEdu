import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import Safepay from '@sfpy/node-core';
import { config } from '../config/environment';
import { protect, authorize } from '../middleware/auth';
import { supabase } from '../config/supabase';

const router = Router();

const getClient = () => {
  const isProduction = config.safepayEnvironment === 'production';
  return new Safepay(config.safepaySecretKey, {
    authType: 'secret',
    host: isProduction ? 'https://api.getsafepay.com' : 'https://sandbox.api.getsafepay.com',
  });
};

const updatePaymentFromTracker = async (trackerToken: string, userId?: string) => {
  const query = supabase.from('safepay_payments').select('tracker_token, user_id, status').eq('tracker_token', trackerToken);
  const { data: payment, error } = userId ? await query.eq('user_id', userId).maybeSingle() : await query.maybeSingle();
  if (error) throw error;
  if (!payment) return null;

  const report: any = await getClient().reporter.payments.fetch(trackerToken);
  const isPaid = report?.data?.tracker?.state === 'TRACKER_ENDED';
  if (isPaid && payment.status !== 'paid') {
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('safepay_payments')
      .update({ status: 'paid', paid_at: now, updated_at: now })
      .eq('tracker_token', trackerToken);
    if (updateError) throw updateError;
    // This is a one-time Educator purchase. A later recurring plan can replace
    // this field with its own entitlement dates without changing payment history.
    const { error: userError } = await supabase.from('users').update({ subscription_status: 'active' }).eq('id', payment.user_id);
    if (userError) throw userError;
  }
  return { status: isPaid ? 'paid' : payment.status };
};

router.post('/checkout', protect, authorize('teacher'), async (req, res) => {
  if (!config.safepaySecretKey || !config.safepayPublicKey) return res.status(503).json({ success: false, error: { message: 'Safepay is not configured.' } });
  try {
    const env = config.safepayEnvironment === 'production' ? 'production' : 'sandbox';
    const client = getClient();
    const payment: any = await client.payments.session.setup({ merchant_api_key: config.safepayPublicKey, intent: 'CYBERSOURCE', mode: 'payment', entry_mode: 'raw', currency: 'PKR', amount: Math.round(config.safepayEducatorPricePkr * 100), metadata: { order_id: `educator-${req.user!._id}` }, include_fees: false } as any);
    const passport: any = await client.client.passport.create();
    // The profile page polls Safepay with the tracker after checkout. Include
    // it in the return URL so a completed payment can activate the educator
    // subscription without relying solely on an asynchronous webhook.
    const url = client.checkout.createCheckoutUrl({ env, tracker: payment.data.tracker.token, tbt: passport.data, source: 'hosted', redirect_url: `${config.frontendAppUrl}/profile?tracker=${encodeURIComponent(payment.data.tracker.token)}`, cancel_url: `${config.frontendAppUrl}/#pricing` });
    const { error: saveError } = await supabase.from('safepay_payments').insert({
      tracker_token: payment.data.tracker.token,
      user_id: req.user!._id,
      plan: 'educator',
      amount: Math.round(config.safepayEducatorPricePkr * 100),
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

// Mounted with express.raw() before the app JSON parser. Safepay retries
// webhooks, so fetching the tracker and updating an already-paid record is safe.
export const safepayWebhook = async (req: Request, res: Response) => {
  if (!config.safepayWebhookSecret) return res.status(503).send('Webhook is not configured');
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature = req.header('x-sfpy-signature') || '';
    // Safepay signs webhook payloads with the endpoint shared secret. Compare
    // the HMAC in constant time before looking at any payment data.
    const expected = crypto.createHmac('sha512', config.safepayWebhookSecret).update(rawBody).digest('hex');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(401).send('Invalid signature');
    }
    const payload = JSON.parse(rawBody.toString('utf8'));
    const tracker = payload?.notification?.tracker || payload?.data?.tracker?.token;
    if (!tracker || typeof tracker !== 'string') return res.status(400).send('Missing tracker');
    await updatePaymentFromTracker(tracker);
    return res.status(200).send('ok');
  } catch {
    return res.status(400).send('Invalid webhook');
  }
};
export default router;
