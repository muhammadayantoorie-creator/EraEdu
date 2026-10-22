-- Some populated installations predate the submission fields in the baseline.
-- Migration 027's finalizer and the API require them. Preserve existing attempts,
-- including unknown legacy submission provenance; do not infer an old reason.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.quiz_attempts') IS NULL THEN
    RAISE EXCEPTION 'quiz_attempts is missing; review the base schema before migration 032';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.quiz_attempts'::regclass AND NOT attisdropped
      AND ((attname = 'auto_submitted' AND atttypid <> 'boolean'::regtype)
        OR (attname = 'submission_reason' AND atttypid NOT IN ('text'::regtype, 'varchar'::regtype)))
  ) THEN
    RAISE EXCEPTION 'Submission fields have incompatible types; migration 032 made no data conversions';
  END IF;
END $$;

-- Add without a default first so historical rows retain NULL (unknown).
ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS auto_submitted boolean,
  ADD COLUMN IF NOT EXISTS submission_reason varchar(100);
ALTER TABLE public.quiz_attempts ALTER COLUMN auto_submitted SET DEFAULT false;

NOTIFY pgrst, 'reload schema';
COMMIT;
