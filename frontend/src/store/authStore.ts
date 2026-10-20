import { create } from 'zustand';
import api, { setSessionAccountReader } from '../services/api';
import { User } from '../types';

const sessionNoticeFor = (code?: string): string => {
  if (code === 'ACCOUNT_SUSPENDED') return 'Your account has been suspended. Please contact support.';
  if (code === 'ROLE_CHANGED') return 'Your account role changed. Please sign in again.';
  if (code === 'SESSION_ACCOUNT_CHANGED') return 'Another tab changed your signed-in account. Please sign in again before continuing.';
  if (code === 'ACCOUNT_UNAVAILABLE') return 'This account is no longer available. Please contact support.';
  if (code === 'ACCOUNT_ROLE_INVALID') return 'This account has no supported access role. Please contact support.';
  return 'Your session has expired. Please sign in again.';
};
let sessionRevision = 0;

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAuthChecking: boolean;
  error: string | null;
  sessionNotice: string | null;
  authCheckError: string | null;
  login: (credentials: any) => Promise<void>;
  register: (data: any) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<string>;
  logout: () => void;
  expireSession: (code?: string) => void;
  checkAuth: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isAuthChecking: true, // Start as true to prevent flash
  error: null,
  sessionNotice: null,
  authCheckError: null,

  login: async (credentials) => {
    sessionRevision += 1;
    // A new sign-in attempt must never inherit an earlier user session. In
    // particular, a student must not be redirected by a stale /auth/me check
    // before completing the required face verification step.
    set({
      isLoading: true,
      error: null,
      user: null,
      token: null,
      isAuthenticated: false,
      isAuthChecking: false,
      sessionNotice: null,
      authCheckError: null,
    });
    try {
       const response = await api.post<any>('/auth/login', credentials);
      const responseData = response.data.data;

      // A slow initial /auth/me check can still be in flight when a user signs
      // in. Mark the new session as settled immediately so that stale check
      // cannot send the user back to the sign-in screen.
      set({ user: responseData.user || responseData, token: null, isAuthenticated: true, isLoading: false, isAuthChecking: false, error: null, sessionNotice: null, authCheckError: null });
    } catch (error: any) {
      const message = error.response?.data?.message || error.response?.data?.error?.message || 'Login failed';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  register: async (data) => {
    set({ isLoading: true, error: null });
    try {
      // Increase timeout for registration with image upload
      await api.post<any>('/auth/register', data, {
        timeout: 30000,
        maxBodyLength: 10 * 1024 * 1024,
        maxContentLength: 10 * 1024 * 1024,
      });
      // Do NOT auto-login — user must go through /login (including face verification for students)
      set({ isLoading: false, error: null });
    } catch (error: any) {
      const message = error.response?.data?.message
        || error.response?.data?.error?.message
        || (error.code === 'ECONNABORTED'
          ? 'Registration timed out. Please try again.'
          : 'Cannot connect to the EraEdu server. Start the backend and verify its Supabase configuration.');
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  requestPasswordReset: async (email) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post<any>('/auth/forgot-password', { email });
      const message = response.data.data?.message || 'If an account with that email exists, a password reset link has been sent.';
      set({ isLoading: false, error: null });
      return message;
    } catch (error: any) {
      const message = error.response?.data?.message || error.response?.data?.error?.message || 'Failed to send reset email';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  resetPassword: async (token, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post<any>('/auth/reset-password', { token, password });
      const message = response.data.data?.message || 'Password reset successful.';
      set({ isLoading: false, error: null });
      return message;
    } catch (error: any) {
      const message = error.response?.data?.message || error.response?.data?.error?.message || 'Failed to reset password';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  logout: () => {
    sessionRevision += 1;
    void api.post('/auth/logout').catch(() => undefined);
    set({ user: null, token: null, isAuthenticated: false, isAuthChecking: false, sessionNotice: null, authCheckError: null });
  },

  expireSession: (code) => {
    sessionRevision += 1;
    set({ user: null, token: null, isAuthenticated: false, isAuthChecking: false, sessionNotice: sessionNoticeFor(code), authCheckError: null });
  },

  checkAuth: async () => {
    // Don't set isLoading, use separate isAuthChecking.
    const revision = sessionRevision;
    set({ isAuthChecking: true, authCheckError: null });
    try {
      const response = await api.get<any>('/auth/me');
      // Ignore an older response after login, logout, or session revocation.
      if (revision !== sessionRevision) return;
      set({ user: response.data.data, isAuthenticated: true, isAuthChecking: false, sessionNotice: null, authCheckError: null });
    } catch (error: any) {
      if (revision !== sessionRevision) return;
      const code = error.response?.data?.error?.code;
      const unavailable = !error.response || error.response.status === 503;
      set({
        user: null, token: null, isAuthenticated: false, isAuthChecking: false,
        authCheckError: unavailable
          ? (code === 'AUTH_SCHEMA_REQUIRED'
            ? 'Account setup is incomplete. Please contact the administrator; retrying cannot repair the database setup.'
            : 'Account status is temporarily unavailable. Please retry.')
          : null,
        sessionNotice: !unavailable && code && code !== 'AUTH_REQUIRED' ? sessionNoticeFor(code) : null,
      });
    }
  },

  updateProfile: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.put<any>('/auth/profile', data);
      set({ user: response.data.data, isLoading: false });
    } catch (error: any) {
      const message = error.response?.data?.error?.message || 'Update failed';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

}));

setSessionAccountReader(() => useAuthStore.getState().user?._id);
