-- Teacher-configurable number of integrity violations allowed per quiz.
-- Reaching the limit automatically completes the active attempt.
ALTER TABLE teacher_quizzes
  ADD COLUMN IF NOT EXISTS violation_limit integer NOT NULL DEFAULT 3;

ALTER TABLE teacher_quizzes
  DROP CONSTRAINT IF EXISTS teacher_quizzes_violation_limit_check;

ALTER TABLE teacher_quizzes
  ADD CONSTRAINT teacher_quizzes_violation_limit_check
  CHECK (violation_limit BETWEEN 1 AND 100);

