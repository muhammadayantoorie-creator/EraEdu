process.env.JWT_SECRET = 'test-secret-key-minimum-32-characters-ok';
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_KEY = 'placeholder-anon-key';
process.env.NODE_ENV = 'test';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../config/supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));

import { readFileSync } from 'fs';
import { join } from 'path';
import { adminService } from '../services/adminService';

beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });

describe('atomic account governance', () => {
  it('uses one database transaction for a role and suspension change, returning only the account view', async () => {
    const account = { id: 'target-1', name: 'Student', email: 'student@example.test', role: 'teacher',
      is_suspended: false, suspended_at: null, created_at: '2026-01-01T00:00:00Z' };
    mockRpc.mockResolvedValue({ data: account, error: null });

    await expect(adminService.updateUser('target-1', { role: 'teacher', isSuspended: false }, 'admin-1'))
      .resolves.toEqual({ ...account, _id: 'target-1' });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('admin_update_user_atomic', {
      p_actor_id: 'admin-1', p_target_user_id: 'target-1',
      p_role: 'teacher', p_is_suspended: false,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('passes omitted fields as null without dropping a requested restore', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'target-1' }, error: null });
    await adminService.updateUser('target-1', { isSuspended: false }, 'admin-1');
    expect(mockRpc).toHaveBeenCalledWith('admin_update_user_atomic', expect.objectContaining({
      p_role: null, p_is_suspended: false,
    }));
  });

  it.each([
    [{ role: 'owner' }, 'Invalid role'],
    [{ isSuspended: 'false' }, 'Invalid suspension status'],
    [{}, 'No changes provided'],
  ])('rejects malformed changes before any write', async (updates, message) => {
    await expect(adminService.updateUser('target-1', updates as any, 'admin-1'))
      .rejects.toMatchObject({ statusCode: 400, message });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('blocks self-change before any write', async () => {
    await expect(adminService.updateUser('admin-1', { isSuspended: true }, 'admin-1'))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(['PGRST202', '42883', '42P01', '42703', '42501'])
  ('fails with the migration requirement rather than doing an unaudited fallback (%s)', async code => {
    mockRpc.mockResolvedValue({ data: null, error: { code, message: 'Database function unavailable' } });
    await expect(adminService.updateUser('target-1', { isSuspended: true }, 'admin-1'))
      .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('026_atomic_admin_governance.sql') });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each([
    ['Only active platform admins can change users', 403],
    ['Target user not found', 404],
    ['Account suspension state unavailable', 503],
  ])('surfaces %s as status %s after the database rechecks current state', async (message, statusCode) => {
    mockRpc.mockResolvedValue({ data: null, error: { message } });
    await expect(adminService.updateUser('target-1', { role: 'student' }, 'admin-1'))
      .rejects.toMatchObject({ statusCode, message });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not claim success if the database returns no account', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(adminService.updateUser('target-1', { role: 'student' }, 'admin-1'))
      .rejects.toThrow('Account governance update returned no user');
  });

  it('defines serialized current-admin checks, audit writes and restricted execution in the additive migration', () => {
    const sql = readFileSync(join(__dirname, '../../migrations/026_atomic_admin_governance.sql'), 'utf8');
    expect(sql).toContain('ORDER BY id FOR UPDATE');
    expect(sql).toContain("v_actor.role IS DISTINCT FROM 'admin'");
    expect(sql).toContain('v_actor.is_suspended IS DISTINCT FROM false');
    expect(sql).toContain('UPDATE public.users');
    expect(sql.match(/INSERT INTO public\.admin_governance_audit/g)).toHaveLength(2);
    expect(sql).toContain('IF NOT v_role_changed AND NOT v_suspension_changed THEN');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.admin_update_user_atomic');
    expect(sql).toContain('TO service_role');
    expect(sql).not.toMatch(/'password'|'face_encoding'/);
  });
});
