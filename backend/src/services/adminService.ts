import { supabase } from '../config/supabase';

const count = async (table: string) => {
  const { count: value, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return value ?? 0;
};

export const adminService = {
  async getOverview() {
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

  async getUsers(search = '', page = 1, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    let query = supabase.from('users').select('id, name, email, role, created_at, is_suspended, suspended_at', { count: 'exact' }).order('created_at', { ascending: false }).range((safePage - 1) * safeLimit, safePage * safeLimit - 1);
    if (search.trim()) query = query.ilike('email', `%${search.trim()}%`);
    const { data, error, count: total } = await query;
    if (error) throw new Error(error.message);
    return { data: (data || []).map((user: any) => ({ ...user, _id: user.id })), pagination: { page: safePage, limit: safeLimit, total: total ?? 0 } };
  },

  async getIntegrityEvents(limit = 100) {
    const { data, error } = await supabase.from('cheating_violations')
      .select('id, quiz_attempt_id, violation_type, severity, detection_method, timestamp, student_id, quiz_id, quiz_attempts(is_flagged, teacher_grade, status), users:student_id(name, email), teacher_quizzes:quiz_id(title, courses:course_id(title))')
      .order('timestamp', { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
    if (error) throw new Error(error.message);
    return (data || []).map((event: any) => ({
      id: event.id, attemptId: event.quiz_attempt_id, type: event.violation_type, severity: event.severity || 'low', detectionMethod: event.detection_method || 'unknown', timestamp: event.timestamp,
      studentName: event.users?.name || 'Unknown student', studentEmail: event.users?.email || '', assessment: event.teacher_quizzes?.title || 'Unknown assessment',
      course: event.teacher_quizzes?.courses?.title || 'No course', flagged: !!event.quiz_attempts?.is_flagged, reviewed: event.quiz_attempts?.teacher_grade !== null && event.quiz_attempts?.teacher_grade !== undefined,
    }));
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
