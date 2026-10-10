import { supabase } from '../config/supabase';
import { emailService } from './emailService';

function isMissingColumnError(err: any, column: string): boolean {
  if (!err) return false;
  const haystack = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return ((err.code === '42703' || err.code === 'PGRST204') && haystack.includes(column.toLowerCase()))
    || haystack.includes(`column "${column}"`)
    || haystack.includes(`column ${column} does not exist`)
    // Supabase/PostgREST schema-cache errors use this wording and code
    // PGRST204 instead of PostgreSQL's normal 42703 code.
    || haystack.includes(`'${column}' column`)
    || haystack.includes(`could not find the '${column}'`);
}

function courseError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function parseCourseCapacity(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  const validString = typeof value === 'string' && /^[0-9]+$/.test(value.trim());
  if (typeof value !== 'number' && !validString) {
    throw courseError('Max students must be a positive whole number, or blank for unlimited.', 400);
  }
  const capacity = Number(value);
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 2147483647) {
    throw courseError('Max students must be a positive whole number, or blank for unlimited.', 400);
  }
  return capacity;
}

function requireCapacityColumn(course: any): void {
  if (course && course.max_students === undefined) {
    throw courseError('Course capacity schema is missing. Apply migrations 006_add_course_capacity.sql and 023_enforce_course_capacity_atomically.sql.', 503);
  }
}

async function enrollCourseAtomically(courseId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('enroll_course_with_capacity', {
    p_course_id: courseId,
    p_user_id: userId,
  });
  if (error) {
    if (isMissingColumnError(error, 'max_students')) {
      throw courseError('Course capacity schema is missing. Apply migrations 006_add_course_capacity.sql and 023_enforce_course_capacity_atomically.sql.', 503);
    }
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw courseError('Atomic enrollment is unavailable. Apply migration 023_enforce_course_capacity_atomically.sql.', 503);
    }
    if (error.message === 'Course not found') throw courseError(error.message, 404);
    if (error.message === 'This course is full. Please contact your teacher.') throw courseError(error.message, 409);
    if (error.message.startsWith('Invalid course capacity.')) throw courseError(error.message, 503);
    throw new Error(error.message);
  }
  if (typeof data !== 'boolean') throw new Error('Atomic enrollment returned an invalid result');
  return data;
}

export const courseService = {
  async getAllCourses(filters: any = {}) {
    let query = supabase.from('courses').select('*');

    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.difficulty) {
      query = query.eq('difficulty', filters.difficulty);
    }
    if (filters.search) {
      query = query.ilike('title', `%${filters.search}%`);
    }

    const { data: courses, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return Promise.all(
      (courses || []).map(async (course: any) => {
        const { count } = await supabase
          .from('enrollments')
          .select('*', { count: 'exact', head: true })
          .eq('course_id', course.id);
        requireCapacityColumn(course);
        return {
          ...course,
          _id: course.id,
          maxStudents: course.max_students ?? null,
          enrollmentCount: count || 0,
        };
      })
    );
  },

  async getCourseById(courseId: string) {
    const { data: course, error } = await supabase
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .single();

    if (error) {
      throw new Error('Course not found');
    }

    requireCapacityColumn(course);
    return { ...course, _id: course.id, maxStudents: course.max_students };
  },

  async enrollCourse(userId: string, courseId: string) {
    const created = await enrollCourseAtomically(courseId, userId);
    if (!created) return { message: 'Already enrolled' };

    // Fetch user and course details for email
    const { data: user } = await supabase.from('users').select('email, name').eq('id', userId).single();
    const { data: course } = await supabase.from('courses').select('title').eq('id', courseId).single();

    if (user && course) {
      await emailService.sendCourseEnrollmentEmail(user.email, user.name, course.title);
    }

    return { message: 'Enrolled successfully' };
  },

  async getEnrolledCourses(userId: string) {
    const { data: enrollments, error } = await supabase
      .from('enrollments')
      .select('course_id, courses(*)')
      .eq('user_id', userId);

    if (error) {
      throw new Error(error.message);
    }

    return enrollments.map((e: any) => ({ ...e.courses, _id: e.courses.id }));
  },

  // ============ Teacher Course Management ============

  async generateUniqueCourseCode(): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    let attempts = 0;
    while (attempts < 20) {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const { data: existing } = await supabase
        .from('courses')
        .select('id')
        .eq('course_code', code)
        .single();
      if (!existing) return code;
      attempts++;
    }
    return code;
  },

  async enrollByCourseCode(userId: string, courseCode: string) {
    // Find the course by code
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, title')
      .eq('course_code', courseCode.toUpperCase())
      .single();

    if (courseError || !course) {
      throw new Error('Invalid course code. Please check and try again.');
    }

    const created = await enrollCourseAtomically(course.id, userId);
    if (!created) {
      return { message: 'Already enrolled in this course', course: { _id: course.id, title: course.title } };
    }

    // Send enrollment email
    const { data: user } = await supabase.from('users').select('email, name').eq('id', userId).single();
    if (user) {
      await emailService.sendCourseEnrollmentEmail(user.email, user.name, course.title);
    }

    return { message: 'Enrolled successfully', course: { _id: course.id, title: course.title } };
  },

  async createCourse(teacherId: string, courseData: any) {
    const capacity = parseCourseCapacity(courseData.maxStudents) ?? null;
    const courseCode = await this.generateUniqueCourseCode();

    const insertData: any = {
      title: courseData.title,
      description: courseData.description || '',
      category: courseData.category || 'Other',
      difficulty: courseData.difficulty || 'Beginner',
      created_by: teacherId,
      course_code: courseCode,
    };
    insertData.max_students = capacity;

    let insertResult: any = await supabase
      .from('courses')
      .insert([insertData])
      .select()
      .single();

    if (insertResult.error && isMissingColumnError(insertResult.error, 'max_students')) {
      throw courseError('Course capacity schema is missing. Apply migrations 006_add_course_capacity.sql and 023_enforce_course_capacity_atomically.sql.', 503);
    }

    if (insertResult.error && isMissingColumnError(insertResult.error, 'course_code')) {
      throw courseError('Course code schema is missing. Apply migration 015_add_course_code.sql.', 503);
    }

    const { data: course, error } = insertResult;
    if (error) {
      console.error('Supabase error creating course:', error);
      throw new Error(error.message);
    }

    requireCapacityColumn(course);
    return { ...course, _id: course.id, createdBy: course.created_by, courseCode: course.course_code || null, maxStudents: course.max_students };
  },

  async updateCourse(teacherId: string, courseId: string, courseData: any) {
    // Verify ownership
    const { data: existing } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', courseId)
      .single();

    if (!existing || existing.created_by !== teacherId) {
      throw courseError('Not authorized to update this course', 403);
    }

    const updatePayload: any = {
      title: courseData.title,
      description: courseData.description,
      category: courseData.category,
      difficulty: courseData.difficulty,
    };
    const capacity = parseCourseCapacity(courseData.maxStudents);
    if (capacity !== undefined) updatePayload.max_students = capacity;

    let updateResult = await supabase
      .from('courses')
      .update(updatePayload)
      .eq('id', courseId)
      .select()
      .single();

    if (updateResult.error && isMissingColumnError(updateResult.error, 'max_students')) {
      throw courseError('Course capacity schema is missing. Apply migrations 006_add_course_capacity.sql and 023_enforce_course_capacity_atomically.sql.', 503);
    }

    const { data: course, error } = updateResult;
    if (error) {
      throw new Error(error.message);
    }

    requireCapacityColumn(course);
    return { ...course, _id: course.id, createdBy: course.created_by, maxStudents: course.max_students };
  },

  async deleteCourse(teacherId: string, courseId: string) {
    // Verify ownership
    const { data: existing } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', courseId)
      .single();

    if (!existing || existing.created_by !== teacherId) {
      throw courseError('Not authorized to delete this course', 403);
    }

    const { error } = await supabase
      .from('courses')
      .delete()
      .eq('id', courseId);

    if (error) {
      throw new Error(error.message);
    }

    return { message: 'Course deleted successfully' };
  },

  // ============ Topic Management ============

  async getTopicById(courseId: string, topicId: string, userId: string, role: string) {
    const fail = (message: string, statusCode: number): never => {
      const error: any = new Error(message);
      error.statusCode = statusCode;
      throw error;
    };

    const { data: topic, error: topicError } = await supabase
      .from('topics')
      .select('*')
      .eq('id', topicId)
      .eq('course_id', courseId)
      .maybeSingle();
    if (topicError) throw new Error(topicError.message);
    if (!topic) return fail('Topic not found in this course', 404);

    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', courseId)
      .maybeSingle();
    if (courseError) throw new Error(courseError.message);
    if (!course) return fail('Course not found', 404);

    if (role !== 'admin' && course.created_by !== userId) {
      if (role !== 'student') return fail('Not authorized to study this topic', 403);
      const { data: enrollment, error: enrollmentError } = await supabase
        .from('enrollments')
        .select('course_id')
        .eq('course_id', courseId)
        .eq('user_id', userId)
        .maybeSingle();
      if (enrollmentError) throw new Error(enrollmentError.message);
      if (!enrollment) return fail('Enroll in this course to study its topics', 403);
    }

    return { ...topic, _id: topic.id, courseId: topic.course_id };
  },

  async getTopicsByCourse(courseId: string) {
    const { data: topics, error } = await supabase
      .from('topics')
      .select('*')
      .eq('course_id', courseId)
      .order('order', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return topics.map(t => ({ ...t, _id: t.id }));
  },

  async createTopic(teacherId: string, topicData: any) {
    // Verify course ownership
    const { data: course } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', topicData.courseId)
      .single();

    if (!course || course.created_by !== teacherId) {
      throw courseError('Not authorized to add topics to this course', 403);
    }

    // Get next order number
    const { data: existingTopics } = await supabase
      .from('topics')
      .select('order')
      .eq('course_id', topicData.courseId)
      .order('order', { ascending: false })
      .limit(1);

    const nextOrder = existingTopics && existingTopics.length > 0 ? existingTopics[0].order + 1 : 1;

    const { data: topic, error } = await supabase
      .from('topics')
      .insert([{
        title: topicData.title,
        description: topicData.description,
        course_id: topicData.courseId,
        order: topicData.order || nextOrder,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return { ...topic, _id: topic.id };
  },

  async updateTopic(teacherId: string, topicId: string, topicData: any) {
    // Get topic and verify course ownership
    const { data: topic } = await supabase
      .from('topics')
      .select('course_id')
      .eq('id', topicId)
      .single();

    if (!topic) {
      throw new Error('Topic not found');
    }

    const { data: course } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', topic.course_id)
      .single();

    if (!course || course.created_by !== teacherId) {
      throw courseError('Not authorized to update this topic', 403);
    }

    const { data: updated, error } = await supabase
      .from('topics')
      .update({
        title: topicData.title,
        description: topicData.description,
        order: topicData.order,
        updated_at: new Date().toISOString(),
      })
      .eq('id', topicId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return { ...updated, _id: updated.id };
  },

  async deleteTopic(teacherId: string, topicId: string) {
    // Get topic and verify course ownership
    const { data: topic } = await supabase
      .from('topics')
      .select('course_id')
      .eq('id', topicId)
      .single();

    if (!topic) {
      throw new Error('Topic not found');
    }

    const { data: course } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', topic.course_id)
      .single();

    if (!course || course.created_by !== teacherId) {
      throw courseError('Not authorized to delete this topic', 403);
    }

    const { error } = await supabase
      .from('topics')
      .delete()
      .eq('id', topicId);

    if (error) {
      throw new Error(error.message);
    }

    return { message: 'Topic deleted successfully' };
  },

  // ============ Question Management ============

  async getQuestionsByTopic(topicId: string, requesterId: string, requesterRole: string) {
    if (requesterRole !== 'admin') {
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
    }

    const { data: questions, error } = await supabase
      .from('questions')
      .select('*')
      .eq('topic_id', topicId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return questions.map(q => ({
      _id: q.id,
      text: q.content || q.question_text,
      options: q.options || [],
      correctAnswer: q.correct_answer,
      difficulty: q.difficulty,
      topicId: q.topic_id,
      explanation: q.explanation,
    }));
  },

  async createQuestion(teacherId: string, questionData: any) {
    let topicId: string | null = questionData.topicId || null;

    if (topicId) {
      const { data: topic } = await supabase
        .from('topics')
        .select('course_id')
        .eq('id', topicId)
        .single();

      if (!topic) {
        throw new Error('Topic not found');
      }

      const { data: course } = await supabase
        .from('courses')
        .select('created_by')
        .eq('id', topic.course_id)
        .single();

      if (!course || course.created_by !== teacherId) {
        throw courseError('Not authorized to add questions to this topic', 403);
      }
    }

    const { data: question, error } = await supabase
      .from('questions')
      .insert([{
        content: questionData.text,
        question_text: questionData.text,
        options: questionData.options || [],
        correct_answer: questionData.correctAnswer ?? null,
        correct_answers: questionData.answerText ? [questionData.answerText] : (questionData.correctAnswers || []),
        question_type: questionData.questionType || (questionData.answerText ? 'shortAnswer' : 'multipleChoice'),
        difficulty: questionData.difficulty,
        topic_id: topicId,
        explanation: questionData.explanation,
        created_by: teacherId,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return {
      _id: question.id,
      text: question.content || question.question_text,
      options: question.options,
      correctAnswer: question.correct_answer,
      answerText: question.correct_answers?.[0] || '',
      difficulty: question.difficulty,
      topicId: question.topic_id,
      explanation: question.explanation,
    };
  },

  async updateQuestion(teacherId: string, questionId: string, questionData: any) {
    // Get question and verify ownership
    const { data: question } = await supabase
      .from('questions')
      .select('topic_id, created_by')
      .eq('id', questionId)
      .single();

    if (!question) {
      throw new Error('Question not found');
    }

    if (question.topic_id) {
      const { data: topic } = await supabase
        .from('topics')
        .select('course_id')
        .eq('id', question.topic_id)
        .single();

      if (!topic) {
        throw new Error('Topic not found');
      }

      const { data: course } = await supabase
        .from('courses')
        .select('created_by')
        .eq('id', topic.course_id)
        .single();

      if (!course || course.created_by !== teacherId) {
        throw courseError('Not authorized to update this question', 403);
      }
    } else if (question.created_by !== teacherId) {
      throw courseError('Not authorized to update this question', 403);
    }

    const { data: updated, error } = await supabase
      .from('questions')
      .update({
        content: questionData.text,
        question_text: questionData.text,
        options: questionData.options || [],
        correct_answer: questionData.correctAnswer ?? null,
        correct_answers: questionData.answerText ? [questionData.answerText] : (questionData.correctAnswers || []),
        question_type: questionData.questionType || (questionData.answerText ? 'shortAnswer' : 'multipleChoice'),
        difficulty: questionData.difficulty,
        explanation: questionData.explanation,
        updated_at: new Date().toISOString(),
      })
      .eq('id', questionId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return {
      _id: updated.id,
      text: updated.content || updated.question_text,
      options: updated.options,
      correctAnswer: updated.correct_answer,
      answerText: updated.correct_answers?.[0] || '',
      difficulty: updated.difficulty,
      topicId: updated.topic_id,
      explanation: updated.explanation,
    };
  },

  async deleteQuestion(teacherId: string, questionId: string) {
    // Get question and verify ownership
    const { data: question } = await supabase
      .from('questions')
      .select('topic_id, created_by')
      .eq('id', questionId)
      .single();

    if (!question) {
      throw new Error('Question not found');
    }

    if (question.topic_id) {
      const { data: topic } = await supabase
        .from('topics')
        .select('course_id')
        .eq('id', question.topic_id)
        .single();

      if (!topic) {
        throw new Error('Topic not found');
      }

      const { data: course } = await supabase
        .from('courses')
        .select('created_by')
        .eq('id', topic.course_id)
        .single();

      if (!course || course.created_by !== teacherId) {
        throw courseError('Not authorized to delete this question', 403);
      }
    } else if (question.created_by !== teacherId) {
      throw courseError('Not authorized to delete this question', 403);
    }

    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', questionId);

    if (error) {
      throw new Error(error.message);
    }

    return { message: 'Question deleted successfully' };
  },

  // ============ Teacher Data Fetching ============

  async getTeacherCourses(teacherId: string) {
    try {
      const { data: courses, error } = await supabase
        .from('courses')
        .select('*')
        .eq('created_by', teacherId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Add enrollment count and topic count for each course
      const coursesWithStats = await Promise.all(
        (courses || []).map(async (course: any) => {
          requireCapacityColumn(course);
          const { count: enrollmentCount } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', course.id);

          const { data: topics } = await supabase
            .from('topics')
            .select('id')
            .eq('course_id', course.id);

          return {
            _id: course.id,
            title: course.title,
            description: course.description,
            category: course.category,
            difficulty: course.difficulty,
            courseCode: course.course_code,
            topics: topics?.map((t: any) => t.id) || [],
            createdBy: course.created_by,
            enrollmentCount: enrollmentCount || 0,
            maxStudents: course.max_students ?? null,
            avgScore: 0,
          };
        })
      );

      return coursesWithStats;
    } catch (e) {
      console.error('Error fetching teacher courses:', e);
      throw e;
    }
  },

  async getTeacherTopics(teacherId: string) {
    try {
      // Get teacher's courses first
      const { data: courses } = await supabase
        .from('courses')
        .select('id, title')
        .eq('created_by', teacherId);

      const courseIds = courses?.map((c: any) => c.id) || [];
      const courseMap = new Map(courses?.map((c: any) => [c.id, c.title]) || []);

      if (courseIds.length === 0) return [];

      // Get topics for these courses
      const { data: topics, error } = await supabase
        .from('topics')
        .select('*')
        .in('course_id', courseIds)
        .order('order', { ascending: true });

      if (error) throw error;

      // Add question count for each topic
      const topicsWithStats = await Promise.all(
        (topics || []).map(async (topic: any) => {
          const { count } = await supabase
            .from('questions')
            .select('*', { count: 'exact', head: true })
            .eq('topic_id', topic.id);

          return {
            _id: topic.id,
            title: topic.title,
            description: topic.description,
            courseId: topic.course_id,
            order: topic.order,
            courseName: courseMap.get(topic.course_id) || 'Unknown',
            questionCount: count || 0,
          };
        })
      );

      return topicsWithStats;
    } catch (e) {
      console.error('Error fetching teacher topics:', e);
      throw e;
    }
  },

  async getTeacherQuestions(teacherId: string) {
    try {
      // Get teacher's topics first
      const topics = await this.getTeacherTopics(teacherId);
      const topicIds = topics.map((t: any) => t._id);
      const topicMap = new Map(topics.map((t: any) => [t._id, { name: t.title, course: t.courseName, courseId: t.courseId }]));

      let topicQuestions: any[] = [];
      if (topicIds.length > 0) {
        const { data: questions, error } = await supabase
          .from('questions')
          .select('*')
          .in('topic_id', topicIds)
          .order('created_at', { ascending: false });

        if (error) throw error;
        topicQuestions = questions || [];
      }

      const { data: standaloneQuestions, error: standaloneError } = await supabase
        .from('questions')
        .select('*')
        .eq('created_by', teacherId)
        .is('topic_id', null)
        .order('created_at', { ascending: false });

      if (standaloneError) throw standaloneError;

      const combinedQuestions = [...topicQuestions, ...(standaloneQuestions || [])]
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return combinedQuestions.map((q: any) => ({
        _id: q.id,
        text: q.content || q.question_text,
        options: q.options || [],
        correctAnswer: q.correct_answer,
        answerText: q.correct_answers?.[0] || '',
        questionType: q.question_type || 'multipleChoice',
        createdBy: q.created_by,
        timeLimit: Number.isInteger(q.time_limit) && q.time_limit > 0 ? q.time_limit : 60,
        difficulty: q.difficulty,
        topicId: q.topic_id,
        courseId: q.topic_id ? topicMap.get(q.topic_id)?.courseId : null,
        explanation: q.explanation,
        topicName: q.topic_id ? (topicMap.get(q.topic_id)?.name || 'Unknown') : 'Standalone',
        courseName: q.topic_id ? (topicMap.get(q.topic_id)?.course || 'Unknown') : 'Direct Question',
      }));
    } catch (e) {
      console.error('Error fetching teacher questions:', e);
      throw e;
    }
  },
};
