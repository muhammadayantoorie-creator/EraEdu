import { supabase } from '../config/supabase';
import { courseService, parseCourseCapacity } from './courseService';

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const ASSIGNMENT_MIGRATION = 'Course assignment setup is incomplete. Apply backend/migrations/024_assign_courses_to_teachers.sql.';
function requireAssignmentIds(teacherId: unknown, organizationId: unknown, courseId?: unknown): void {
  if (typeof teacherId !== 'string' || !teacherId.trim() ||
      typeof organizationId !== 'string' || !organizationId.trim() ||
      (courseId !== undefined && (typeof courseId !== 'string' || !courseId.trim()))) {
    throw fail('Select an institution and registered teacher.', 400);
  }
}

function assignmentRpcError(error: any): never {
  const message = String(error?.message || 'Course assignment failed');
  if (error?.code === 'PGRST202' || error?.code === '42883' || error?.code === 'PGRST204' || error?.code === '42703' || error?.code === '42P01') {
    throw fail(ASSIGNMENT_MIGRATION, 503);
  }
  if (error?.code === '22P02') throw fail('Invalid teacher, institution, or course ID.', 400);
  if (message === 'Course not found') throw fail(message, 404);
  if (message === 'An active registered teacher is required') throw fail(message, 400);
  if (message === 'Only active platform admins can assign courses') throw fail(message, 403);
  if (message === 'Only the assigned course teacher can manage this exam') throw fail(message, 403);
  if (message === 'Teacher must belong to the selected institution' ||
      message === 'Current teacher is not in the selected institution' ||
      message === 'Course cannot be moved to another institution') throw fail(message, 403);
  throw new Error(message);
}

export const courseAssignmentService = {
  async getOptions() {
    const { data: organizations, error: organizationError } = await supabase.from('organizations')
      .select('id, name').order('name', { ascending: true });
    if (organizationError) throw new Error(organizationError.message);
    const { data: memberships, error: membershipError } = await supabase.from('organization_members')
      .select('organization_id, user_id');
    if (membershipError) throw new Error(membershipError.message);
    const ids = [...new Set((memberships || []).map((member: any) => member.user_id))];
    if (!ids.length) return { organizations: organizations || [], teachers: [] };
    const { data: users, error: userError } = await supabase.from('users')
      .select('id, name, email, role, is_suspended').in('id', ids);
    if (userError) throw new Error(userError.message);
    return {
      organizations: organizations || [],
      teachers: (users || []).filter((user: any) => user.role === 'teacher' && !user.is_suspended)
        .map((user: any) => ({ id: user.id, name: user.name, email: user.email,
          organizationIds: (memberships || []).filter((member: any) => member.user_id === user.id)
            .map((member: any) => member.organization_id) })),
    };
  },

  async listCourses(search = '', page = 1, limit = 50) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 50));
    let query = supabase.from('courses').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((safePage - 1) * safeLimit, safePage * safeLimit - 1);
    if (search.trim()) query = query.ilike('title', `%${search.trim()}%`);
    const { data: courses, error, count } = await query;
    if (error) throw new Error(error.message);
    const ownerIds = [...new Set((courses || []).map((course: any) => course.created_by).filter(Boolean))];
    const { data: owners, error: ownerError } = ownerIds.length
      ? await supabase.from('users').select('id, name, email, role').in('id', ownerIds)
      : { data: [], error: null };
    if (ownerError) throw new Error(ownerError.message);
    const ownerMap = new Map((owners || []).map((owner: any) => [owner.id, owner]));
    const rows = await Promise.all((courses || []).map(async (course: any) => {
      if (course.organization_id === undefined) throw fail(ASSIGNMENT_MIGRATION, 503);
      if (course.max_students === undefined) throw fail('Course capacity schema is missing. Apply migrations 006_add_course_capacity.sql and 023_enforce_course_capacity_atomically.sql.', 503);
      const [{ count: enrollmentCount, error: enrollmentError }, { data: topics, error: topicsError }] = await Promise.all([
        supabase.from('enrollments').select('*', { count: 'exact', head: true }).eq('course_id', course.id),
        supabase.from('topics').select('id').eq('course_id', course.id),
      ]);
      if (enrollmentError) throw new Error(enrollmentError.message);
      if (topicsError) throw new Error(topicsError.message);
      const owner: any = ownerMap.get(course.created_by);
      return { _id: course.id, title: course.title, description: course.description,
        category: course.category, difficulty: course.difficulty, courseCode: course.course_code,
        maxStudents: course.max_students, organizationId: course.organization_id,
        createdBy: owner?.role === 'teacher' ? course.created_by : null,
        assignedTeacherName: owner?.role === 'teacher' ? owner.name : 'Unassigned',
        assignedTeacherEmail: owner?.role === 'teacher' ? owner.email : '', enrollmentCount: enrollmentCount ?? 0,
        topics: (topics || []).map((topic: any) => topic.id) };
    }));
    return { data: rows, pagination: { page: safePage, limit: safeLimit, total: count ?? 0 } };
  },

  async createAssignedCourse(actorId: string, input: any) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 255) throw fail('Course title must be between 1 and 255 characters.', 400);
    requireAssignmentIds(input.teacherId, input.organizationId);
    const maxStudents = parseCourseCapacity(input.maxStudents) ?? null;
    const courseCode = await courseService.generateUniqueCourseCode();
    const { data, error } = await supabase.rpc('admin_create_assigned_course', {
      p_actor_id: actorId, p_teacher_id: input.teacherId, p_organization_id: input.organizationId,
      p_title: title, p_description: input.description || '', p_category: input.category || 'Other',
      p_difficulty: input.difficulty || 'Beginner', p_course_code: courseCode, p_max_students: maxStudents,
    });
    if (error) assignmentRpcError(error);
    if (!data?.id) throw new Error('Assigned course creation returned no course');
    return { ...data, _id: data.id, maxStudents: data.max_students, createdBy: data.created_by };
  },

  async reassignCourse(actorId: string, courseId: string, input: any) {
    requireAssignmentIds(input.teacherId, input.organizationId, courseId);
    const { data, error } = await supabase.rpc('admin_reassign_course', {
      p_actor_id: actorId, p_course_id: courseId, p_teacher_id: input.teacherId,
      p_organization_id: input.organizationId,
    });
    if (error) assignmentRpcError(error);
    if (typeof data !== 'boolean') throw new Error('Course reassignment returned no result');
    return { changed: data };
  },
};
