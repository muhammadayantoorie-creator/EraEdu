CREATE TABLE IF NOT EXISTS student_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id UUID NOT NULL REFERENCES teacher_quizzes(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  category VARCHAR(40) NOT NULL CHECK (category IN ('overall', 'content', 'usability', 'performance', 'security')),
  liked TEXT,
  improvements TEXT NOT NULL,
  would_recommend BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(attempt_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_feedback_created_at ON student_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_feedback_quiz_id ON student_feedback(quiz_id);

ALTER TABLE student_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON student_feedback FROM anon, authenticated;
