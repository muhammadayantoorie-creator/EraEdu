import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../../store/authStore';
import api from '../../../services/api';

interface Metrics { users: number; courses: number; quizzes: number; attempts: number; violations: number; suspendedUsers: number; roles: Record<string, number>; roleTotal: number; }
interface PlatformUser { _id: string; name: string; email: string; role: 'student' | 'teacher' | 'admin'; created_at: string; is_suspended: boolean; }
interface StudentFeedback { id: string; rating: number; category: string; liked?: string; improvements: string; would_recommend?: boolean; created_at: string; users?: { name?: string; email?: string }; teacher_quizzes?: { title?: string }; }
interface IntegrityEvent { id: string; attemptId: string; type: string; timestamp: string; severity: string; detectionMethod: string; studentName: string; studentEmail: string; assessment: string; course: string; flagged: boolean; reviewed: boolean; }

const AdminOverview = () => {
  const { user } = useAuthStore();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const usersRequestRef = useRef(0);
  const [search, setSearch] = useState('');
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<StudentFeedback[]>([]);
  const [integrityEvents, setIntegrityEvents] = useState<IntegrityEvent[]>([]);

  const loadOverview = async () => {
    setOverviewError(null);
    try { const { data } = await api.get('/admin/overview'); setMetrics(data.data); }
    catch (error: any) { setOverviewError(error.response?.data?.error?.message || 'Could not load platform metrics.'); }
  };
  useEffect(() => { void loadOverview(); }, []);
  useEffect(() => { api.get('/admin/integrity-events').then(({ data }) => setIntegrityEvents(data.data || [])).catch(() => setIntegrityEvents([])); }, []);

  const loadUsers = async () => {
    const requestId = ++usersRequestRef.current;
    setUsersLoading(true); setUsersError(null);
    try {
      const { data } = await api.get('/admin/users', { params: { search, page: usersPage, limit: 50 } });
      if (requestId !== usersRequestRef.current) return;
      setUsers(data.data || []); setUsersTotal(data.pagination?.total || 0);
    } catch (error: any) {
      if (requestId !== usersRequestRef.current) return;
      setUsersError(error.response?.data?.error?.message || 'Could not load users.');
    } finally { if (requestId === usersRequestRef.current) setUsersLoading(false); }
  };
  useEffect(() => { const timer = window.setTimeout(() => { void loadUsers(); }, 250); return () => window.clearTimeout(timer); }, [search, usersPage]);
  useEffect(() => { setUsersPage(1); }, [search]);

  useEffect(() => {
    api.get('/admin/feedback').then(({ data }) => setFeedback(data.data || [])).catch(() => setFeedback([]));
  }, []);

  const updateUser = async (user: PlatformUser, update: Record<string, unknown>) => {
    setSavingUser(user._id);
    try {
      const { data } = await api.patch(`/admin/users/${user._id}`, update);
      setUsers((current) => current.map((entry) => entry._id === user._id ? data.data : entry));
      await loadOverview();
    } finally { setSavingUser(null); }
  };

  if (!metrics) return overviewError ? <div className="flex h-[60vh] flex-col items-center justify-center gap-4"><p className="text-rose-700">{overviewError}</p><button onClick={() => void loadOverview()} className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white">Retry</button></div> : <div className="flex h-[60vh] items-center justify-center"><span className="h-11 w-11 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div>;

  const cards = [
    ['Registered users', metrics.users.toLocaleString(), `${metrics.roles.student || 0} learners · ${metrics.roles.teacher || 0} educators · ${metrics.roles.admin || 0} admins · ${metrics.roles.unknown || 0} unknown`, 'from-emerald-500 to-teal-500'],
    ['Learning spaces', metrics.courses.toLocaleString(), `${metrics.quizzes} platform exams`, 'from-primary-600 to-accent-500'],
    ['Assessment activity', metrics.attempts.toLocaleString(), 'Exam attempts recorded platform-wide', 'from-primary-700 to-primary-400'],
    ['Integrity events', metrics.violations.toLocaleString(), `${metrics.suspendedUsers} suspended accounts — separate governance action`, 'from-accent-600 to-primary-500'],
  ];
  return <div className="mx-auto max-w-7xl space-y-7">
    <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary-800 via-primary-700 to-teal-700 p-7 ring-1 ring-primary-300/30 sm:p-10" style={{ backgroundImage: 'radial-gradient(65% 100% at 0% 0%, rgba(167,243,208,.25), transparent 58%), radial-gradient(50% 90% at 100% 100%, rgba(103,232,249,.20), transparent 58%), linear-gradient(135deg, #065F46 0%, #047857 52%, #0F766E 100%)' }}>
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-2xl"><p className="inline-flex items-center gap-2 rounded-full bg-white/[.07] px-3 py-1 text-[10px] font-semibold uppercase tracking-eyebrow text-white/75 ring-1 ring-white/10"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.85)]" />Platform operations</p><h1 className="mt-4 font-display text-4xl leading-none text-white sm:text-5xl">Good morning, <span className="bg-gradient-to-r from-primary-300 to-accent-300 bg-clip-text text-transparent">{user?.name || 'Admin'}</span>.</h1><p className="mt-4 text-sm leading-6 text-white/65">A focused view of learning activity, assessment readiness, and platform health.</p></div><div className="rounded-2xl bg-white/[.06] px-5 py-4 ring-1 ring-white/10"><p className="text-[10px] font-semibold uppercase tracking-eyebrow text-white/50">Platform status</p><p className="mt-1 flex items-center gap-2 text-sm font-semibold text-white"><span className="h-2 w-2 rounded-full bg-emerald-400" />Operational</p></div></div>
    </section>
    <section id="platform-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, note, gradient]) => <article key={label} className="group rounded-3xl border border-ink-900/5 bg-white p-5 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift"><span className={`block h-1.5 w-12 rounded-full bg-gradient-to-r ${gradient}`} /><p className="mt-5 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-400">{label}</p><p className="mt-1 font-display text-3xl tracking-tightest text-ink-900">{value}</p><p className="mt-2 text-xs text-ink-500">{note}</p></article>)}</section>
    <section className="grid gap-5 lg:grid-cols-[.85fr_1.15fr]"><aside className="rounded-3xl border border-ink-900/5 bg-gradient-to-br from-slate-50 to-primary-50/50 p-6"><p className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">Developer controls</p><h2 className="mt-1 font-display text-xl text-ink-900">Governance guardrails</h2><div className="mt-6 space-y-4"><div className="rounded-2xl bg-white/75 p-4 ring-1 ring-ink-900/5"><p className="text-sm font-semibold text-ink-900">Account controls</p><p className="mt-1 text-xs leading-5 text-ink-500">Role changes and suspensions are protected by admin-only server routes.</p></div><div className="rounded-2xl bg-white/75 p-4 ring-1 ring-ink-900/5"><p className="text-sm font-semibold text-ink-900">Security boundaries</p><p className="mt-1 text-xs leading-5 text-ink-500">Deployment secrets and database keys remain server-side and are never exposed in this console.</p></div></div></aside><div id="user-governance" className="rounded-3xl border border-ink-900/5 bg-white p-6 shadow-soft"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">User governance</p><h2 className="mt-1 font-display text-xl text-ink-900">Manage platform access</h2></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by email" className="input-field max-w-xs py-2" aria-label="Search users by email" /></div><div className="mt-5 overflow-x-auto"><table className="min-w-full text-left"><thead><tr className="border-b border-ink-900/5 text-[10px] uppercase tracking-eyebrow text-ink-400"><th className="px-3 py-3">User</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Access</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{users.map((entry) => <tr key={entry._id} className="border-b border-ink-900/5 last:border-0"><td className="px-3 py-3"><p className="text-sm font-semibold text-ink-900">{entry.name}</p><p className="text-xs text-ink-500">{entry.email}</p></td><td className="px-3 py-3"><select value={entry.role} disabled={savingUser === entry._id} onChange={(event) => updateUser(entry, { role: event.target.value })} className="rounded-lg border border-ink-900/10 bg-white px-2 py-1.5 text-sm text-ink-800 focus:ring-2 focus:ring-primary-500"><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select></td><td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.is_suspended ? 'bg-rose-50 text-rose-700' : 'bg-primary-50 text-primary-700'}`}>{entry.is_suspended ? 'Suspended' : 'Active'}</span></td><td className="px-3 py-3"><button disabled={savingUser === entry._id} onClick={() => updateUser(entry, { isSuspended: !entry.is_suspended })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${entry.is_suspended ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}>{entry.is_suspended ? 'Restore' : 'Suspend'}</button></td></tr>)}</tbody></table>{users.length === 0 && <p className="py-10 text-center text-sm text-ink-500">No users found.</p>}</div></div></section>
    <section className="rounded-3xl border border-ink-900/5 bg-white p-6 shadow-soft"><div className="flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">Private admin inbox</p><h2 className="mt-1 font-display text-xl text-ink-900">Student feedback</h2></div><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">{feedback.length} responses</span></div><div className="mt-5 grid gap-4 lg:grid-cols-2">{feedback.map((item) => <article key={item.id} className="rounded-2xl border border-ink-900/5 bg-ink-50/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-ink-900">{item.teacher_quizzes?.title || 'Exam feedback'}</p><p className="mt-1 text-xs text-ink-500">{item.users?.name || 'Student'} · {item.category}</p></div><span className="whitespace-nowrap text-sm font-bold text-amber-500">{'★'.repeat(item.rating)}{'☆'.repeat(5-item.rating)}</span></div><p className="mt-3 text-sm leading-6 text-ink-700">{item.improvements}</p>{item.liked && <p className="mt-2 text-xs leading-5 text-ink-500"><span className="font-semibold text-ink-700">Worked well:</span> {item.liked}</p>}<p className="mt-3 text-[10px] uppercase tracking-wider text-ink-400">{new Date(item.created_at).toLocaleString()}</p></article>)}</div>{feedback.length === 0 && <p className="py-10 text-center text-sm text-ink-500">No student feedback has been submitted yet.</p>}</section>
    <section className="rounded-3xl border border-ink-900/5 bg-white p-6 shadow-soft"><div><p className="text-[10px] font-semibold uppercase tracking-eyebrow text-ink-400">Integrity events</p><h2 className="mt-1 font-display text-xl text-ink-900">Suspected activity requiring review</h2><p className="mt-1 text-xs text-ink-500">Events are signals, not confirmed misconduct. Suspension is a separate manual governance action.</p></div><div className="mt-5 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-ink-900/5 text-[10px] uppercase tracking-eyebrow text-ink-400"><th className="px-3 py-2">Student / attempt</th><th className="px-3 py-2">Assessment / course</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Review</th></tr></thead><tbody>{integrityEvents.map((event) => <tr key={event.id} className="border-b border-ink-900/5"><td className="px-3 py-3"><p className="font-semibold text-ink-900">{event.studentName}</p><p className="text-xs text-ink-500">{event.studentEmail}</p><p className="text-[10px] text-ink-400">{event.attemptId}</p></td><td className="px-3 py-3"><p>{event.assessment}</p><p className="text-xs text-ink-500">{event.course}</p></td><td className="px-3 py-3"><p>{event.type.replace(/_/g, ' ')}</p><p className="text-xs text-ink-500">{event.severity} · {event.detectionMethod}</p></td><td className="px-3 py-3 text-xs">{new Date(event.timestamp).toLocaleString()}</td><td className="px-3 py-3 text-xs">{event.flagged ? 'Flagged' : 'Unflagged'} · {event.reviewed ? 'Reviewed' : 'Not reviewed'}</td></tr>)}</tbody></table>{integrityEvents.length === 0 && <p className="py-8 text-center text-sm text-ink-500">No integrity events have been recorded.</p>}</div></section>
    <section className="rounded-2xl border border-ink-900/5 bg-white p-4 text-sm text-ink-600"><div className="flex items-center justify-between gap-3"><span>{usersLoading ? 'Loading user directory…' : usersError ? usersError : users.length === 0 ? (search ? 'No users match this search.' : 'No registered users yet.') : `Showing ${(usersPage - 1) * 50 + 1}–${Math.min(usersPage * 50, usersTotal)} of ${usersTotal} users.`}</span>{usersError ? <button onClick={() => void loadUsers()} className="rounded bg-primary-700 px-3 py-1.5 text-xs font-semibold text-white">Retry users</button> : <div className="flex gap-2"><button disabled={usersPage === 1 || usersLoading} onClick={() => setUsersPage(page => page - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button><button disabled={usersPage * 50 >= usersTotal || usersLoading} onClick={() => setUsersPage(page => page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button></div>}</div></section>
  </div>;
};

export default AdminOverview;
