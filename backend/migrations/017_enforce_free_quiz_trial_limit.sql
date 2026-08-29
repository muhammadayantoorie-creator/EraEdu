-- Each educator receives five free assessment creations. Paid subscriptions
-- remain unlimited. The trigger is the authority so the limit cannot be
-- bypassed through a modified client or concurrent create requests.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS free_assessment_trials_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_free_assessment_trials_used_check;

ALTER TABLE users
  ADD CONSTRAINT users_free_assessment_trials_used_check
  CHECK (free_assessment_trials_used BETWEEN 0 AND 5);

-- Count existing free teachers' assessments before turning the rule on.
UPDATE users AS user_record
SET free_assessment_trials_used = LEAST(
  5,
  COALESCE((
    SELECT COUNT(*)::INTEGER
    FROM teacher_quizzes AS quiz_record
    WHERE quiz_record.teacher_id = user_record.id::TEXT
  ), 0)
)
WHERE user_record.subscription_status <> 'active';

CREATE OR REPLACE FUNCTION enforce_free_assessment_trial_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_subscription TEXT;
BEGIN
  SELECT subscription_status
  INTO current_subscription
  FROM users
  WHERE id::TEXT = NEW.teacher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher account was not found.';
  END IF;

  -- An active paid subscription has no assessment creation limit.
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
