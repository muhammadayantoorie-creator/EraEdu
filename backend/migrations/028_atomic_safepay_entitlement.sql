-- Requires 010_add_subscription_status.sql, 013_add_safepay_payments.sql,
-- and 018_share_free_trials_by_institution.sql. Apply before deploying the API
-- that calls apply_verified_safepay_payment.
-- Rollback: stop payment status processing, redeploy a compatible API, then
-- revoke/drop this function. Keep payment history; never revert paid records
-- or entitlements by deleting them.

CREATE OR REPLACE FUNCTION public.apply_verified_safepay_payment(
  p_tracker_token text,
  p_verified_status text,
  p_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment public.safepay_payments%ROWTYPE;
  v_status text;
BEGIN
  IF p_verified_status NOT IN ('pending', 'paid', 'failed', 'cancelled')
     OR p_verified_status IS NULL THEN
    RAISE EXCEPTION 'Invalid verified payment status';
  END IF;

  -- A poll may be scoped to its owning user; a signed webhook passes NULL.
  -- The row lock serializes concurrent polls and webhook retries.
  SELECT * INTO v_payment
  FROM public.safepay_payments
  WHERE tracker_token = p_tracker_token
    AND (p_user_id IS NULL OR user_id = p_user_id)
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Terminal payment records are monotonic. A delayed provider read must not
  -- make a failed/cancelled checkout look pending again, and a later tracker
  -- state must never silently revoke a paid entitlement. Refunds, chargebacks
  -- and expiry need their own explicit, audited policy.
  v_status := CASE
    WHEN v_payment.status IN ('paid', 'failed', 'cancelled') THEN v_payment.status
    ELSE p_verified_status
  END;
  IF v_status = v_payment.status THEN RETURN v_status; END IF;

  IF v_status = 'paid' THEN
    -- The entitlement and the paid marker commit or roll back together. Do
    -- not re-activate an already-paid *monthly* payment on subsequent polls;
    -- that could undo a legitimate later expiry.
    IF v_payment.organization_id IS NOT NULL THEN
      UPDATE public.organizations SET subscription_status = 'active'
      WHERE id = v_payment.organization_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Payment institution not found'; END IF;
    ELSE
      -- Legacy payments predate organization billing.
      UPDATE public.users SET subscription_status = 'active'
      WHERE id = v_payment.user_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Payment account not found'; END IF;
    END IF;
  END IF;

  UPDATE public.safepay_payments
  SET status = v_status,
      paid_at = CASE WHEN v_status = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
      updated_at = now()
  WHERE tracker_token = p_tracker_token;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_verified_safepay_payment(text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_safepay_payment(text, text, uuid)
  TO service_role;
NOTIFY pgrst, 'reload schema';
