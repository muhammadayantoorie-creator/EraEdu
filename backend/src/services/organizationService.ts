import { supabase } from '../config/supabase';

const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const getMembership = async (organizationId: string, userId: string) => {
  const { data, error } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as { role: 'owner' | 'admin' | 'teacher' } | null;
};

const requireManager = async (organizationId: string, userId: string) => {
  const membership = await getMembership(organizationId, userId);
  if (!membership || !['owner', 'admin'].includes(membership.role)) throw fail('Only organization owners and admins can manage teachers.', 403);
};

export const organizationService = {
  async listForUser(userId: string) {
    const { data: memberships, error } = await supabase
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId);
    if (error) throw error;
    const ids = (memberships || []).map((item: any) => item.organization_id);
    if (!ids.length) return [];
    const { data: organizations, error: organizationError } = await supabase
      .from('organizations')
      .select('id, name, owner_id, seat_limit, created_at')
      .in('id', ids);
    if (organizationError) throw organizationError;
    return (organizations || []).map((organization: any) => ({
      ...organization,
      role: memberships?.find((item: any) => item.organization_id === organization.id)?.role,
    }));
  },

  async create(ownerId: string, name: string) {
    const cleanedName = name?.trim();
    if (!cleanedName || cleanedName.length > 255) throw fail('Organization name must be between 1 and 255 characters.');
    const { data: organization, error } = await supabase
      .from('organizations')
      .insert({ name: cleanedName, owner_id: ownerId })
      .select('id, name, owner_id, seat_limit, created_at')
      .single();
    if (error || !organization) throw error || fail('Unable to create organization.');
    const membership = await supabase.from('organization_members').insert({ organization_id: organization.id, user_id: ownerId, role: 'owner' });
    if (membership.error) throw membership.error;
    return { ...organization, role: 'owner' };
  },

  async listMembers(organizationId: string, requesterId: string) {
    const membership = await getMembership(organizationId, requesterId);
    if (!membership) throw fail('You are not a member of this organization.', 403);
    const { data, error } = await supabase
      .from('organization_members')
      .select('user_id, role, created_at')
      .eq('organization_id', organizationId);
    if (error) throw error;
    const ids = (data || []).map((member: any) => member.user_id);
    const { data: users, error: userError } = await supabase.from('users').select('id, name, email, role').in('id', ids);
    if (userError) throw userError;
    return (data || []).map((member: any) => ({ ...member, user: users?.find((user: any) => user.id === member.user_id) }));
  },

  async addTeacher(organizationId: string, requesterId: string, email: string) {
    await requireManager(organizationId, requesterId);
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) throw fail('Teacher email is required.');
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, role')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (userError) throw userError;
    if (!user || user.role !== 'teacher') throw fail('A registered teacher account is required before it can be added.', 404);

    const existing = await getMembership(organizationId, user.id);
    if (existing) return { alreadyMember: true };
    const { data: organization, error: organizationError } = await supabase.from('organizations').select('seat_limit').eq('id', organizationId).single();
    if (organizationError || !organization) throw organizationError || fail('Organization not found.', 404);
    const { count, error: countError } = await supabase.from('organization_members').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId);
    if (countError) throw countError;
    if ((count || 0) >= organization.seat_limit) throw fail('This organization has reached its teacher-seat limit.', 409);
    const { error } = await supabase.from('organization_members').insert({ organization_id: organizationId, user_id: user.id, role: 'teacher' });
    if (error) throw error;
    return { alreadyMember: false };
  },
};
