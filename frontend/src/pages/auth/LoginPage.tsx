import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const LoginPage = () => {
  const { login, isLoading } = useAuthStore();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors } } = useForm();

  useEffect(() => {
    if (isAuthenticated) {
      toast.success('Logged in successfully!');
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const onSubmit = async (data: any) => {
    try { await login(data); }
    catch (error: any) { toast.error(error.response?.data?.error?.message || error.response?.data?.message || 'Login failed. Please check your details.'); }
  };

  return <div>
    <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Sign in to your account</h2>
    <p className="mt-2 text-center text-sm text-gray-600">Or <Link to="/register" className="font-medium text-primary-600 hover:text-primary-500">create a new account</Link></p>
    <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
      <div><label htmlFor="email" className="block text-sm font-medium text-gray-700">Email address</label><input id="email" type="email" autoComplete="email" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-primary-500" {...register('email', { required: 'Email is required' })} />{errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message as string}</p>}</div>
      <div><label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label><input id="password" type="password" autoComplete="current-password" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-primary-500" {...register('password', { required: 'Password is required' })} /><div className="mt-2 text-right"><Link to="/forgot-password" className="text-sm font-medium text-primary-600 hover:text-primary-500">Forgot password?</Link></div></div>
      <button type="submit" disabled={isLoading} className="flex w-full justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-50">{isLoading ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>;
};

export default LoginPage;
