-- Provider-neutral access state used after a confirmed payment.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'free';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_subscription_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_subscription_status_check
  CHECK (subscription_status IN ('free', 'active', 'past_due', 'canceled'));

CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);
