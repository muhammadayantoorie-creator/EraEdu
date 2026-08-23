import axios from 'axios';

const normalizeApiBaseUrl = (value?: string) => {
  if (!value) return value;
  const trimmed = value.replace(/\/$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
};

// Create axios instance
const api = axios.create({
  // In dev we proxy /api -> http://localhost:5000 via vite.config.ts.
  // In production VITE_API_URL should point to the deployed backend. Falling
  // back to same-origin keeps previews deterministic instead of contacting a
  // stale third-party deployment.
  baseURL: normalizeApiBaseUrl(import.meta.env.VITE_API_URL)
    ?? '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Add a request interceptor to attach the token
api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Redirect to login on 401 for protected API calls only
    // — skip auth endpoints where 401 is expected (check-auth, login, register)
    if (error.response && error.response.status === 401) {
      const url: string = error.config?.url ?? '';
      const isAuthEndpoint = url.includes('/auth/me') || url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/verify-student-otp');
      if (!isAuthEndpoint) {
        window.location.href = `${import.meta.env.BASE_URL}login`;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
