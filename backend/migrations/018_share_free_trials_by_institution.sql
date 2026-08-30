-- The five free assessment creations belong to an institution, not to each
-- teacher.  An organization is the institution workspace in EraEdu.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS free_assessment_trials_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'free';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_free_assessment_trials_used_check,
  DROP CONSTRAINT IF EXISTS organizations_subscription_status_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_free_assessment_trials_used_check
    CHECK (free_assessment_trials_used BETWEEN 0 AND 5),
  ADD CONSTRAINT organizations_subscription_status_check
    CHECK (subscription_status IN ('free', 'active', 'past_due', 'canceled'));

-- Preserve Institution plans purchased before billing was associated directly
-- with the organization. Those plans were recorded on the workspace owner.
UPDATE organizations AS organization_record
SET subscription_status = 'active'
FROM users AS owner_record
WHERE owner_record.id = organization_record.owner_id
  AND owner_record.subscription_status = 'active';

-- Count existing quizzes once for the organization containing their teacher.
-- This is intentionally capped because the counter only controls the free tier.
UPDATE organizations AS organization_record
SET free_assessment_trials_used = LEAST(
  5,
  COALESCE((
    SELECT COUNT(*)::INTEGER
    FROM teacher_quizzes AS quiz_record
    JOIN organization_members AS member_record
      ON member_record.user_id::TEXT = quiz_record.teacher_id
    WHERE member_record.organization_id = organization_record.id
  ), 0)
)
WHERE organization_record.subscription_status <> 'active';

-- Safepay payments made from an organization owner now activate the organization.
ALTER TABLE safepay_payments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_safepay_payments_organization_id
  ON safepay_payments(organization_id);

UPDATE safepay_payments AS payment_record
SET organization_id = (
  SELECT organization_record.id
  FROM organizations AS organization_record
  WHERE organization_record.owner_id = payment_record.user_id
  ORDER BY organization_record.created_at ASC
  LIMIT 1
)
WHERE payment_record.organization_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM organizations AS organization_record
    WHERE organization_record.owner_id = payment_record.user_id
  );

CREATE OR REPLACE FUNCTION enforce_free_assessment_trial_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  organization_record organizations%ROWTYPE;
  current_subscription TEXT;
BEGIN
  -- A teacher's earliest organization membership identifies the institution
  -- that owns the shared allowance. The API uses the same ordering.
  SELECT organization.*
  INTO organization_record
  FROM organization_members AS membership
  JOIN organizations AS organization ON organization.id = membership.organization_id
  WHERE membership.user_id::TEXT = NEW.teacher_id
  ORDER BY membership.created_at ASC
  LIMIT 1
  FOR UPDATE OF organization;

  IF FOUND THEN
    IF organization_record.subscription_status = 'active' THEN
      RETURN NEW;
    END IF;

    UPDATE organizations
    SET free_assessment_trials_used = free_assessment_trials_used + 1
    WHERE id = organization_record.id
      AND free_assessment_trials_used < 5;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'FREE_ASSESSMENT_TRIAL_LIMIT_REACHED';
    END IF;

    RETURN NEW;
  END IF;

  -- Independent teachers without an institution retain the legacy allowance.
  -- Institution members always use the organization-wide allowance above.
  SELECT subscription_status
  INTO current_subscription
  FROM users
  WHERE id::TEXT = NEW.teacher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher account was not found.';
  END IF;

  IF current_subscription = 'active' THEN
    RETURN NEW;
  END IF;

  UPDATE users
  SET free_assessment_trials_used = free_assessment_trials_used + 1
  WHERE id::TEXT = NEW.teacher_id
    AND free_assessment_trials_used < 5;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FREE_ASSESSMENT_TRIAL_LIMIT_REACHED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_free_assessment_trial_limit_on_create ON teacher_quizzes;

CREATE TRIGGER enforce_free_assessment_trial_limit_on_create
BEFORE INSERT ON teacher_quizzes
FOR EACH ROW
EXECUTE FUNCTION enforce_free_assessment_trial_limit();
