import { supabase } from '../config/supabase';

// Page through PostgREST results so a teacher with more than the default row
// limit still gets an exact, course-scoped unique learner count.
async function readAllRows(table: string, columns: string, filter: (query: any) => any): Promise<any[]> {
  const pageSize = 500;
  const rows: any[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await filter(supabase.from(table).select(columns))
      .order('id', { ascending: true }).range(start, start + pageSize - 1);
    if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`Failed to load ${table}: no rows returned`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export const analyticsService = {
  async getDashboardStats(userId: string) {
    let coursesEnrolled = 0;
    let quizzesCompleted = 0;
    let averageScore = 0;
    const streakDays = 0;

    try {
      const { count } = await supabase
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      coursesEnrolled = count || 0;
    } catch (e) {
      console.error('Error fetching enrollments:', e);
    }

    try {
      const { count } = await supabase
        .from('quiz_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'completed');
      quizzesCompleted = count || 0;
    } catch (e) {
      console.error('Error fetching quiz attempts:', e);
    }

    try {
      const { data: attempts } = await supabase
        .from('quiz_attempts')
        .select('score, max_score')
        .eq('user_id', userId)
        .eq('status', 'completed');

      if (attempts && attempts.length > 0) {
        const total = attempts.reduce((sum: number, a: any) => {
          return sum + (a.max_score > 0 ? (a.score / a.max_score) * 100 : 0);
        }, 0);
        averageScore = Math.round(total / attempts.length);
      }
    } catch (e) {
      console.error('Error calculating average score:', e);
    }

    return { coursesEnrolled, quizzesCompleted, averageScore, streakDays };
  },

  // ============ Teacher Analytics ============

  async getTeacherStudentSummary(teacherId: string) {
    const courses = await readAllRows('courses', 'id', query => query.eq('created_by', teacherId));
    const courseIds = courses.map((course: any) => course.id);
    if (courseIds.some((id: unknown) => typeof id !== 'string' || !id)) throw new Error('Course IDs are missing from teacher analytics');
    const students = new Set<string>();
    let activeEnrollments = 0;
    for (let start = 0; start < courseIds.length; start += 100) {
      const enrollments = await readAllRows('enrollments', 'id, user_id', query => query.in('course_id', courseIds.slice(start, start + 100)));
      for (const enrollment of enrollments) {
        if (typeof enrollment.user_id !== 'string' || !enrollment.user_id) throw new Error('Student IDs are missing from enrollments');
        students.add(enrollment.user_id);
        activeEnrollments += 1;
      }
    }
    return { courseIds, totalCourses: courseIds.length, totalStudents: students.size, activeEnrollments };
  },

  async getTeacherStats(teacherId: string) {
    const { courseIds, totalCourses, totalStudents, activeEnrollments } = await this.getTeacherStudentSummary(teacherId);
    let totalQuestions = 0;
    let totalTopics = 0;
    let avgStudentScore = 0;

    const { data: quizzes, error: quizzesError } = await supabase.from('teacher_quizzes').select('id').eq('teacher_id', teacherId);
    if (quizzesError) throw new Error(`Failed to load teacher exams: ${quizzesError.message}`);
    if (!Array.isArray(quizzes)) throw new Error('Failed to load teacher exams: no rows returned');

    if (courseIds.length > 0) {
      const topics = (await Promise.all(Array.from({ length: Math.ceil(courseIds.length / 100) }, (_, index) =>
        readAllRows('topics', 'id', query => query.in('course_id', courseIds.slice(index * 100, index * 100 + 100)))))).flat();
      totalTopics = topics.length;
      const topicIds = topics.map((topic: any) => topic.id);
      if (topicIds.length > 0) {
        const counts = await Promise.all(Array.from({ length: Math.ceil(topicIds.length / 100) }, async (_, index) => {
          const { count, error } = await supabase.from('questions').select('*', { count: 'exact', head: true })
            .in('topic_id', topicIds.slice(index * 100, index * 100 + 100));
          if (error) throw new Error(`Failed to count questions: ${error.message}`);
          if (typeof count !== 'number') throw new Error('Failed to count questions: no valid count returned');
          return count;
        }));
        totalQuestions = counts.reduce((sum, count) => sum + count, 0);
      }
    }

    // Calculate avg score from teacher_quizzes attempts
    const quizIds = quizzes.map((q: any) => q.id);
    if (quizIds.length > 0) {
      const { data: attempts, error: attemptsError } = await supabase
        .from('quiz_attempts')
        .select('score, max_score')
        .in('quiz_id', quizIds)
        .eq('status', 'completed');
      if (attemptsError) throw new Error(`Failed to load exam attempts: ${attemptsError.message}`);
      if (!Array.isArray(attempts)) throw new Error('Failed to load exam attempts: no rows returned');

      if (attempts.length > 0) {
        const total = attempts.reduce((sum: number, a: any) =>
          sum + (a.max_score > 0 ? (a.score / a.max_score) * 100 : 0), 0);
        avgStudentScore = Math.round(total / attempts.length);
      }
    }
    return { totalCourses, totalStudents, totalQuestions, totalTopics, avgStudentScore, activeEnrollments };
  },

  async getTeacherCoursePerformance(teacherId: string) {
    try {
      const { data: courses, error: coursesError } = await supabase
        .from('courses')
        .select('id, title')
        .eq('created_by', teacherId);
      if (coursesError) throw new Error(`Failed to load courses: ${coursesError.message}`);
      if (!Array.isArray(courses)) throw new Error('Failed to load courses: no rows returned');

      if (!courses || courses.length === 0) return [];

      const courseIds = courses.map((c: any) => c.id);

      // Fetch all data in parallel — no per-course loops
      const [enrollResult, quizResult] = await Promise.all([
        supabase.from('enrollments').select('course_id').in('course_id', courseIds),
        supabase.from('teacher_quizzes').select('id, course_id').in('course_id', courseIds),
      ]);
      if (enrollResult.error) throw new Error(`Failed to load enrollments: ${enrollResult.error.message}`);
      if (quizResult.error) throw new Error(`Failed to load teacher exams: ${quizResult.error.message}`);

      const quizIds = (quizResult.data || []).map((q: any) => q.id);
      const attemptResult = quizIds.length > 0
        ? await supabase.from('quiz_attempts').select('score, max_score, status, quiz_id').in('quiz_id', quizIds)
        : { data: [] };
      if ('error' in attemptResult && attemptResult.error) throw new Error(`Failed to load exam attempts: ${attemptResult.error.message}`);

      // Group in memory
      const enrollmentsByCourse: Record<string, number> = {};
      for (const e of (enrollResult.data || [])) {
        enrollmentsByCourse[e.course_id] = (enrollmentsByCourse[e.course_id] || 0) + 1;
      }

      const quizByCourse: Record<string, string[]> = {};
      for (const q of (quizResult.data || [])) {
        if (q.course_id) {
          if (!quizByCourse[q.course_id]) quizByCourse[q.course_id] = [];
          quizByCourse[q.course_id].push(q.id);
        }
      }

      const attemptsByQuiz: Record<string, any[]> = {};
      for (const a of (attemptResult.data || [])) {
        if (!attemptsByQuiz[a.quiz_id]) attemptsByQuiz[a.quiz_id] = [];
        attemptsByQuiz[a.quiz_id].push(a);
      }

      return courses.map((course: any) => {
        const courseQuizIds = quizByCourse[course.id] || [];
        const allAttempts = courseQuizIds.flatMap(qid => attemptsByQuiz[qid] || []);
        const completed = allAttempts.filter((a: any) => a.status === 'completed');

        let avgScore = 0;
        let completionRate = 0;
        if (completed.length > 0) {
          const total = completed.reduce((sum: number, a: any) =>
            sum + (a.max_score > 0 ? (a.score / a.max_score) * 100 : 0), 0);
          avgScore = Math.round(total / completed.length);
          completionRate = allAttempts.length > 0
            ? Math.round((completed.length / allAttempts.length) * 100)
            : 0;
        }

        return {
          courseName: course.title,
          avgScore,
          completionRate,
          enrollments: enrollmentsByCourse[course.id] || 0,
        };
      });
    } catch (e) {
      console.error('Error fetching course performance:', e);
      throw e;
    }
  },

  async getTeacherCourseAnalytics(teacherId: string) {
    return this.getTeacherCoursePerformance(teacherId);
  },

  async getTeacherTimeSeries(teacherId: string, range: string) {
    try {
      const now = new Date();
      let startDate: Date;

      switch (range) {
        case '7d':  startDate = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000); break;
        case '90d': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
        case 'all': startDate = new Date('2020-01-01'); break;
        default:    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Get teacher's quizzes (teacher_quizzes table — the active one)
      const { data: quizzes } = await supabase
        .from('teacher_quizzes')
        .select('id')
        .eq('teacher_id', teacherId);

      const quizIds = (quizzes || []).map((q: any) => q.id);

      // Get teacher's courses for enrollment data
      const { data: courses } = await supabase
        .from('courses')
        .select('id')
        .eq('created_by', teacherId);

      const courseIds = (courses || []).map((c: any) => c.id);

      // Fetch all attempts and enrollments in one round-trip each
      const [attemptResult, enrollResult] = await Promise.all([
        quizIds.length > 0
          ? supabase.from('quiz_attempts').select('started_at').in('quiz_id', quizIds).gte('started_at', startDate.toISOString())
          : Promise.resolve({ data: [] }),
        courseIds.length > 0
          ? supabase.from('enrollments').select('enrolled_at').in('course_id', courseIds).gte('enrolled_at', startDate.toISOString())
          : Promise.resolve({ data: [] }),
      ]);

      const attempts = attemptResult.data || [];
      const enrollments = enrollResult.data || [];

      // Build weekly buckets in memory
      const weeks = Math.min(12, Math.ceil((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)));
      const timeSeriesData: any[] = [];

      for (let i = weeks - 1; i >= 0; i--) {
        const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
        const weekEnd   = new Date(now.getTime() - i       * 7 * 24 * 60 * 60 * 1000);

        const weekAttempts = attempts.filter((a: any) => {
          const d = new Date(a.started_at);
          return d >= weekStart && d < weekEnd;
        }).length;

        const weekEnrollments = enrollments.filter((e: any) => {
          const d = new Date(e.enrolled_at);
          return d >= weekStart && d < weekEnd;
        }).length;

        timeSeriesData.push({
          date: `Week ${weeks - i}`,
          enrollments: weekEnrollments,
          quizzes: weekAttempts,
        });
      }

      return timeSeriesData;
    } catch (e) {
      console.error('Error fetching time series:', e);
      return [];
    }
  },

  async getTeacherCourses(teacherId: string) {
    try {
      const { data: courses, error } = await supabase
        .from('courses')
        .select('*')
        .eq('created_by', teacherId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!courses || courses.length === 0) return [];

      const courseIds = courses.map((c: any) => c.id);

      // Single query for all enrollment counts
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('course_id')
        .in('course_id', courseIds);

      const countByCourse: Record<string, number> = {};
      for (const e of (enrollments || [])) {
        countByCourse[e.course_id] = (countByCourse[e.course_id] || 0) + 1;
      }

      return courses.map((course: any) => ({
        _id: course.id,
        title: course.title,
        description: course.description,
        category: course.category,
        difficulty: course.difficulty,
        thumbnail: course.thumbnail,
        topics: [],
        createdBy: course.created_by,
        isPublished: course.is_published,
        enrollmentCount: countByCourse[course.id] || 0,
        avgScore: 0,
      }));
    } catch (e) {
      console.error('Error fetching teacher courses:', e);
      return [];
    }
  },

  async getTeacherTopics(teacherId: string) {
    try {
      const { data: courses } = await supabase
        .from('courses')
        .select('id, title')
        .eq('created_by', teacherId);

      const courseIds = (courses || []).map((c: any) => c.id);
      const courseMap = new Map((courses || []).map((c: any) => [c.id, c.title]));
      if (courseIds.length === 0) return [];

      const { data: topics, error } = await supabase
        .from('topics')
        .select('*')
        .in('course_id', courseIds)
        .order('order', { ascending: true });

      if (error) throw error;
      if (!topics || topics.length === 0) return [];

      const topicIds = topics.map((t: any) => t.id);

      // Single batch query for all question counts
      const { data: questions } = await supabase
        .from('questions')
        .select('topic_id')
        .in('topic_id', topicIds);

      const questionCountByTopic: Record<string, number> = {};
      for (const q of (questions || [])) {
        questionCountByTopic[q.topic_id] = (questionCountByTopic[q.topic_id] || 0) + 1;
      }

      return topics.map((topic: any) => ({
        _id: topic.id,
        title: topic.title,
        description: topic.description,
        courseId: topic.course_id,
        order: topic.order,
        courseName: courseMap.get(topic.course_id) || 'Unknown',
        questionCount: questionCountByTopic[topic.id] || 0,
      }));
    } catch (e) {
      console.error('Error fetching teacher topics:', e);
      return [];
    }
  },

  async getTeacherQuestions(teacherId: string) {
    try {
      const topics = await this.getTeacherTopics(teacherId);
      const topicIds = topics.map((t: any) => t._id);
      const topicMap = new Map(topics.map((t: any) => [t._id, { name: t.title, course: t.courseName }]));
      if (topicIds.length === 0) return [];

      const { data: questions, error } = await supabase
        .from('questions')
        .select('*')
        .in('topic_id', topicIds)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (questions || []).map((q: any) => ({
        _id: q.id,
        text: q.content || q.question_text,
        options: q.options || [],
        correctAnswer: q.correct_answer,
        difficulty: q.difficulty,
        topicId: q.topic_id,
        explanation: q.explanation,
        topicName: topicMap.get(q.topic_id)?.name || 'Unknown',
        courseName: topicMap.get(q.topic_id)?.course || 'Unknown',
      }));
    } catch (e) {
      console.error('Error fetching teacher questions:', e);
      return [];
    }
  },
};
