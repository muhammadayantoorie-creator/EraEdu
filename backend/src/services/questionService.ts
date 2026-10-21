import { supabase } from '../config/supabase';

export interface CreateQuestionInput {
  topicId: string;
  questionText: string;
  questionType: 'multipleChoice' | 'shortAnswer';
  options?: string[];
  correctAnswer?: number | string;
  correctAnswers?: string[];
  explanation?: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  createdBy: string;
}

function answerIndex(value: unknown, options: string[]): number {
  if (!Array.isArray(options) || options.length < 2 || options.some(option => typeof option !== 'string' || !option.trim())) {
    throw Object.assign(new Error('Multiple-choice questions require at least two non-empty options'), { statusCode: 400 });
  }
  // Current forms submit the canonical option index. Preserve compatibility
  // with the older form, which submitted the selected option's text.
  let index = typeof value === 'number' ? value : typeof value === 'string' ? options.indexOf(value) : -1;
  if (index === -1 && typeof value === 'string' && /^[0-9]+$/.test(value)) index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= options.length) {
    throw Object.assign(new Error('Select a valid correct answer option'), { statusCode: 400 });
  }
  return index;
}

export const questionService = {
  async createQuestion(input: CreateQuestionInput) {
    await this.assertTopicAccess(input.topicId, input.createdBy, 'teacher');
    const isShort = input.questionType === 'shortAnswer';
    const options = isShort ? [] : input.options || [];
    const correctAnswer = isShort ? null : answerIndex(input.correctAnswer, options);
    const { data, error } = await supabase
      .from('questions')
      .insert([{
        topic_id: input.topicId,
        content: input.questionText,
        question_type: input.questionType,
        options,
        correct_answer: correctAnswer,
        correct_answers: input.correctAnswers || [],
        explanation: input.explanation || '',
        difficulty: input.difficulty,
        created_by: input.createdBy
      }])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  },

  async getQuestionsByTopic(topicId: string, requesterId: string, requesterRole: string) {
    await this.assertTopicAccess(topicId, requesterId, requesterRole);
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('topic_id', topicId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data || [];
  },

  async getQuestionById(questionId: string, requesterId?: string, requesterRole?: string) {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('id', questionId)
      .single();

    if (error) throw new Error(error.message);
    if (requesterId && requesterRole) {
      await this.assertTopicAccess(data.topic_id, requesterId, requesterRole);
    }
    return data;
  },

  async assertTopicAccess(topicId: string, requesterId: string, requesterRole: string) {
    if (requesterRole === 'admin') return;

    const { data: topic, error: topicError } = await supabase
      .from('topics')
      .select('course_id')
      .eq('id', topicId)
      .single();
    if (topicError || !topic) throw Object.assign(new Error('Topic not found'), { statusCode: 404 });

    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', topic.course_id)
      .single();
    if (courseError || !course || course.created_by !== requesterId) {
      throw Object.assign(new Error('Not authorized to access questions for this topic'), { statusCode: 403 });
    }
  },

  async updateQuestion(questionId: string, updates: Partial<CreateQuestionInput>, userId: string, requesterRole: string) {
    // First check if user owns this question
    const { data: existing } = await supabase
      .from('questions')
      .select('created_by, question_type, options, correct_answer')
      .eq('id', questionId)
      .single();

    if (!existing) {
      throw Object.assign(new Error('Question not found'), { statusCode: 404 });
    }
    if (requesterRole !== 'admin' && existing.created_by !== userId) {
      throw Object.assign(new Error('You are not authorized to edit this question'), { statusCode: 403 });
    }

    const updateData: any = {};
    if (updates.questionText) updateData.content = updates.questionText;
    if (updates.questionType) updateData.question_type = updates.questionType;
    if (updates.options !== undefined) updateData.options = updates.options;
    const isShort = (updates.questionType || existing.question_type) === 'shortAnswer';
    if (isShort && updates.questionType !== undefined) {
      updateData.correct_answer = null;
      updateData.options = [];
    } else if (!isShort && (updates.correctAnswer !== undefined || updates.options !== undefined || updates.questionType !== undefined)) {
      updateData.correct_answer = answerIndex(updates.correctAnswer ?? existing.correct_answer, updates.options || existing.options || []);
    }
    if (updates.correctAnswers) updateData.correct_answers = updates.correctAnswers;
    if (updates.explanation !== undefined) updateData.explanation = updates.explanation;
    if (updates.difficulty) updateData.difficulty = updates.difficulty;

    const { data, error } = await supabase
      .from('questions')
      .update(updateData)
      .eq('id', questionId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  },

  async deleteQuestion(questionId: string, userId: string, requesterRole: string) {
    // First check if user owns this question
    const { data: existing } = await supabase
      .from('questions')
      .select('created_by')
      .eq('id', questionId)
      .single();

    if (!existing) {
      throw Object.assign(new Error('Question not found'), { statusCode: 404 });
    }
    if (requesterRole !== 'admin' && existing.created_by !== userId) {
      throw Object.assign(new Error('You are not authorized to delete this question'), { statusCode: 403 });
    }

    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', questionId);

    if (error) throw new Error(error.message);
    return { success: true };
  }
};
