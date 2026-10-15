-- Additive repair for deployments missing 008, or where ADD COLUMN IF NOT
-- EXISTS skipped a pre-existing nullable/default-less boolean column.
-- Never infer that an unknown legacy account is active. If NULL rows exist,
-- this transaction fails without changing them. Review those IDs privately,
-- resolve their status explicitly, then rerun. See docs/ACCOUNT_STATUS_REPAIR.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'is_suspended' AND data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION 'Account status must be boolean. Review the legacy schema before applying migration 029.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE is_suspended IS NULL) THEN
    RAISE EXCEPTION 'Unknown legacy account statuses exist. Review and explicitly resolve NULL is_suspended values before rerunning migration 029. No account statuses were changed.';
  END IF;
END $$;

ALTER TABLE public.users ALTER COLUMN is_suspended SET DEFAULT false;
ALTER TABLE public.users ALTER COLUMN is_suspended SET NOT NULL;
NOTIFY pgrst, 'reload schema';
COMMIT;
