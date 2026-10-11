import { useEffect, useState } from 'react';
import api from '../../../services/api';

interface IntegrityEvent {
  id: string;
  attemptId: string;
  type: string;
  timestamp: string;
  severity: string;
  detectionMethod: string;
  studentName: string;
  studentEmail: string;
  assessment: string;
  course: string;
  flagged: boolean;
  reviewed: boolean;
}

const PAGE_SIZE = 50;

const AdminIntegrityEventsPage = () => {
  const [events, setEvents] = useState<IntegrityEvent[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setTotal(null);
    api.get('/admin/integrity-events', { params: { page, limit: PAGE_SIZE } }).then(({ data }) => {
      if (!active) return;
      if (!Array.isArray(data.data) || !Number.isSafeInteger(data.pagination?.total) || data.pagination.total < 0) {
        throw new Error('Integrity events response is incomplete. Please retry.');
      }
      setEvents(data.data);
      setTotal(data.pagination.total);
    }).catch((caught: any) => {
      if (active) setError(caught.response?.data?.error?.message || caught.message || 'Could not load integrity events.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, retry]);

  return <div className="space-y-5">
    <header><h1 className="text-2xl font-bold text-gray-900">Integrity events</h1><p className="text-sm text-gray-600">All recorded suspected events. These are signals, not confirmed misconduct; account suspension is a separate action.</p></header>
    {loading ? <p>Loading integrity events…</p> : error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error} <button className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
      : <><p className="text-sm text-gray-600">{total} total events</p>{events.length === 0 ? <p className="rounded-lg border bg-white p-5">No integrity events have been recorded.</p>
        : <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-3">Student / attempt</th><th className="px-4 py-3">Assessment / course</th><th className="px-4 py-3">Event</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">Review</th></tr></thead><tbody>{events.map(event => <tr key={event.id} className="border-t"><td className="px-4 py-3"><p className="font-medium">{event.studentName}</p><p className="text-xs text-gray-500">{event.studentEmail}</p><p className="text-xs text-gray-500">Attempt: {event.attemptId}</p></td><td className="px-4 py-3"><p>{event.assessment}</p><p className="text-xs text-gray-500">{event.course}</p></td><td className="px-4 py-3"><p>{event.type?.replace(/_/g, ' ') || 'Unknown event'}</p><p className="text-xs text-gray-500">{event.severity} · {event.detectionMethod}</p></td><td className="px-4 py-3">{event.timestamp ? new Date(event.timestamp).toLocaleString() : 'Unknown'}</td><td className="px-4 py-3">{event.flagged ? 'Flagged' : 'Unflagged'} · {event.reviewed ? 'Reviewed' : 'Not reviewed'}</td></tr>)}</tbody></table></div>}
        <div className="flex gap-2"><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page * PAGE_SIZE >= (total || 0)} onClick={() => setPage(value => value + 1)}>Next</button></div></>}
  </div>;
};

export default AdminIntegrityEventsPage;
