import { supabase } from '../config/supabase';

export interface FeedbackInput {
  attemptId: string;
  rating: number;
  category: 'overall' | 'content' | 'usability' | 'performance' | 'security';
  liked?: string;
  improvements: string;
  wouldRecommend?: boolean;
}

export const FEEDBACK_SCHEMA_REQUIRED = 'Student feedback storage is unavailable. An administrator must apply or reconcile backend/migrations/009_add_student_feedback.sql.';
const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const categories = new Set(['overall', 'content', 'usability', 'performance', 'security']);
const schemaMissing = (error: any) => ['42P01', '42703', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'].includes(String(error?.code || ''));
const storageError = (error: any, fallback: string): never => {
  if (schemaMissing(error)) throw fail(FEEDBACK_SCHEMA_REQUIRED, 503);
  throw fail(fallback, 503);
};

export const feedbackService = {
  async submit(studentId: string, input: FeedbackInput) {
    if (!input || typeof input.attemptId !== 'string' || !input.attemptId) throw fail('Select a valid exam attempt.', 400);
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw fail('Rating must be between 1 and 5.', 400);
    if (!categories.has(input.category)) throw fail('Select a valid feedback category.', 400);
    if (typeof input.improvements !== 'string' || input.improvements.trim().length < 5 || input.improvements.trim().length > 2000) throw fail('Improvement feedback must be 5 to 2000 characters.', 400);
    if (input.liked !== undefined && (typeof input.liked !== 'string' || input.liked.trim().length > 1000)) throw fail('What worked well must be at most 1000 characters.', 400);
    if (input.wouldRecommend !== undefined && typeof input.wouldRecommend !== 'boolean') throw fail('Choose a valid recommendation answer.', 400);

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('id, user_id, quiz_id, topic_id, status')
      .eq('id', input.attemptId)
      .maybeSingle();

    if (attemptError) throw fail('Unable to verify this exam attempt right now. Please retry.', 503);
    if (!attempt) throw fail('Exam attempt not found', 404);
    if (attempt.user_id !== studentId) throw fail('You can only review your own exam attempt', 403);
    if (attempt.status !== 'completed') throw fail('Feedback is available after the exam is completed', 400);
    if (attempt.topic_id) throw fail('Feedback is currently available for teacher exams only', 400);
    if (!attempt.quiz_id) throw fail('This exam is no longer available for feedback', 409);

    const { data, error } = await supabase.from('student_feedback').insert({
      attempt_id: attempt.id,
      student_id: studentId,
      quiz_id: attempt.quiz_id,
      rating: input.rating,
      category: input.category,
      liked: input.liked?.trim() || null,
      improvements: input.improvements.trim(),
      would_recommend: input.wouldRecommend ?? null,
    }).select('id, created_at').single();

    if (error?.code === '23505') throw fail('Feedback has already been submitted for this attempt', 409);
    if (error?.code === '23503') throw fail('This exam is no longer available for feedback', 409);
    if (error) storageError(error, 'Feedback could not be saved right now. Please retry.');
    if (!data?.id) throw fail('Feedback could not be confirmed right now. Please retry.', 503);
    return data;
  },

  async getForAdmins(limit = 100) {
    const { data, error } = await supabase
      .from('student_feedback')
      .select('id, rating, category, liked, improvements, would_recommend, created_at, quiz_id, users:student_id(name, email), teacher_quizzes:quiz_id(title)')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));
    if (error) storageError(error, 'Student feedback could not be loaded right now. Please retry.');
    return data || [];
  },
};

