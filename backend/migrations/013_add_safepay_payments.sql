-- Stores only Safepay tracker tokens and payment state. Card details never
-- reach the EraEdu server because checkout is hosted by Safepay.
CREATE TABLE IF NOT EXISTS safepay_payments (
  tracker_token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'educator',
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safepay_payments_user_id ON safepay_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_safepay_payments_status ON safepay_payments(status);
