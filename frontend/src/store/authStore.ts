import { create } from 'zustand';
import api from '../services/api';
import { User } from '../types';

interface FaceVerificationPending {
  tempToken: string;
  userName: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAuthChecking: boolean;
  error: string | null;
  faceVerificationPending: FaceVerificationPending | null;
  
  login: (credentials: any) => Promise<void>;
  verifyFaceLogin: (faceEncoding: number[]) => Promise<void>;
  cancelFaceVerification: () => void;
  register: (data: any) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<string>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, _get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isAuthChecking: true, // Start as true to prevent flash
  error: null,
  faceVerificationPending: null,

  login: async (credentials) => {
    // A new sign-in attempt must never inherit an earlier user session. In
    // particular, a student must not be redirected by a stale /auth/me check
    // before completing the required face verification step.
    set({
      isLoading: true,
      error: null,
      faceVerificationPending: null,
      user: null,
      token: null,
      isAuthenticated: false,
      isAuthChecking: false,
    });
    try {
       const response = await api.post<any>('/auth/login', credentials);
      const responseData = response.data.data;

      if (responseData.requiresFaceVerification) {
        set({
          isLoading: false,
          isAuthenticated: false,
          isAuthChecking: false,
          faceVerificationPending: {
            tempToken: responseData.tempToken,
            userName: responseData.userName,
          },
        });
        return;
      }

      // A slow initial /auth/me check can still be in flight when a user signs
      // in. Mark the new session as settled immediately so that stale check
      // cannot send the user back to the sign-in screen.
      set({ user: responseData.user || responseData, token: null, isAuthenticated: true, isLoading: false, isAuthChecking: false, error: null });
    } catch (error: any) {
      const message = error.response?.data?.message || error.response?.data?.error?.message || 'Login failed';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  verifyFaceLogin: async (faceEncoding: number[]) => {
    const pending = _get().faceVerificationPending;
    if (!pending) throw new Error('No face verification pending');

    set({ isLoading: true, error: null });
    try {
      const response = await api.post<any>('/auth/verify-face-login', {
        tempToken: pending.tempToken,
        faceEncoding,
      }, {
        // Face matching is normally fast. Do not leave a student trapped on
        // a spinner if a cold server or unstable network never responds.
        timeout: 15000,
      });
      const { user } = response.data.data;
      set({ user, token: null, isAuthenticated: true, isLoading: false, isAuthChecking: false, faceVerificationPending: null, error: null });
    } catch (error: any) {
      const message = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
        ? 'Face verification took too long. Please check your connection and try again.'
        : error.response?.data?.message || error.response?.data?.error?.message || 'Face verification failed. Please try again.';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  cancelFaceVerification: () => {
    set({ faceVerificationPending: null, error: null });
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
    void api.post('/auth/logout').catch(() => undefined);
    set({ user: null, token: null, isAuthenticated: false, isAuthChecking: false });
  },

  checkAuth: async () => {
    // Don't set isLoading, use separate isAuthChecking
    try {
      const response = await api.get<any>('/auth/me');
      // A student has just passed password validation and is awaiting camera
      // verification. Ignore any older cookie-session response so it cannot
      // bypass the face-verification screen.
      if (_get().faceVerificationPending) {
        set({ isAuthChecking: false });
        return;
      }
      set({ user: response.data.data, isAuthenticated: true, isAuthChecking: false });
    } catch (error) {
      // Do not let an older failed checkAuth request overwrite a session that
      // was established by a successful login in the meantime.
      if (_get().isAuthenticated) {
        set({ isAuthChecking: false });
        return;
      }
      set({ user: null, token: null, isAuthenticated: false, isAuthChecking: false });
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
