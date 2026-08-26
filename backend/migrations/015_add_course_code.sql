-- Adds course join codes for databases created before this field existed.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS course_code VARCHAR(10);

CREATE UNIQUE INDEX IF NOT EXISTS courses_course_code_unique
  ON courses (course_code)
  WHERE course_code IS NOT NULL;
