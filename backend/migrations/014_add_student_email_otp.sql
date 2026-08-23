-- Student sign-in OTPs are hashed and short lived. Never store the code itself.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS student_otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS student_otp_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS student_otp_attempts INTEGER NOT NULL DEFAULT 0;
