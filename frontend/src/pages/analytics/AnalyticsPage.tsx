import { useEffect } from 'react';
import { useAnalytics } from '../../hooks/useAnalytics';

export default function AnalyticsPage() {
  const { stats, loading, error, fetchDashboardStats } = useAnalytics();
  useEffect(() => { void fetchDashboardStats(); }, [fetchDashboardStats]);
  if (loading) return <p role="status" className="p-6">Loading analytics…</p>;
  if (error) return <div role="alert" className="p-6 text-red-800">
    <p>{error}</p><button className="mt-3 underline focus-visible:ring-2" onClick={() => void fetchDashboardStats()}>Retry</button>
  </div>;
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-bold text-gray-900">Your exam analytics</h1>
    <p className="text-gray-700">Scores include completed topic exams and teacher exams released after review.</p>
    <dl className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-lg border bg-white p-6"><dt>Enrolled courses</dt><dd className="text-2xl font-semibold">{stats?.coursesEnrolled ?? '—'}</dd></div>
      <div className="rounded-lg border bg-white p-6"><dt>Completed exams</dt><dd className="text-2xl font-semibold">{stats?.quizzesCompleted ?? '—'}</dd></div>
      <div className="rounded-lg border bg-white p-6"><dt>Released average score</dt><dd className="text-2xl font-semibold">{stats?.averageScore != null ? `${stats.averageScore}%` : 'No released results'}</dd></div>
    </dl>
    {!!stats?.pendingReviews && <p role="status" className="rounded bg-amber-50 p-4 text-amber-900">{stats.pendingReviews} result(s) pending teacher review.</p>}
  </main>;
}
