import { supabase } from '../config/supabase';

export interface FeedbackInput {
  attemptId: string;
  rating: number;
  category: 'overall' | 'content' | 'usability' | 'performance' | 'security';
  liked?: string;
  improvements: string;
  wouldRecommend?: boolean;
}

export const feedbackService = {
  async submit(studentId: string, input: FeedbackInput) {
    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('id, user_id, quiz_id, status')
      .eq('id', input.attemptId)
      .single();

    if (attemptError || !attempt) throw Object.assign(new Error('Quiz attempt not found'), { statusCode: 404 });
    if (attempt.user_id !== studentId) throw Object.assign(new Error('You can only review your own quiz attempt'), { statusCode: 403 });
    if (attempt.status !== 'completed') throw Object.assign(new Error('Feedback is available after the quiz is completed'), { statusCode: 400 });

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

    if (error?.code === '23505') throw Object.assign(new Error('Feedback has already been submitted for this attempt'), { statusCode: 409 });
    if (error) throw new Error(error.message);
    return data;
  },

  async getForAdmins(limit = 100) {
    const { data, error } = await supabase
      .from('student_feedback')
      .select('id, rating, category, liked, improvements, would_recommend, created_at, quiz_id, users:student_id(name, email), teacher_quizzes:quiz_id(title)')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));
    if (error) throw new Error(error.message);
    return data || [];
  },
};

