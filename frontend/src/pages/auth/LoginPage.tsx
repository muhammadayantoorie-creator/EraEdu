import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';
import { EnvelopeIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

const LoginPage = () => {
  const { login, verifyStudentOtp, cancelStudentOtp, studentOtpPending, isLoading } = useAuthStore();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors } } = useForm();
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && !studentOtpPending) {
      toast.success('Logged in successfully!');
      navigate('/dashboard');
    }
  }, [isAuthenticated, studentOtpPending, navigate]);

  const onPasswordSubmit = async (data: any) => {
    try { await login(data); }
    catch (error: any) { toast.error(error.response?.data?.error?.message || 'Login failed. Please check your details.'); }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setOtpError('Enter the six-digit code sent to your university email.');
      return;
    }
    setOtpError(null);
    try { await verifyStudentOtp(code); }
    catch (error: any) { setOtpError(error.response?.data?.error?.message || 'Unable to verify this code. Please try again.'); }
  };

  if (studentOtpPending) {
    return <div>
      <div className="flex justify-center"><span className="rounded-full bg-primary-50 p-3 text-primary-700"><EnvelopeIcon className="h-8 w-8" /></span></div>
      <h2 className="mt-4 text-center text-2xl font-extrabold text-gray-900">Check your university email</h2>
      <p className="mt-2 text-center text-sm text-gray-600">We sent a six-digit sign-in code to <span className="font-semibold">{studentOtpPending.email}</span>. It expires in 10 minutes.</p>
      <form onSubmit={submitCode} className="mt-6 space-y-4">
        <div><label htmlFor="otp" className="block text-sm font-medium text-gray-700">Sign-in code</label><input id="otp" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="123456" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 text-center text-xl font-semibold tracking-[0.45em] shadow-sm focus:border-primary-500 focus:outline-none focus:ring-primary-500" /></div>
        {otpError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{otpError}</p>}
        <button type="submit" disabled={isLoading} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50"><ShieldCheckIcon className="h-5 w-5" />{isLoading ? 'Verifying…' : 'Verify and sign in'}</button>
        <button type="button" onClick={() => { setCode(''); setOtpError(null); cancelStudentOtp(); }} className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Back to login</button>
      </form>
    </div>;
  }

  return <div>
    <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Sign in to your account</h2>
    <p className="mt-2 text-center text-sm text-gray-600">Or <Link to="/register" className="font-medium text-primary-600 hover:text-primary-500">create a new account</Link></p>
    <form className="mt-8 space-y-6" onSubmit={handleSubmit(onPasswordSubmit)}>
      <div><label htmlFor="email" className="block text-sm font-medium text-gray-700">Email address</label><input id="email" type="email" autoComplete="email" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-primary-500" {...register('email', { required: 'Email is required' })} />{errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message as string}</p>}</div>
      <div><label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label><input id="password" type="password" autoComplete="current-password" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-primary-500" {...register('password', { required: 'Password is required' })} /><div className="mt-2 text-right"><Link to="/forgot-password" className="text-sm font-medium text-primary-600 hover:text-primary-500">Forgot password?</Link></div></div>
      <button type="submit" disabled={isLoading} className="flex w-full justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-50">{isLoading ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>;
};

export default LoginPage;
