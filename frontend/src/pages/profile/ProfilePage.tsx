import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { UserCircleIcon, PencilIcon, XMarkIcon, CheckIcon } from '@heroicons/react/24/solid';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import api from '../../services/api';

type Organization = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'teacher';
  seat_limit: number;
};

type BillingRecord = {
  plan: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  paid_at: string | null;
};

const OrganizationCard = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [name, setName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [loading, setLoading] = useState(true);

  const loadOrganizations = async () => {
    try {
      const response = await api.get('/organizations');
      setOrganizations(response.data.data);
    } catch {
      toast.error('Unable to load organization details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadOrganizations(); }, []);

  const createOrganization = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/organizations', { name });
      setName('');
      toast.success('Organization created.');
      await loadOrganizations();
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || 'Unable to create organization.');
    }
  };

  const ownerOrganization = organizations.find((organization) => organization.role === 'owner' || organization.role === 'admin');
  const addTeacher = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ownerOrganization) return;
    try {
      const response = await api.post(`/organizations/${ownerOrganization.id}/members`, { email: teacherEmail });
      setTeacherEmail('');
      toast.success(response.data.data.alreadyMember ? 'That teacher is already on your team.' : 'Teacher added to your organization.');
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || 'Unable to add teacher.');
    }
  };

  return (
    <section className="mt-6 overflow-hidden rounded-lg bg-white shadow">
      <div className="border-b border-gray-200 px-4 py-5 sm:px-6">
        <h3 className="text-lg font-medium text-gray-900">Institution team</h3>
        <p className="mt-1 text-sm text-gray-500">Create an institution workspace and add registered teachers.</p>
      </div>
      <div className="space-y-5 px-4 py-5 sm:px-6">
        {loading ? <p className="text-sm text-gray-500">Loading organization…</p> : organizations.length === 0 ? (
          <form onSubmit={createOrganization} className="flex flex-col gap-3 sm:flex-row">
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={255} placeholder="Institution or department name" className="input-field" />
            <button type="submit" className="btn-primary shrink-0">Create team</button>
          </form>
        ) : (
          <>
            <div className="space-y-2">
              {organizations.map((organization) => <div key={organization.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"><span className="font-medium text-gray-900">{organization.name}</span><span className="capitalize text-gray-500">{organization.role} · {organization.seat_limit} seats</span></div>)}
            </div>
            {ownerOrganization && (
              <form onSubmit={addTeacher} className="flex flex-col gap-3 border-t border-gray-100 pt-5 sm:flex-row">
                <input type="email" value={teacherEmail} onChange={(event) => setTeacherEmail(event.target.value)} required placeholder="Registered teacher email" className="input-field" />
                <button type="submit" className="btn-primary shrink-0">Add teacher</button>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
};

const ProfilePage: React.FC = () => {
  const { user, logout, updateProfile } = useAuthStore();
  const [isEditing, setIsEditing] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'checking' | 'paid' | 'pending' | null>(null);
  const [billing, setBilling] = useState<BillingRecord | null>(null);
  const [billingLoading, setBillingLoading] = useState(user?.role === 'teacher');
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      name: user?.name || '',
      bio: user?.bio || '',
      interests: user?.interests?.join(', ') || '',
    }
  });

  const onSubmit = async (data: any) => {
    try {
      // Convert interests string back to array
      const interestsArray = data.interests.split(',').map((i: string) => i.trim()).filter((i: string) => i);
      
      await updateProfile({
        name: data.name,
        bio: data.bio,
        interests: interestsArray
      });
      
      toast.success('Profile updated successfully');
      setIsEditing(false);
    } catch (error) {
      toast.error('Failed to update profile');
    }
  };

  useEffect(() => {
    const tracker = new URLSearchParams(window.location.search).get('tracker');
    if (!tracker || user?.role !== 'teacher') return;

    let cancelled = false;
    let attempts = 0;
    setPaymentStatus('checking');
    const checkPayment = async () => {
      try {
        const response = await api.get(`/safepay/status/${encodeURIComponent(tracker)}`);
        if (cancelled) return;
        if (response.data.data.status === 'paid') {
          setPaymentStatus('paid');
          toast.success('Payment confirmed. Your Institution plan is active.');
          window.history.replaceState({}, '', window.location.pathname);
          return;
        }
      } catch {
        if (!cancelled) setPaymentStatus('pending');
        return;
      }
      attempts += 1;
      if (attempts >= 5) {
        if (!cancelled) setPaymentStatus('pending');
        return;
      }
      window.setTimeout(checkPayment, 3000);
    };
    void checkPayment();
    return () => { cancelled = true; };
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'teacher') {
      setBillingLoading(false);
      return;
    }

    let cancelled = false;
    const loadBilling = async () => {
      try {
        const response = await api.get('/safepay/subscription');
        if (!cancelled) setBilling(response.data.data);
      } catch {
        // Billing is supplementary to the profile, so keep this view usable
        // when a gateway check is temporarily unavailable.
      } finally {
        if (!cancelled) setBillingLoading(false);
      }
    };
    void loadBilling();
    return () => { cancelled = true; };
  }, [user?.role]);

  return (
    <div className="max-w-3xl mx-auto">
      {paymentStatus && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${paymentStatus === 'paid' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
          {paymentStatus === 'paid'
            ? 'Payment confirmed — your Institution plan is active.'
            : paymentStatus === 'checking'
              ? 'Checking your Safepay payment…'
              : 'Your payment is still being confirmed. Please refresh this page in a moment.'}
        </div>
      )}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
          <div>
            <h3 className="text-lg leading-6 font-medium text-gray-900">User Profile</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">Personal details and application settings.</p>
          </div>
          <div className="flex space-x-3">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <PencilIcon className="-ml-1 mr-2 h-5 w-5 text-gray-500" />
                Edit
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(false)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <XMarkIcon className="-ml-1 mr-2 h-5 w-5 text-gray-500" />
                Cancel
              </button>
            )}
            <button
              onClick={logout}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Logout
            </button>
          </div>
        </div>
        
        <div className="border-t border-gray-200 px-4 py-5 sm:p-0">
          {isEditing ? (
            <form onSubmit={handleSubmit(onSubmit)} className="p-4 sm:p-6 space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">Full Name</label>
                <div className="mt-1">
                  <input
                    type="text"
                    id="name"
                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border"
                    {...register('name', { required: 'Name is required' })}
                  />
                  {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message as string}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="bio" className="block text-sm font-medium text-gray-700">Bio</label>
                <div className="mt-1">
                  <textarea
                    id="bio"
                    rows={3}
                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border"
                    {...register('bio')}
                  />
                </div>
                <p className="mt-2 text-sm text-gray-500">Brief description for your profile.</p>
              </div>

              <div>
                <label htmlFor="interests" className="block text-sm font-medium text-gray-700">Interests</label>
                <div className="mt-1">
                  <input
                    type="text"
                    id="interests"
                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border"
                    placeholder="React, AI, Data Science (comma separated)"
                    {...register('interests')}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  <CheckIcon className="-ml-1 mr-2 h-5 w-5" />
                  Save Changes
                </button>
              </div>
            </form>
          ) : (
            <dl className="sm:divide-y sm:divide-gray-200">
              <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Full name</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2 flex items-center">
                  <UserCircleIcon className="h-5 w-5 text-gray-400 mr-2" />
                  {user?.name}
                </dd>
              </div>
              <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Email address</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{user?.email}</dd>
              </div>
              <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Role</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2 capitalize">{user?.role}</dd>
              </div>
              <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Bio</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {user?.bio || <span className="text-gray-400 italic">No bio provided</span>}
                </dd>
              </div>
              <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Interests</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {user?.interests && user.interests.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {user.interests.map((interest, idx) => (
                        <span key={idx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                          {interest}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-400 italic">No interests listed</span>
                  )}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>
      {user?.role === 'teacher' && (
        <section className="mt-6 overflow-hidden rounded-lg bg-white shadow">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Billing &amp; subscription</h3>
              <p className="mt-1 text-sm text-gray-500">Your most recent EraEdu Institution plan payment. This covers your institution for one month.</p>
            </div>
            {billing?.status === 'paid' && <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Institution plan active</span>}
          </div>
          <div className="px-4 py-5 sm:px-6">
            {billingLoading ? (
              <p className="text-sm text-gray-500">Checking your billing status…</p>
            ) : !billing ? (
              <p className="text-sm text-gray-500">No Institution plan payment has been recorded yet.</p>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-3">
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Plan</dt><dd className="mt-1 text-sm font-medium text-gray-900">Institution — monthly</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Amount</dt><dd className="mt-1 text-sm font-medium text-gray-900">{billing.currency} {(billing.amount / 100).toLocaleString()}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</dt><dd className={`mt-1 text-sm font-semibold capitalize ${billing.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'}`}>{billing.status}</dd></div>
              </dl>
            )}
          </div>
        </section>
      )}
      {user?.role === 'teacher' && <OrganizationCard />}
    </div>
  );
};

export default ProfilePage;
