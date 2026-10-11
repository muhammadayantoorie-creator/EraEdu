import { supabase } from '../config/supabase';

const count = async (table: string) => {
  const { count: value, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Failed to count ${table}: no valid count returned`);
  return value;
};

export const adminService = {
  async getOverview() {
    // Total courses: the admin governance list has no publication or archive filter.
    const [users, courses, quizzes, attempts, violations] = await Promise.all([
      count('users'), count('courses'), count('teacher_quizzes'), count('quiz_attempts'), count('cheating_violations'),
    ]);
    const { data: roleRows, error: roleError } = await supabase.from('users').select('role, is_suspended');
    if (roleError) throw new Error(`Failed to load user roles: ${roleError.message}`);
    const roles = (roleRows || []).reduce((result: Record<string, number>, user: any) => {
      const role = ['student', 'teacher', 'admin'].includes(user.role) ? user.role : 'unknown';
      result[role] = (result[role] || 0) + 1;
      return result;
    }, { student: 0, teacher: 0, admin: 0, unknown: 0 });
    const roleTotal = Object.values(roles).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
    if (roleTotal !== users) throw new Error(`User role summary mismatch: users=${users}, roles=${roleTotal}`);
    return { users, courses, quizzes, attempts, violations, suspendedUsers: (roleRows || []).filter((u: any) => u.is_suspended).length, roles, roleTotal };
  },

  // Same unfiltered, all-time quiz_attempts population as the overview card.
  async getAttempts(page = 1, limit = 50) {
    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
    const { data: attempts, count: total, error } = await supabase.from('quiz_attempts')
      .select('id, user_id, quiz_id, topic_id, status, score, max_score, started_at, completed_at', { count: 'exact' })
      .order('started_at', { ascending: false })
      .range((safePage - 1) * safeLimit, safePage * safeLimit - 1);
    if (error) throw new Error(`Failed to load attempts: ${error.message}`);
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw new Error('Failed to count attempts: no valid count returned');

    const fetchByIds = async (table: string, columns: string, ids: string[]) => {
      if (!ids.length) return [];
      const { data, error: lookupError } = await supabase.from(table).select(columns).in('id', ids);
      if (lookupError) throw new Error(`Failed to resolve ${table}: ${lookupError.message}`);
      return data || [];
    };
    const rows = attempts || [];
    const ids = (predicate: (row: any) => boolean, field: string) => [...new Set(rows.filter(predicate).map((row: any) => row[field]).filter(Boolean))];
    const [teachers, topicsQuizzes, topics, students] = await Promise.all([
      fetchByIds('teacher_quizzes', 'id, title, course_id', ids((row: any) => !row.topic_id, 'quiz_id')),
      fetchByIds('quizzes', 'id, title, topic_id', ids((row: any) => !!row.topic_id, 'quiz_id')),
      fetchByIds('topics', 'id, title, course_id', ids((row: any) => !!row.topic_id, 'topic_id')),
      fetchByIds('users', 'id, name, email', ids(() => true, 'user_id')),
    ]);
    const teacherMap = new Map(teachers.map((row: any) => [row.id, row]));
    const quizMap = new Map(topicsQuizzes.map((row: any) => [row.id, row]));
    const topicMap = new Map(topics.map((row: any) => [row.id, row]));
    const studentMap = new Map(students.map((row: any) => [row.id, row]));
    const courseIds = [...new Set([...teachers, ...topics].map((row: any) => row.course_id).filter(Boolean))];
    const courses = await fetchByIds('courses', 'id, title, is_published', courseIds);
    const courseMap = new Map(courses.map((row: any) => [row.id, row]));
    return { data: rows.map((attempt: any) => {
      const isTopicExam = !!attempt.topic_id;
      const assessment: any = isTopicExam ? quizMap.get(attempt.quiz_id) : teacherMap.get(attempt.quiz_id);
      const topic: any = isTopicExam ? topicMap.get(attempt.topic_id) : null;
      const courseId = isTopicExam ? topic?.course_id : assessment?.course_id;
      const course: any = courseId ? courseMap.get(courseId) : null;
      const student: any = studentMap.get(attempt.user_id);
      const referenceIssues = [
        !student && 'Missing student',
        !assessment && `Missing ${isTopicExam ? 'topic' : 'teacher'} exam`,
        isTopicExam && !topic && 'Missing topic',
        isTopicExam && assessment && topic && assessment.topic_id !== topic.id && 'Exam/topic mismatch',
        courseId && !course && 'Missing course',
      ].filter(Boolean);
      return {
        id: attempt.id, student: student?.name || 'Missing student', studentEmail: student?.email || '',
        assessment: assessment?.title || 'Missing assessment', assessmentType: isTopicExam ? 'Topic exam' : 'Teacher exam',
        topic: topic?.title || null, course: course?.title || (courseId ? 'Missing course' : 'No linked course'),
        coursePublished: course?.is_published ?? null, status: attempt.status,
        score: attempt.score, maxScore: attempt.max_score, startedAt: attempt.started_at, completedAt: attempt.completed_at,
        referenceIssues,
      };
    }), pagination: { page: safePage, limit: safeLimit, total } };
  },

  async getUsers(search = '', page = 1, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    let query = supabase.from('users').select('id, name, email, role, created_at, is_suspended, suspended_at', { count: 'exact' }).order('created_at', { ascending: false }).range((safePage - 1) * safeLimit, safePage * safeLimit - 1);
    if (search.trim()) query = query.ilike('email', `%${search.trim()}%`);
    const { data, error, count: total } = await query;
    if (error) throw new Error(error.message);
    return { data: (data || []).map((user: any) => ({ ...user, _id: user.id })), pagination: { page: safePage, limit: safeLimit, total: total ?? 0 } };
  },

  async getIntegrityEvents(page = 1, limit = 100) {
    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 100;
    const { data, count: total, error } = await supabase.from('cheating_violations')
      .select('id, quiz_attempt_id, violation_type, severity, detection_method, timestamp, student_id, quiz_id, quiz_attempts(is_flagged, teacher_grade, status), users:student_id(name, email), teacher_quizzes:quiz_id(title, courses:course_id(title))', { count: 'exact' })
      .order('timestamp', { ascending: false }).range((safePage - 1) * safeLimit, safePage * safeLimit - 1);
    if (error) throw new Error(error.message);
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw new Error('Failed to count integrity events: no valid count returned');
    return { data: (data || []).map((event: any) => ({
      id: event.id, attemptId: event.quiz_attempt_id, type: event.violation_type, severity: event.severity || 'low', detectionMethod: event.detection_method || 'unknown', timestamp: event.timestamp,
      studentName: event.users?.name || 'Unknown student', studentEmail: event.users?.email || '', assessment: event.teacher_quizzes?.title || 'Unknown assessment',
      course: event.teacher_quizzes?.courses?.title || 'No course', flagged: !!event.quiz_attempts?.is_flagged, reviewed: event.quiz_attempts?.teacher_grade !== null && event.quiz_attempts?.teacher_grade !== undefined,
    })), pagination: { page: safePage, limit: safeLimit, total } };
  },

  async updateUser(userId: string, updates: { role?: string; isSuspended?: boolean }, actorId: string) {
    const payload: any = {};
    if (updates.role !== undefined) {
      if (!['student', 'teacher', 'admin'].includes(updates.role)) throw Object.assign(new Error('Invalid role'), { statusCode: 400 });
      payload.role = updates.role;
    }
    if (updates.isSuspended !== undefined) {
      payload.is_suspended = updates.isSuspended;
      payload.suspended_at = updates.isSuspended ? new Date().toISOString() : null;
    }
    if (!Object.keys(payload).length) throw Object.assign(new Error('No changes provided'), { statusCode: 400 });
    const { data, error } = await supabase.from('users').update(payload).eq('id', userId).select('id, name, email, role, created_at, is_suspended, suspended_at').single();
    if (error) throw new Error(error.message);
    const action = updates.isSuspended === true ? 'suspend' : updates.isSuspended === false ? 'restore' : 'role_change';
    const { error: auditError } = await supabase.from('admin_governance_audit').insert({ actor_id: actorId, target_user_id: userId, action, details: { role: updates.role, isSuspended: updates.isSuspended } });
    if (auditError) throw Object.assign(new Error('Governance audit migration required: apply backend/migrations/020_add_admin_governance_audit.sql'), { statusCode: 503 });
    return { ...data, _id: data.id };
  },
};
