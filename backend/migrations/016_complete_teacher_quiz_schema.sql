-- Ensures older databases have every field required to create a course-linked quiz.
ALTER TABLE teacher_quizzes
  ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS camera_monitoring BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS violation_limit INTEGER NOT NULL DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_teacher_quizzes_course_id
  ON teacher_quizzes(course_id);

ALTER TABLE teacher_quizzes
  DROP CONSTRAINT IF EXISTS teacher_quizzes_violation_limit_check;

ALTER TABLE teacher_quizzes
  ADD CONSTRAINT teacher_quizzes_violation_limit_check
  CHECK (violation_limit BETWEEN 1 AND 100);
