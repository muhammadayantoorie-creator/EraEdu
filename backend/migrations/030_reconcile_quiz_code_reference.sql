-- Current code management creates credentials for teacher_quizzes, not quizzes.
-- The old bootstrap declared this table twice; CREATE IF NOT EXISTS preserved
-- its first (topic-quiz) FK. Keep all records and refuse ambiguous legacy data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.teacher_quizzes IN SHARE MODE;
LOCK TABLE public.quiz_codes IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE key_column smallint; existing_fk record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.quiz_codes code_row
    WHERE code_row.quiz_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.teacher_quizzes exam WHERE exam.id = code_row.quiz_id
    )
  ) THEN
    RAISE EXCEPTION 'Migration 030 requires review of legacy quiz codes that do not reference a teacher exam. Run backend/scripts/preflight-runtime-reconciliation.sql. No codes were deleted or relinked.';
  END IF;
  SELECT attnum INTO key_column FROM pg_attribute
    WHERE attrelid = 'public.quiz_codes'::regclass AND attname = 'quiz_id' AND NOT attisdropped;
  FOR existing_fk IN SELECT conname, confrelid, conkey FROM pg_constraint
    WHERE conrelid = 'public.quiz_codes'::regclass AND contype = 'f' AND key_column = ANY(conkey)
  LOOP
    IF existing_fk.conkey <> ARRAY[key_column]::smallint[]
      OR existing_fk.confrelid NOT IN ('public.quizzes'::regclass, 'public.teacher_quizzes'::regclass) THEN
      RAISE EXCEPTION 'Unexpected quiz-code foreign key. Review its definition before migration 030; no constraints or records have been changed.';
    END IF;
    EXECUTE format('ALTER TABLE public.quiz_codes DROP CONSTRAINT %I', existing_fk.conname);
  END LOOP;
END $$;

ALTER TABLE public.quiz_codes ADD CONSTRAINT quiz_codes_quiz_id_fkey
  FOREIGN KEY (quiz_id) REFERENCES public.teacher_quizzes(id) ON DELETE CASCADE;
NOTIFY pgrst, 'reload schema';
COMMIT;
