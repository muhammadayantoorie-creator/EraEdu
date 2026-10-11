import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../services/api';

interface AttemptRow {
  id: string; student: string; studentEmail: string; assessment: string;
  assessmentType: string; topic: string | null; course: string; coursePublished: boolean | null;
  status: string; startedAt: string; referenceIssues: string[];
}

const AdminAttemptsPage = () => {
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setTotal(null);
    api.get('/admin/attempts', { params: { page, limit: 50 } }).then(({ data }) => {
      if (!active) return;
      if (!Number.isSafeInteger(data.pagination?.total) || data.pagination.total < 0 || !Array.isArray(data.data)) {
        throw new Error('Assessment activity response is incomplete. Please retry.');
      }
      setRows(data.data); setTotal(data.pagination.total);
    }).catch((caught: any) => {
      if (active) setError(caught.response?.data?.error?.message || caught.message || 'Could not load assessment activity.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, retry]);

  return <div className="space-y-5">
    <header><h1 className="text-2xl font-bold text-gray-900">Assessment activity</h1><p className="text-sm text-gray-600">All-time exam attempts, including history from unpublished courses. Missing references are flagged for review, never removed automatically.</p></header>
    {loading ? <p>Loading attempts…</p> : error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error} <button className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
      : <><p className="text-sm text-gray-600">{total} total attempts</p>{rows.length === 0 ? <p className="rounded-lg border bg-white p-5">No exam attempts recorded.</p>
        : <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-3">Student</th><th className="px-4 py-3">Assessment / course</th><th className="px-4 py-3">Started</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reference check</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="px-4 py-3">{row.student}<div className="text-xs text-gray-500">{row.studentEmail}</div></td><td className="px-4 py-3">{row.assessment}<div className="text-xs text-gray-500">{row.assessmentType} · {row.course}{row.coursePublished === false ? ' (unpublished)' : ''}</div>{row.topic && <div className="text-xs text-gray-500">Topic: {row.topic}</div>}</td><td className="px-4 py-3">{row.startedAt ? new Date(row.startedAt).toLocaleString() : 'Unknown'}</td><td className="px-4 py-3">{row.status}{row.status === 'completed' && row.referenceIssues.length === 0 && <div><Link className="text-primary-700 underline" to={`/quiz/results/${row.id}`}>View result</Link></div>}</td><td className="px-4 py-3">{row.referenceIssues.length ? <span className="font-medium text-amber-700">{row.referenceIssues.join(', ')}</span> : 'References intact'}</td></tr>)}</tbody></table></div>}
        <div className="flex gap-2"><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page * 50 >= (total || 0)} onClick={() => setPage(value => value + 1)}>Next</button></div></>}
  </div>;
};

export default AdminAttemptsPage;
