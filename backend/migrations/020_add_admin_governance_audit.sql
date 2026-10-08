CREATE TABLE IF NOT EXISTS admin_governance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id),
  target_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('suspend', 'restore', 'role_change')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_governance_audit_target_created_idx
  ON admin_governance_audit (target_user_id, created_at DESC);
