import { supabase } from '../config/supabase';

const count = async (table: string) => (await supabase.from(table).select('*', { count: 'exact', head: true })).count || 0;

export const adminService = {
  async getOverview() {
    const [users, courses, quizzes, attempts, violations] = await Promise.all([
      count('users'), count('courses'), count('teacher_quizzes'), count('quiz_attempts'), count('cheating_violations'),
    ]);
    const { data: roleRows } = await supabase.from('users').select('role, is_suspended');
    const roles = (roleRows || []).reduce((result: Record<string, number>, user: any) => {
      result[user.role || 'student'] = (result[user.role || 'student'] || 0) + 1;
      return result;
    }, {});
    return { users, courses, quizzes, attempts, violations, suspendedUsers: (roleRows || []).filter((u: any) => u.is_suspended).length, roles };
  },

  async getUsers(search = '', limit = 100) {
    let query = supabase.from('users').select('id, name, email, role, created_at, is_suspended, suspended_at').order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
    if (search.trim()) query = query.ilike('email', `%${search.trim()}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map((user: any) => ({ ...user, _id: user.id }));
  },

  async updateUser(userId: string, updates: { role?: string; isSuspended?: boolean }) {
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
    return { ...data, _id: data.id };
  },
};
